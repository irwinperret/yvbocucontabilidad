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
  // Se normalizan también los ceros a la izquierda y separadores: algunos bancos
  // exportan la misma referencia como "00618486" y otras veces como "618486",
  // lo que hacía que el mismo movimiento se importara dos veces.
  const ref = limpiarReferencia(args.referencia)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^0+(?=[0-9A-Z])/, "");
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
  "9.1", "9.3",           // activos transitorios
  "8.1", "8.2", "8.3",   // pasivos transitorios / pago CxP / bonos 10%
  "5.1", "5.2", "5.4", "5.5", "5.7", // financiamiento y depreciación
  "7.1", "7.2", "4.11", "7.3", "7.4", // impuestos
  "4.8",                    // financieros (incluye lo que antes era 7.2/7.3)
  "6.1", "6.2",           // ganancia/pérdida cambiaria
  "98", "99",               // operaciones de cambio / no contable
]);

/** Servicios públicos: se cruzan con la referencia bancaria, no con factura. */
export const CUENTAS_SERVICIOS = new Set(["3.14", "3.15", "3.18"]);

/**
 * Cuentas que, al importarse desde movimientos bancarios, se marcan
 * automáticamente como "Gasto Stand-Alone (sin factura)" en la conciliación:
 * nunca van a tener una factura de Xetux asociada, así que no tiene sentido
 * dejarlas pendientes de revisión.
 */
export const CUENTAS_GASTO_DIRECTO_AUTO = new Set([
  "1.7", // Devoluciones / Notas de crédito
  "3.1", // Sueldos
  "3.2", // Pasivos laborales
  "3.3", // Salarios Administrativos
  "3.4", // Pasivos laborales Administrativos
  "3.5", // Transporte (antes 4.5, ahora dentro de Nómina)
  "3.6", // Sueldo Mónica
  "3.13", // Aseo
  "3.14", // Agua
  "3.15", // Internet
  "3.16", // Teléfono
  "3.17", // Software
  "3.18", // Electricidad
  "3.19", // DirecTV
  "3.20", // Fumigación
  "4.3", // Alquiler
  "4.4", // Condominio
  "4.10", // Mantenimiento y Reparaciones
  "4.11", // IMAE (tasa alcaldía 5%)
  "8.1", // Propinas — pago de pasivo ya devengado en ventas, nunca lleva factura
  "9.1", // Préstamos al personal
  "9.3", // Anticipos de nómina
]);

/** ¿Esta cuenta se concilia automáticamente como gasto directo sin factura? */
export function esGastoDirectoAuto(codigo?: string | null): boolean {
  return CUENTAS_GASTO_DIRECTO_AUTO.has(String(codigo ?? "").trim());
}

// ─────────────────────────────────────────────────────────────
// Proveedores/personas que siempre se marcan como gasto directo
// ─────────────────────────────────────────────────────────────

/**
 * Personas o proveedores cuyos pagos SIEMPRE se marcan como "Gasto
 * Stand-Alone (sin factura)" al importar movimientos bancarios, sin esperar
 * verificación manual — sin importar la cuenta contable asignada ni si ya
 * tienen facturas/CxP registradas. Nombres normalizados (mayúsculas, sin
 * tildes). Agregar aquí cualquier otro caso similar.
 */
export const NOMBRES_GASTO_DIRECTO_FORZADO = new Set([
  "YOFRAN SABINO",
]);

function normalizarTextoMemo(s: unknown): string {
  return String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿El memo (concepto) del movimiento bancario menciona a alguno de los
 * NOMBRES_GASTO_DIRECTO_FORZADO? Exige que TODAS las palabras del nombre
 * aparezcan en el memo (no una suelta), igual que el resto del matching de
 * proveedores, para evitar falsos positivos.
 */
export function memoEsGastoDirectoForzado(memo: string | null | undefined): boolean {
  const texto = normalizarTextoMemo(memo);
  if (!texto) return false;
  for (const nombre of NOMBRES_GASTO_DIRECTO_FORZADO) {
    const tokens = nombre.split(" ").filter(Boolean);
    if (tokens.length && tokens.every((t) => texto.includes(t))) return true;
  }
  return false;
}

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

  // Protección de raíz contra condiciones de carrera: un guardado AUTOMÁTICO
  // (ej. el "auto-confirmar evidentes" que corre solo al cargar la pantalla)
  // nunca debe pisar una decisión MANUAL ya guardada para el mismo
  // movimiento — se consulta la base de datos directamente aquí (no el
  // estado en memoria, que puede estar un paso atrás justo después de que
  // el usuario acaba de guardar un cambio manual).
  if (origen === "auto" && movimientoId) {
    const { data: yaManual } = await tabla
      .select("id")
      .eq("transaccion_bancaria_id", movimientoId)
      .eq("origen", "manual")
      .limit(1);
    if (yaManual && yaManual.length) return { ok: true };
  }

  // Facturas que quedaban vinculadas ANTES de este cambio (para poder
  // resincronizar su CxP también si se les quita el vínculo).
  const previas = movimientoId
    ? (await tabla.select("transaccion_factura_id").eq("transaccion_bancaria_id", movimientoId)).data ?? []
    : [];
  const facturasAfectadas = new Set<string>(
    previas.map((p: any) => p.transaccion_factura_id).filter(Boolean),
  );

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
  if (facturaId) facturasAfectadas.add(facturaId);
  if (movimientoId && estado !== "rechazado") contrapartes.forEach((fid) => facturasAfectadas.add(fid));

  if (rows.length) {
    const { error } = await (supabase.from as any)("conciliacion_bancaria").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  // A diferencia de aplicarPareoCxp() (que crea la transacción de pago 8.2 Y
  // actualiza la CxP), este camino solo vincula un movimiento que ya existe
  // como transacción propia — así que hay que sincronizar la CxP a mano para
  // que no se quede "pendiente" para siempre aunque ya esté pareada de verdad.
  if (facturasAfectadas.size) {
    const { sincronizarCxpDesdeVinculos } = await import("@/lib/pareo-cxp");
    for (const fid of facturasAfectadas) {
      await sincronizarCxpDesdeVinculos(fid);
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Estado de conciliación marcado a mano
// ─────────────────────────────────────────────────────────────

/** Estados que el usuario puede fijar manualmente sobre un movimiento. */
export type EstadoManual = "gasto_directo" | "no_contable" | "sin_pareo" | "pendiente_revision";

export const ESTADO_MANUAL_LABEL: Record<EstadoManual, string> = {
  gasto_directo: "Gasto Stand-Alone (sin factura)",
  no_contable: "No aplica (no contable)",
  sin_pareo: "Sin pareo (revisado)",
  pendiente_revision: "Pendiente de revisión",
};

/** Estados manuales válidos, incluyendo el legado 'no_aplica'. */
export const ESTADOS_MANUALES = [
  "gasto_directo",
  "no_contable",
  "no_aplica",
  "sin_pareo",
  "pendiente_revision",
] as const;

/** Normaliza el estado legado 'no_aplica' al nuevo esquema. */
export function normalizarEstadoManual(estado?: string | null): EstadoManual | null {
  const e = String(estado ?? "").trim();
  if (!e) return null;
  if (e === "no_aplica") return "gasto_directo";
  return (ESTADOS_MANUALES as readonly string[]).includes(e) ? (e as EstadoManual) : null;
}


/**
 * Fija (o quita, con estado = null) el estado de conciliación de un movimiento.
 * Se guarda como un vínculo sin factura; reemplaza cualquier marca previa.
 */
export async function marcarEstadoConciliacion(args: {
  movimientoId: string;
  estado: EstadoManual | null;
  userId?: string | null;
  notas?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const tabla = () => (supabase.from as any)("conciliacion_bancaria");
  const del = await tabla()
    .delete()
    .eq("transaccion_bancaria_id", args.movimientoId)
    .is("transaccion_factura_id", null);
  if (del.error) return { ok: false, error: del.error.message };
  if (!args.estado) return { ok: true };

  const { error } = await tabla().insert({
    transaccion_bancaria_id: args.movimientoId,
    transaccion_factura_id: null,
    estado: args.estado,
    origen: "manual",
    confirmado_por: args.userId ?? null,
    confirmado_en: new Date().toISOString(),
    facturas_rechazadas: [],
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
