// Utilidades de conciliación bancaria.

/** Prefijo con el que se marcan las transacciones importadas sin factura en Xetux. */
export const SIN_FACTURA_PREFIX = "SIN FACTURA XETUX";

/**
 * Normaliza una referencia bancaria: BA (Banco de Venezuela/Banesco) exporta
 * las referencias con apóstrofe inicial ('122347217146).
 */
export function limpiarReferencia(v: unknown): string {
  return String(v ?? "").trim().replace(/^['´`\u2018\u2019]+/, "").trim();
}


/**
 * Huella única de un movimiento bancario, usada en `transacciones.referencia`
 * para evitar importar dos veces el mismo movimiento.
 * Formato: BANK:<BANCO>|<FECHA>|<REF>|<MONTO>
 */
export function huellaBancaria(args: {
  banco: string;
  fecha: string;
  referencia: string;
  monto: number;
}): string {
  const banco = String(args.banco ?? "").trim().toUpperCase();
  const ref = limpiarReferencia(args.referencia).toUpperCase().replace(/\s+/g, "");
  const monto = Math.abs(Number(args.monto) || 0).toFixed(2);
  return `BANK:${banco}|${args.fecha}|${ref || "SINREF"}|${monto}`;
}

/** ¿La transacción proviene de una importación bancaria sin factura? */
export function esSinFactura(detalle?: string | null): boolean {
  return String(detalle ?? "").startsWith(SIN_FACTURA_PREFIX);
}

// ─────────────────────────────────────────────────────────────
// Códigos de documento (columna "N° Factura o N° Orden de Entrega")
// ─────────────────────────────────────────────────────────────

export type TipoCodigo = "FACT" | "NE" | "PED";

export type CodigoDoc = {
  tipo: TipoCodigo;
  raw: string;
  norm: string;
};

/**
 * Normaliza un código de documento para comparación tolerante:
 * mayúsculas, sin prefijos (NE/PED/FACT/F), sin guiones ni separadores,
 * sin ceros a la izquierda.
 */
export function normalizarCodigo(s: string): string {
  let v = String(s ?? "").toUpperCase().trim();
  v = v.replace(/^(NE|PED|PEDIDO|ORDEN|OE|FACT|FACTURA|FAC|NRO|N°|NO)\s*[:.\-#]?\s*/i, "");
  v = v.replace(/[^A-Z0-9]/g, "");
  v = v.replace(/^F(?=\d)/, "");
  v = v.replace(/^0+/, "");
  return v;
}

/**
 * Parsea la celda de la columna K: separa por comas / punto y coma y
 * detecta el tipo de cada token (arrastrando el prefijo de la lista, ej "NE: 21, 28").
 */
export function parseCodigosDoc(cell: unknown): CodigoDoc[] {
  const s = String(cell ?? "").trim();
  if (!s) return [];
  const out: CodigoDoc[] = [];
  let tipoActual: TipoCodigo = "FACT";
  for (const partRaw of s.split(/[,;/|]+/)) {
    const part = partRaw.trim();
    if (!part) continue;
    const pm = part.match(/^(NE|PED|PEDIDO|ORDEN|OE|FACT|FACTURA|FAC)\s*[:.\-#]?\s*(.*)$/i);
    let resto = part;
    if (pm) {
      const p = pm[1].toUpperCase();
      tipoActual = p.startsWith("NE") || p.startsWith("OE") || p.startsWith("ORDEN")
        ? "NE"
        : p.startsWith("PED")
          ? "PED"
          : "FACT";
      resto = pm[2].trim();
    }
    if (!resto) continue;
    const norm = normalizarCodigo(resto);
    if (!norm) continue;
    out.push({ tipo: tipoActual, raw: resto, norm });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Cuentas que por naturaleza nunca tienen factura de proveedor
// ─────────────────────────────────────────────────────────────

/** Cuentas específicas sin factura (además de todo el grupo 3.x). */
const CUENTAS_SIN_FACTURA_FIJAS = new Set([
  "14.1", "14.3",           // activos transitorios
  "13.1", "13.2",           // pasivos transitorios / pago CxP
  "10.1", "10.2", "10.4", "10.5", "10.7", // financiamiento y depreciación
  "12.1", "12.2", "12.3", "12.4", "12.5", // impuestos
  "7.1", "7.2",             // financieros
  "11.1", "11.2",           // ganancia/pérdida cambiaria
]);

/** Servicios públicos: se cruzan con la referencia bancaria, no con factura. */
export const CUENTAS_SERVICIOS = new Set(["9.3", "9.4", "9.7"]);

/** ¿Esta cuenta nunca va a tener una factura comercial asociada? */
export function cuentaSinFactura(codigo?: string | null): boolean {
  const c = String(codigo ?? "").trim();
  if (!c) return false;
  if (c === "3" || c.startsWith("3.")) return true;
  return CUENTAS_SIN_FACTURA_FIJAS.has(c);
}

/** ¿Es un servicio público (cruce por referencia bancaria)? */
export function cuentaServicio(codigo?: string | null): boolean {
  return CUENTAS_SERVICIOS.has(String(codigo ?? "").trim());
}

// ─────────────────────────────────────────────────────────────
// Moneda base según el banco (columna C del reporte)
// ─────────────────────────────────────────────────────────────

const BANCOS_USD = new Set(["CASH", "BOFA"]);

/**
 * Determina la variable independiente del movimiento:
 * - BA, BCV, BM, BVC, MERC, CXP → Bs
 * - CASH, BOFA → USD
 */
export function monedaBase(bancoRaw: string): "Bs" | "USD" {
  const s = String(bancoRaw ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (BANCOS_USD.has(s)) return "USD";
  if (s.includes("BOFA") || s.includes("BANKOFAMERICA") || s.includes("CASH") || s.includes("EFECTIVO")) return "USD";
  return "Bs";
}

// ─────────────────────────────────────────────────────────────
// Guardado de vínculos de conciliación (fuente única de verdad)
// ─────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";

export type EstadoVinculo = "pareado" | "parcial" | "rechazado";

type GuardarArgs = {
  /** Se reemplazan todos los vínculos de este movimiento */
  movimientoId?: string;
  /** …o todos los vínculos de esta factura */
  facturaId?: string;
  /** Contraparte(s) a vincular */
  contrapartes: string[];
  estado: EstadoVinculo;
  origen: "auto" | "manual";
  userId?: string | null;
  /** Al rechazar: contra qué facturas se rechazó la sugerencia */
  facturasRechazadas?: string[];
};

/**
 * Reemplaza los vínculos existentes del movimiento (o de la factura) por los
 * indicados. Sin ON CONFLICT: se borra y se inserta, así no depende de índices.
 */
export async function guardarVinculosConciliacion(
  args: GuardarArgs,
): Promise<{ ok: boolean; error?: string }> {
  const { movimientoId, facturaId, contrapartes, estado, origen, userId, facturasRechazadas } = args;
  const tabla = (supabase.from as any)("conciliacion_bancaria");

  const del = movimientoId
    ? await tabla.delete().eq("transaccion_bancaria_id", movimientoId)
    : await tabla.delete().eq("transaccion_factura_id", facturaId);
  if (del.error) return { ok: false, error: del.error.message };

  const base = {
    estado,
    origen,
    confirmado_por: userId ?? null,
    confirmado_en: new Date().toISOString(),
  };

  let rows: any[] = [];
  if (movimientoId) {
    rows =
      estado === "rechazado"
        ? [{
            ...base,
            transaccion_bancaria_id: movimientoId,
            transaccion_factura_id: null,
            facturas_rechazadas: facturasRechazadas ?? [],
          }]
        : contrapartes.map((fid) => ({ ...base, transaccion_bancaria_id: movimientoId, transaccion_factura_id: fid }));
  } else if (facturaId && estado !== "rechazado") {
    rows = contrapartes.map((mid) => ({ ...base, transaccion_bancaria_id: mid, transaccion_factura_id: facturaId }));
  }


  if (!rows.length) return { ok: true };

  const { error } = await (supabase.from as any)("conciliacion_bancaria").insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
