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

  // OJO: transacciones.monto_usd en las patas de venta está convertido a tasa
  // PARALELA (monto_bs / tasa_paralela), no a tasa BCV -- esta auditoría se
  // monta en USD BCV (igual que el total que reporta Xetux), así que el
  // monto se reconstruye a mano con monto_bs / tasa_bcv (la tasa BCV que
  // quedó guardada en la misma fila), en vez de leer monto_usd directamente.
  const reconstruirBcv = (montoBs: any, tasaBcv: any): number => {
    const tasa = Number(tasaBcv) || 0;
    return tasa > 0 ? (Number(montoBs) || 0) / tasa : 0;
  };

  // Patas de venta/descuento/NC + IVA débito fiscal (1.1/1.2/1.4/1.6/1.7/7.3).
  const legs = await fetchAllRows<any>((from, to) =>
    supabase
      .from("transacciones")
      .select("numero_factura, numero_orden, monto_bs, tasa_bcv, fecha")
      .in("referencia", ["xetux", "manual"])
      .in("cuenta_codigo", ["1.1", "1.2", "1.4", "1.6", "1.7", "7.3"])
      .range(from, to),
  );
  for (const r of legs) add(r.numero_factura, r.numero_orden, reconstruirBcv(r.monto_bs, r.tasa_bcv), r.fecha ?? null);

  // Pasivo de servicio (bono 10%), solo tipo "bono" -- la propina NO forma
  // parte del "Total Venta" que reporta Xetux y se excluye a propósito.
  // bono10_propina no guarda su propia tasa_bcv, así que se toma la de la
  // transacción 8.1 enlazada (transaccion_entrada_id), que sí la guarda.
  const bonos = await fetchAllRows<any>((from, to) =>
    supabase
      .from("bono10_propina")
      .select("numero_factura, numero_orden, monto_bs, fecha, tipo, transaccion_entrada_id")
      .eq("tipo", "bono")
      .range(from, to),
  );
  const txIdsBono = Array.from(new Set(bonos.map((b: any) => b.transaccion_entrada_id).filter(Boolean)));
  const tasaBcvPorTxId = new Map<string, number>();
  const CHUNK_BONO = 500;
  for (let i = 0; i < txIdsBono.length; i += CHUNK_BONO) {
    const lote = txIdsBono.slice(i, i + CHUNK_BONO);
    const { data } = await supabase.from("transacciones").select("id, tasa_bcv").in("id", lote);
    for (const t of data ?? []) tasaBcvPorTxId.set((t as any).id, Number((t as any).tasa_bcv) || 0);
  }
  for (const r of bonos) {
    const tasaBcv = r.transaccion_entrada_id ? tasaBcvPorTxId.get(r.transaccion_entrada_id) ?? 0 : 0;
    add(r.numero_factura, r.numero_orden, reconstruirBcv(r.monto_bs, tasaBcv), r.fecha ?? null);
  }

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
  // La fecha no vive en cuentas_por_pagar -- se busca aparte en la
  // transaccion vinculada (transaccion_id) y se cruza en memoria.
  const cxps = await fetchAllRows<any>((from, to) =>
    supabase
      .from("cuentas_por_pagar")
      .select("numero_factura, monto_usd, transaccion_id")
      .not("numero_factura", "is", null)
      .range(from, to),
  );
  const txIds = Array.from(new Set(cxps.map((r: any) => r.transaccion_id).filter(Boolean)));
  const fechaPorTxId = new Map<string, string>();
  const CHUNK = 500;
  for (let i = 0; i < txIds.length; i += CHUNK) {
    const lote = txIds.slice(i, i + CHUNK);
    const { data } = await supabase.from("transacciones").select("id, fecha").in("id", lote);
    for (const t of data ?? []) fechaPorTxId.set((t as any).id, (t as any).fecha ?? null);
  }

  for (const r of cxps) {
    if (!r.numero_factura) continue;
    const key = `F:${r.numero_factura}`;
    const fecha = r.transaccion_id ? fechaPorTxId.get(r.transaccion_id) ?? null : null;
    const prev = map.get(key);
    if (prev) {
      prev.totalUsd += Number(r.monto_usd) || 0;
      if (!prev.fecha && fecha) prev.fecha = fecha;
    } else {
      map.set(key, { totalUsd: Number(r.monto_usd) || 0, fecha, aproximado: false });
    }
  }

  // Camino de respaldo: compras off-balance, que no generan CxP. Igual que
  // en ventas, monto_usd aquí está en tasa paralela -- se reconstruye a BCV
  // con monto_bs / tasa_bcv (guardada en la misma fila). Solo si esa tasa
  // faltara se cae de último recurso a monto_usd (paralela) y se marca como
  // aproximado.
  const legs = await fetchAllRows<any>((from, to) =>
    supabase
      .from("transacciones")
      .select("numero_factura, numero_orden, monto_bs, monto_usd, tasa_bcv, fecha, cuenta_codigo")
      .in("referencia", ["xetux", "manual"])
      .in("cuenta_codigo", ["2.1", "7.4"])
      .not("numero_factura", "is", null)
      .range(from, to),
  );
  const legSums = new Map<string, { total: number; fecha: string | null; aproximado: boolean }>();
  for (const r of legs) {
    const key = `F:${r.numero_factura}`;
    const tasaBcv = Number(r.tasa_bcv) || 0;
    const aproximado = tasaBcv <= 0;
    const monto = tasaBcv > 0 ? (Number(r.monto_bs) || 0) / tasaBcv : Number(r.monto_usd) || 0;
    const prev = legSums.get(key);
    if (prev) {
      prev.total += monto;
      prev.aproximado = prev.aproximado || aproximado;
      if (!prev.fecha) prev.fecha = r.fecha ?? null;
    } else {
      legSums.set(key, { total: monto, fecha: r.fecha ?? null, aproximado });
    }
  }
  for (const [key, v] of legSums) {
    if (!map.has(key)) map.set(key, { totalUsd: v.total, fecha: v.fecha, aproximado: v.aproximado });
  }

  return map;
}

// ───────────────────────────── Resultado de auditoría ─────────────────────────────

export type ResumenMensual = {
  mes: string; // "2026-05"
  totalXetux: number;
  totalSistema: number;
  diffUsd: number;
  docsXetux: number;
  docsSistema: number;
};

export type AuditResultado<T> = {
  faltantes: T[];
  discrepancias: Array<{ xetux: T; totalSistema: number; diffUsd: number; aproximado: boolean }>;
  sinCambios: number;
  anuladas: Array<{ key: string; numero: string; totalSistema: number; fecha: string | null; aproximado: boolean }>;
  porMes: ResumenMensual[];
};

const mesDe = (fecha: string | null): string | null => (fecha ? fecha.slice(0, 7) : null);

/**
 * Compara, mes por mes, el total que trae el archivo de Xetux contra el
 * total que ya tiene el sistema para ese mismo mes -- independiente de si
 * cada documento individual coincidió, quedó como discrepancia o no se
 * encontró. Un mes con totalXetux=0 normalmente significa que el archivo
 * subido no cubre ese mes (no que todo lo de ese mes se haya anulado).
 */
function resumenMensual<T extends { fecha: string; total_usd: number }>(
  rows: T[],
  sistema: Map<string, SistemaDoc>,
): ResumenMensual[] {
  const agg = new Map<string, { totalXetux: number; totalSistema: number; docsXetux: number; docsSistema: number }>();
  const get = (mes: string) => {
    let e = agg.get(mes);
    if (!e) { e = { totalXetux: 0, totalSistema: 0, docsXetux: 0, docsSistema: 0 }; agg.set(mes, e); }
    return e;
  };
  for (const r of rows) {
    const mes = mesDe(r.fecha);
    if (!mes) continue;
    const e = get(mes);
    e.totalXetux += r.total_usd;
    e.docsXetux++;
  }
  for (const doc of sistema.values()) {
    const mes = mesDe(doc.fecha);
    if (!mes) continue;
    const e = get(mes);
    e.totalSistema += doc.totalUsd;
    e.docsSistema++;
  }
  return Array.from(agg.entries())
    .map(([mes, v]) => ({ mes, ...v, diffUsd: +(v.totalXetux - v.totalSistema).toFixed(2) }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

const TOLERANCIA_USD = (total: number) => Math.max(0.5, total * 0.01);

/**
 * Rango de fechas que realmente cubre el archivo subido. El usuario puede
 * subir un acumulado PARCIAL (p.ej. solo mayo-octubre), así que un documento
 * del sistema fechado ANTES o DESPUÉS de ese rango simplemente no podía
 * aparecer en el archivo -- eso no significa que Xetux lo haya anulado. Sin
 * este filtro, cualquier carga que no cubra TODO el histórico marca como
 * "posiblemente anulado" prácticamente todo lo que quedó fuera de rango.
 */
function rangoFechas(rows: Array<{ fecha: string }>): { min: string; max: string } | null {
  const fechas = rows.map((r) => r.fecha).filter((f): f is string => !!f).sort();
  if (!fechas.length) return null;
  return { min: fechas[0], max: fechas[fechas.length - 1] };
}

function dentroDelRango(fecha: string | null, rango: { min: string; max: string } | null): boolean {
  if (!rango) return true; // no se pudo determinar el rango del archivo: no filtrar, mejor pecar de mostrar de más
  if (!fecha) return false; // no se pudo determinar la fecha del documento en el sistema: no se puede asegurar que esté en rango
  return fecha >= rango.min && fecha <= rango.max;
}

export async function auditarVentas(rows: AuditVentaRow[]): Promise<AuditResultado<AuditVentaRow>> {
  const sistema = await cargarVentasSistema();
  const rango = rangoFechas(rows);
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
    if (!dentroDelRango(doc.fecha, rango)) continue;
    anuladas.push({ key, numero: key.slice(2), totalSistema: doc.totalUsd, fecha: doc.fecha, aproximado: doc.aproximado });
  }

  const porMes = resumenMensual(rows, sistema);
  return { faltantes, discrepancias, sinCambios, anuladas, porMes };
}

export async function auditarCompras(rows: AuditCompraRow[]): Promise<AuditResultado<AuditCompraRow>> {
  const sistema = await cargarComprasSistema();
  const rango = rangoFechas(rows);
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
    if (!dentroDelRango(doc.fecha, rango)) continue;
    anuladas.push({ key, numero: key.slice(2), totalSistema: doc.totalUsd, fecha: doc.fecha, aproximado: doc.aproximado });
  }

  const porMes = resumenMensual(rows, sistema);
  return { faltantes, discrepancias, sinCambios, anuladas, porMes };
}
