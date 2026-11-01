// ─────────────────────────────────────────────────────────────
// Auditoría Xetux: compara un reporte ACUMULADO (todas las ventas o todas
// las compras exportadas de Xetux) contra lo que ya está registrado en el
// sistema, para detectar documentos que Xetux corrigió, que nunca se
// importaron, o que desaparecieron del lado de Xetux después de importados.
//
// El parseo de columnas de este archivo DUPLICA a propósito (en vez de
// reusar) la lógica de onFile() en importar-ventas.tsx / importar-compras.tsx:
// son funciones puras de solo lectura, y mantenerlas separadas evita tocar
// esos dos importadores (que sí escriben en producción) solo para esta
// pantalla de diagnóstico. Si el formato de export de Xetux cambia, hay que
// actualizar el mapeo de columnas en los TRES lugares.
//
// La comparación de montos es "mejor esfuerzo": reconstruye el total que
// Xetux reporta (base + IVA, sin servicio ni propina) sumando las patas
// contables que el importador real crea para cada documento. Cubre bien el
// caso común; casos raros (compras off-balance sin CxP) quedan marcados
// como aproximados en vez de pretender precisión que no se puede garantizar
// sin repetir toda la lógica de conversión de tasas del importador.

import { supabase } from "@/integrations/supabase/client";
import { numFromCell, parseDateCell } from "@/lib/xetux-parse";
import { fetchAllRows } from "@/lib/fetch-all";

// Pantalla sensible: muestra montos acumulados de ventas y compras de todo
// el histórico, así que se restringe a estos dos correos nada más (mismo
// patrón que PERMITIDOS_RESUMEN_MENSUAL / WIPE_ALLOWED_EMAILS en otras
// pantallas de este proyecto).
export const AUDITORIA_XETUX_PERMITIDOS = ["irwinperret@gmail.com", "irwinperret@hotmail.com"];

export const puedeAuditarXetux = (email: string | null | undefined): boolean =>
  !!email && AUDITORIA_XETUX_PERMITIDOS.includes(email.toLowerCase());


// ───────────────────────────── Ventas ─────────────────────────────

export type AuditVentaRow = {
  idx: number;
  numero_factura: string;
  numero_orden: string;
  clase: "factura" | "descuento" | "nota_credito" | "por_determinar";
  cliente: string;
  fecha: string;
  total_usd: number; // base + IVA, tal como lo reporta Xetux (excluye servicio y propina)
};

function clasificarPorTipoVenta(tipoRaw: string): AuditVentaRow["clase"] {
  const t = String(tipoRaw ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (t.includes("nota de credito") || t.includes("nota credito") || t.includes("n/c")) return "nota_credito";
  if (t.includes("desc")) return "descuento";
  return "por_determinar";
}

/** Mismo mapeo de columnas que importar-ventas.tsx: B=tipo, C=factura, F=orden, H=cliente, R=iva, V=total, AK=fecha. */
export function parseVentasAcumulado(aoa: any[][]): AuditVentaRow[] {
  const parsed: AuditVentaRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const tipoRaw = String(row[1] ?? "").trim();
    const numero_factura = String(row[2] ?? "").trim();
    const numero_orden = String(row[5] ?? "").trim();
    const totalRaw = numFromCell(row[21]);
    const cliente = String(row[7] ?? "").trim() || "Contado";
    const iva = numFromCell(row[17]);
    const fecha = parseDateCell(row[36]);

    if (tipoRaw === "Facturada" && numero_factura && totalRaw > 0) {
      parsed.push({ idx: i + 1, numero_factura, numero_orden, clase: "factura", cliente, fecha, total_usd: totalRaw });
      continue;
    }
    if (tipoRaw !== "Facturada" && (numero_factura || numero_orden)) {
      const clase = clasificarPorTipoVenta(tipoRaw);
      const absTotal = Math.abs(totalRaw);
      if (absTotal === 0 && clase !== "por_determinar") continue;
      void iva;
      parsed.push({ idx: i + 1, numero_factura, numero_orden, clase, cliente, fecha, total_usd: absTotal });
    }
  }
  return parsed;
}

const keyVenta = (numero_factura: string, numero_orden: string) =>
  numero_factura ? `F:${numero_factura}` : numero_orden ? `O:${numero_orden}` : null;

type SistemaDoc = { totalUsd: number; fecha: string | null; aproximado: boolean };

async function cargarVentasSistema(): Promise<Map<string, SistemaDoc>> {
  const map = new Map<string, SistemaDoc>();
  const add = (numero_factura: string | null, numero_orden: string | null, monto: number, fecha: string | null) => {
    const key = keyVenta(numero_factura ?? "", numero_orden ?? "");
    if (!key) return;
    const prev = map.get(key);
    if (prev) {
      prev.totalUsd += monto;
      if (!prev.fecha && fecha) prev.fecha = fecha;
    } else {
      map.set(key, { totalUsd: monto, fecha, aproximado: false });
    }
  };

  // Patas de venta/descuento/NC + IVA débito fiscal (1.1/1.2/1.4/1.6/1.7/7.3).
  const legs = await fetchAllRows<any>((from, to) =>
    supabase
      .from("transacciones")
      .select("numero_factura, numero_orden, monto_usd, fecha")
      .in("referencia", ["xetux", "manual"])
      .in("cuenta_codigo", ["1.1", "1.2", "1.4", "1.6", "1.7", "7.3"])
      .range(from, to),
  );
  for (const r of legs) add(r.numero_factura, r.numero_orden, Number(r.monto_usd) || 0, r.fecha ?? null);

  // Pasivo de servicio (bono 10%), solo tipo "bono" -- la propina NO forma
  // parte del "Total Venta" que reporta Xetux y se excluye a propósito.
  const bonos = await fetchAllRows<any>((from, to) =>
    supabase
      .from("bono10_propina")
      .select("numero_factura, numero_orden, monto_usd, fecha, tipo")
      .eq("tipo", "bono")
      .range(from, to),
  );
  for (const r of bonos) add(r.numero_factura, r.numero_orden, Number(r.monto_usd) || 0, r.fecha ?? null);

  // Magnitud: descuentos/NC quedan guardados en negativo, pero el total de
  // Xetux para esas filas ya viene en valor absoluto.
  for (const doc of map.values()) doc.totalUsd = Math.abs(doc.totalUsd);
  return map;
}

// ───────────────────────────── Compras ─────────────────────────────

export type AuditCompraRow = {
  idx: number;
  numero_factura: string;
  numero_orden: string;
  numero_control: string;
  proveedor: string;
  tipo: string;
  fecha: string;
  total_usd: number;
};

/** Mismo mapeo de columnas que importar-compras.tsx ("Lista de Facturas" de Xetux). */
export function parseComprasAcumulado(aoa: any[][]): AuditCompraRow[] {
  const parsed: AuditCompraRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const rifRaw = String(row[1] ?? "").trim();
    const proveedor = String(row[2] ?? "").trim();
    const numero_orden = String(row[4] ?? "").trim();
    const numero_factura = String(row[5] ?? "").trim();
    const tipo = String(row[6] ?? "").trim();
    const numero_control = String(row[7] ?? "").trim();
    const descGlobal = numFromCell(row[10]);
    const subtotal = numFromCell(row[11]);
    const impuestos = numFromCell(row[12]);
    const impAdic = numFromCell(row[13]);
    const impRet = numFromCell(row[14]);
    const cargosAdic = numFromCell(row[16]);
    const iva = +(impuestos + impAdic + impRet).toFixed(2);
    const neto = +Math.max(0, subtotal + cargosAdic - descGlobal).toFixed(2);
    const total = +(neto + iva).toFixed(2);
    const fecha = parseDateCell(row[19]) || parseDateCell(row[18]);

    if (!proveedor && !rifRaw) continue;
    if (!numero_factura) continue;
    if (total <= 0) continue;

    parsed.push({ idx: i + 1, numero_factura, numero_orden, numero_control, proveedor, tipo, fecha, total_usd: total });
  }
  return parsed;
}

async function cargarComprasSistema(): Promise<Map<string, SistemaDoc>> {
  const map = new Map<string, SistemaDoc>();

  // Camino principal: CxP ya tiene el total de la factura en un solo campo.
  const cxps = await fetchAllRows<any>((from, to) =>
    supabase
      .from("cuentas_por_pagar")
      .select("numero_factura, monto_usd")
      .not("numero_factura", "is", null)
      .range(from, to),
  );
  for (const r of cxps) {
    if (!r.numero_factura) continue;
    const key = `F:${r.numero_factura}`;
    const prev = map.get(key);
    if (prev) prev.totalUsd += Number(r.monto_usd) || 0;
    else map.set(key, { totalUsd: Number(r.monto_usd) || 0, fecha: null, aproximado: false });
  }

  // Camino de respaldo: compras off-balance, que no generan CxP. El monto
  // aquí está en términos de tasa paralela, no BCV, así que puede no
  // coincidir exactamente con el total de Xetux -- se marca como aproximado.
  const legs = await fetchAllRows<any>((from, to) =>
    supabase
      .from("transacciones")
      .select("numero_factura, numero_orden, monto_usd, fecha, cuenta_codigo")
      .in("referencia", ["xetux", "manual"])
      .in("cuenta_codigo", ["2.1", "7.4"])
      .not("numero_factura", "is", null)
      .range(from, to),
  );
  const legSums = new Map<string, { total: number; fecha: string | null }>();
  for (const r of legs) {
    const key = `F:${r.numero_factura}`;
    const prev = legSums.get(key);
    if (prev) { prev.total += Number(r.monto_usd) || 0; if (!prev.fecha) prev.fecha = r.fecha ?? null; }
    else legSums.set(key, { total: Number(r.monto_usd) || 0, fecha: r.fecha ?? null });
  }
  for (const [key, v] of legSums) {
    if (!map.has(key)) map.set(key, { totalUsd: v.total, fecha: v.fecha, aproximado: true });
  }

  return map;
}

// ───────────────────────────── Resultado de auditoría ─────────────────────────────

export type AuditResultado<T> = {
  faltantes: T[];
  discrepancias: Array<{ xetux: T; totalSistema: number; diffUsd: number; aproximado: boolean }>;
  sinCambios: number;
  anuladas: Array<{ key: string; numero: string; totalSistema: number; fecha: string | null; aproximado: boolean }>;
};

const TOLERANCIA_USD = (total: number) => Math.max(0.5, total * 0.01);

export async function auditarVentas(rows: AuditVentaRow[]): Promise<AuditResultado<AuditVentaRow>> {
  const sistema = await cargarVentasSistema();
  const vistas = new Set<string>();
  const faltantes: AuditVentaRow[] = [];
  const discrepancias: AuditResultado<AuditVentaRow>["discrepancias"] = [];
  let sinCambios = 0;

  for (const r of rows) {
    const key = keyVenta(r.numero_factura, r.numero_orden);
    if (!key) continue;
    vistas.add(key);
    const doc = sistema.get(key);
    if (!doc) { faltantes.push(r); continue; }
    const diff = +(r.total_usd - doc.totalUsd).toFixed(2);
    if (Math.abs(diff) > TOLERANCIA_USD(r.total_usd)) {
      discrepancias.push({ xetux: r, totalSistema: doc.totalUsd, diffUsd: diff, aproximado: doc.aproximado });
    } else {
      sinCambios++;
    }
  }

  const anuladas: AuditResultado<AuditVentaRow>["anuladas"] = [];
  for (const [key, doc] of sistema) {
    if (vistas.has(key)) continue;
    anuladas.push({ key, numero: key.slice(2), totalSistema: doc.totalUsd, fecha: doc.fecha, aproximado: doc.aproximado });
  }

  return { faltantes, discrepancias, sinCambios, anuladas };
}

export async function auditarCompras(rows: AuditCompraRow[]): Promise<AuditResultado<AuditCompraRow>> {
  const sistema = await cargarComprasSistema();
  const vistas = new Set<string>();
  const faltantes: AuditCompraRow[] = [];
  const discrepancias: AuditResultado<AuditCompraRow>["discrepancias"] = [];
  let sinCambios = 0;

  for (const r of rows) {
    const key = `F:${r.numero_factura}`;
    vistas.add(key);
    const doc = sistema.get(key);
    if (!doc) { faltantes.push(r); continue; }
    const diff = +(r.total_usd - doc.totalUsd).toFixed(2);
    if (Math.abs(diff) > TOLERANCIA_USD(r.total_usd)) {
      discrepancias.push({ xetux: r, totalSistema: doc.totalUsd, diffUsd: diff, aproximado: doc.aproximado });
    } else {
      sinCambios++;
    }
  }

  const anuladas: AuditResultado<AuditCompraRow>["anuladas"] = [];
  for (const [key, doc] of sistema) {
    if (vistas.has(key)) continue;
    anuladas.push({ key, numero: key.slice(2), totalSistema: doc.totalUsd, fecha: doc.fecha, aproximado: doc.aproximado });
  }

  return { faltantes, discrepancias, sinCambios, anuladas };
}
