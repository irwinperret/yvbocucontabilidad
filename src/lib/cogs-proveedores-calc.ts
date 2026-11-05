import { MESES } from "@/lib/account-helpers";
import type { UsdViewMode } from "@/lib/usd-view-context";
import { calcularTotalesMes, type Row as RowGyP } from "@/lib/resumen-mensual-calc";

/**
 * COGS / Compras en Detalle por Proveedor.
 *
 * Esta pantalla trabaja con la cuenta 2.1 ("Insumos materia prima" /
 * Compras) directo de `transacciones`, NO con la vista mensual que usan
 * G&P / Egresos en Detalle -- esa vista agrupa por `afecta_gyp` y a
 * propósito excluye la 2.1 (ver comentario en egresos-detalle.tsx): la
 * compra todavía no es un gasto, es inventario, hasta que el cierre de mes
 * la convierte en COGS real (cuenta 2.2) según cuánto se consumió. Por eso
 * esta pantalla distingue dos cosas que pueden divergir bastante en un mes
 * dado (como pasó en octubre 2026):
 *   - "Compras" (2.1): lo que se pagó/facturó ese mes, con detalle por
 *     proveedor -- lo que responde "¿a quién le compramos y cuánto?".
 *   - "COGS real" (2.2, vía la vista mensual): lo que realmente se
 *     consumió ese mes según el inventario -- no tiene detalle por
 *     proveedor (es un solo ajuste contable), pero es la cifra correcta
 *     para medir eficiencia contra las ventas.
 */

export const CUENTA_COMPRAS = "2.1";

export type CompraRaw = {
  fecha: string;
  monto_bs: number | string | null;
  monto_base_bs: number | string | null;
  monto_usd: number | string | null;
  tasa_bcv: number | string | null;
  tasa_paralela: number | string | null;
  tercero_id: string | null;
  referencia: string | null;
};

export type Tercero = { id: string; nombre_comercial: string | null; razon_social: string | null };

export function nombreProveedor(t: Tercero | null | undefined): string {
  if (!t) return "Proveedor sin nombre";
  return t.nombre_comercial || t.razon_social || "Proveedor sin nombre";
}

/** tercero_id -> nombre para mostrar, a partir de la tabla terceros completa. */
export function construirNombrePorTerceroId(terceros: Tercero[]): Map<string, string> {
  return new Map(terceros.map((t) => [t.id, nombreProveedor(t)]));
}

/** nombre -> tercero_id, SOLO cuando ese nombre identifica un único proveedor
 * (para poder enlazar a /proveedores/$id sin ambigüedad). Si dos terceros
 * distintos comparten nombre comercial, ese nombre queda sin link. */
export function construirNombreATerceroId(terceros: Tercero[]): Map<string, string | null> {
  const porNombre = new Map<string, Set<string>>();
  terceros.forEach((t) => {
    const nombre = nombreProveedor(t);
    const set = porNombre.get(nombre) ?? new Set<string>();
    set.add(t.id);
    porNombre.set(nombre, set);
  });
  const out = new Map<string, string | null>();
  porNombre.forEach((ids, nombre) => out.set(nombre, ids.size === 1 ? (Array.from(ids)[0] ?? null) : null));
  return out;
}

export type OrigenCompra = "xetux" | "banco" | "manual";

/** Mismo criterio que registrar.tsx / cierres-de-mes.tsx para clasificar el
 * origen de una compra según su referencia. */
export function origenDeCompra(referencia: string | null | undefined): OrigenCompra {
  const r = String(referencia ?? "");
  if (r.startsWith("BANK:")) return "banco";
  if (r === "xetux" || r === "xetux-iva") return "xetux";
  return "manual";
}

/** Mismo criterio que comprasNetoDelPeriodo (cierre-mes.ts): neto = monto_base_bs
 * si existe, si no monto_bs; USD = neto / tasa del modo activo (su propia tasa
 * del día, no un promedio), con fallback a monto_usd si no hay tasa. Así los
 * totales de esta pantalla cuadran exacto con el COGS/Compras que ya se ve en
 * Cierres de Mes y Registrar → COGS e Inventario. */
export function usdCompra(c: CompraRaw, mode: UsdViewMode): number {
  const neto = Number(c.monto_base_bs) || Number(c.monto_bs) || 0;
  const tasa = mode === "bcv" ? Number(c.tasa_bcv) || 0 : Number(c.tasa_paralela) || 0;
  if (tasa > 0) return Number((neto / tasa).toFixed(2));
  return Number(c.monto_usd) || 0;
}

/** Total de compras (todos los proveedores) por mes, Ene a mesCorte -- el
 * insumo que necesita construirSerieCostoUnitario para "Compras / $ vendido". */
export function totalComprasPorMes(compras: CompraRaw[], mesCorte: number, mode: UsdViewMode): number[] {
  const totales = new Array(mesCorte).fill(0) as number[];
  compras.forEach((c) => {
    const mes = Number(c.fecha.slice(5, 7));
    if (mes >= 1 && mes <= mesCorte) totales[mes - 1] = Number((totales[mes - 1] + usdCompra(c, mode)).toFixed(2));
  });
  return totales;
}

export type ProveedorMes = {
  nombre: string;
  usd: number;
  n: number;
  usdXetux: number;
  usdBanco: number;
  usdManual: number;
};

/** Compras de un mes, agrupadas por proveedor (por nombre, no por id -- así
 * dos terceros con el mismo nombre comercial se ven como uno solo). */
export function agruparPorProveedorMes(
  compras: CompraRaw[],
  nombrePorTerceroId: Map<string, string>,
  mes: number,
  mode: UsdViewMode,
): ProveedorMes[] {
  const map = new Map<string, ProveedorMes>();
  compras.forEach((c) => {
    if (Number(c.fecha.slice(5, 7)) !== mes) return;
    const nombre = c.tercero_id ? (nombrePorTerceroId.get(c.tercero_id) ?? "Proveedor sin nombre") : "Sin proveedor asignado";
    const usd = usdCompra(c, mode);
    const origen = origenDeCompra(c.referencia);
    const e = map.get(nombre) ?? { nombre, usd: 0, n: 0, usdXetux: 0, usdBanco: 0, usdManual: 0 };
    e.usd = Number((e.usd + usd).toFixed(2));
    e.n += 1;
    if (origen === "xetux") e.usdXetux = Number((e.usdXetux + usd).toFixed(2));
    else if (origen === "banco") e.usdBanco = Number((e.usdBanco + usd).toFixed(2));
    else e.usdManual = Number((e.usdManual + usd).toFixed(2));
    map.set(nombre, e);
  });
  return Array.from(map.values()).sort((a, b) => b.usd - a.usd);
}

export type FilaRanking = ProveedorMes & { pct: number; variacionPct: number | null; terceroId: string | null };

/** Ranking de proveedores de un mes, con % de incidencia sobre el total del
 * mes y variación vs. el mes anterior (solo si el mes anterior cae en el
 * mismo año consultado -- para el cruce de año se deja "—", no vale la pena
 * la complejidad de traer otro año solo para esa comparación). */
export function rankingProveedoresMes(
  compras: CompraRaw[],
  nombrePorTerceroId: Map<string, string>,
  nombreATerceroId: Map<string, string | null>,
  mes: number,
  mode: UsdViewMode,
): FilaRanking[] {
  const filas = agruparPorProveedorMes(compras, nombrePorTerceroId, mes, mode);
  const total = filas.reduce((s, f) => s + f.usd, 0);
  const anterior = mes > 1
    ? new Map(agruparPorProveedorMes(compras, nombrePorTerceroId, mes - 1, mode).map((f) => [f.nombre, f.usd]))
    : new Map<string, number>();
  return filas.map((f) => {
    const prev = anterior.get(f.nombre);
    return {
      ...f,
      pct: total > 0 ? Number(((f.usd / total) * 100).toFixed(1)) : 0,
      variacionPct: prev != null && prev > 0.01 ? Number((((f.usd - prev) / prev) * 100).toFixed(1)) : null,
      terceroId: nombreATerceroId.get(f.nombre) ?? null,
    };
  });
}

export type FilaCostoUnitario = { mesLabel: string; comprasPorDolar: number | null; cogsPorDolar: number | null; ingresos: number };

/** "Costo variable por dólar vendido": cuántos centavos de Compras y de COGS
 * real salieron por cada dólar de ingreso del mes. Compras y COGS casi
 * siempre se mueven juntos, pero pueden separarse justo cuando conviene
 * mirarlos por separado -- por ejemplo si se compra más de lo que se
 * consume ese mes (inventario sube), Compras/$ sube sin que COGS/$ lo haga,
 * y esa separación es la señal de que el margen "real" del mes no se vio
 * afectado, solo se compró por adelantado. */
export function construirSerieCostoUnitario(
  comprasPorMes: number[],
  rowsGyP: RowGyP[],
  grupoDe: Map<string, string>,
  cogsEstimadoPorMes: Map<string, { cogsUsdBcv: number; cogsUsdParalelo: number }> | undefined,
  anio: number,
  mesCorte: number,
  mode: UsdViewMode,
): FilaCostoUnitario[] {
  return Array.from({ length: mesCorte }, (_, i) => {
    const { t } = calcularTotalesMes(rowsGyP, grupoDe, i + 1, cogsEstimadoPorMes, anio, mode);
    const ing = t["Ingresos"] ?? 0;
    const cogs = t["COGS"] ?? 0;
    const compras = comprasPorMes[i] ?? 0;
    return {
      mesLabel: MESES[i],
      comprasPorDolar: ing > 0 ? Number((compras / ing).toFixed(3)) : null,
      cogsPorDolar: ing > 0 ? Number((cogs / ing).toFixed(3)) : null,
      ingresos: ing,
    };
  });
}

export type FilaTopMensual = {
  mesLabel: string;
  total: number;
  otros: number;
  cogsPorDolar: number | null;
  top1Usd: number; top1Nombre: string | null;
  top2Usd: number; top2Nombre: string | null;
  top3Usd: number; top3Nombre: string | null;
  top4Usd: number; top4Nombre: string | null;
  top5Usd: number; top5Nombre: string | null;
};

/** Serie mensual para el gráfico apilado: en CADA mes, los `topN` proveedores
 * que más compraron ESE mes (no acumulado del año -- el top 5 puede cambiar
 * de un mes a otro), el resto agrupado en "Otros", y el COGS real por dólar
 * vendido de ese mismo mes (de `costoUnitario`, ya calculado aparte) para
 * verlo junto a la concentración de compras. Como el proveedor de cada color
 * cambia mes a mes, esta pantalla no usa una leyenda fija -- cada barra lleva
 * su propio nombre en top{n}Nombre para que el tooltip lo muestre al hacer
 * hover. */
export function construirSerieTopMensual(
  compras: CompraRaw[],
  nombrePorTerceroId: Map<string, string>,
  costoUnitario: FilaCostoUnitario[],
  mesCorte: number,
  mode: UsdViewMode,
  topN = 5,
): FilaTopMensual[] {
  return Array.from({ length: mesCorte }, (_, i) => {
    const mes = i + 1;
    // agruparPorProveedorMes ya devuelve ordenado desc por usd.
    const porProv = agruparPorProveedorMes(compras, nombrePorTerceroId, mes, mode);
    const top = porProv.slice(0, topN);
    const resto = porProv.slice(topN);
    const total = Number(porProv.reduce((s, p) => s + p.usd, 0).toFixed(2));
    const otros = Number(resto.reduce((s, p) => s + p.usd, 0).toFixed(2));
    const fila = {
      mesLabel: MESES[i],
      total,
      otros,
      cogsPorDolar: costoUnitario[i]?.cogsPorDolar ?? null,
    } as FilaTopMensual;
    for (let k = 0; k < topN; k++) {
      (fila as any)[`top${k + 1}Usd`] = top[k]?.usd ?? 0;
      (fila as any)[`top${k + 1}Nombre`] = top[k]?.nombre ?? null;
    }
    return fila;
  });
}

/** Color único y estable por proveedor (hash del nombre -> hue), en vez de
 * un color fijo por posición del ranking -- antes "top1" siempre era el
 * mismo color sin importar quién fuera ese mes, lo que confundía porque un
 * mismo proveedor cambiaba de color de un mes a otro (y dos proveedores
 * distintos en el mismo puesto se veían "iguales"). Saturación/luminosidad
 * fijas para que se lea bien en ambos temas. */
export function colorParaProveedor(nombre: string): string {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) hash = (hash * 31 + nombre.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 62%, 42%)`;
}

export const COLOR_OTROS_PROVEEDOR = "#9CA3AF";
