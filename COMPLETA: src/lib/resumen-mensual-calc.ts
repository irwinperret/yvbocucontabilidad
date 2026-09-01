import { MESES } from "@/lib/account-helpers";
import { ajusteCogsEstimado } from "@/lib/cierre-mes";

export type Cuenta = { codigo: string; nombre: string; grupo: string };
export type Row = { periodo: string; anio: number; mes: number; cuenta_codigo: string; modo: string; base_usd: number };

/** Categorías grandes en el orden en que se presentan en el informe. */
export const CATEGORIAS = [
  "Ingresos",
  "COGS",
  "Costos Fijos",
  "Costos Variables (operativos)",
  "Financiamiento",
  "Otros",
  "Impuestos",
] as const;

// Ingresos en verde; TODO lo demás (egresos) en distintos tonos de rojo,
// para que de un vistazo se distinga claramente qué entra vs. qué sale.
export const COLOR_CAT: Record<string, string> = {
  Ingresos: "#0F6E56",
  COGS: "#7F1D1D",
  "Costos Fijos": "#B91C1C",
  "Costos Variables (operativos)": "#DC2626",
  Financiamiento: "#EF4444",
  Otros: "#F87171",
  Impuestos: "#FCA5A5",
};

export function grupoDeCuentas(cuentas: Cuenta[] | undefined) {
  const m = new Map<string, string>();
  (cuentas ?? []).forEach((c) => m.set(c.codigo, c.grupo));
  return m;
}

/** Totales por categoría grande para un mes dado, con COGS estimado si el mes está abierto. */
export function calcularTotalesMes(
  rows: Row[],
  grupoDe: Map<string, string>,
  m: number,
  estimados: Map<string, { cogsUsdBcv: number }> | undefined,
  y: number,
) {
  const t: Record<string, number> = {};
  CATEGORIAS.forEach((c) => (t[c] = 0));
  rows.filter((r) => r.mes === m).forEach((r) => {
    const g = grupoDe.get(r.cuenta_codigo);
    if (!g || !(g in t)) return;
    t[g] += Number(r.base_usd) || 0;
  });
  const { ajuste, mesesEstimados } = ajusteCogsEstimado(rows, estimados, y, [m]);
  t["COGS"] += ajuste;
  return { t, estimado: mesesEstimados.length > 0 };
}

/** ¿Este mes no tuvo ninguna operación registrada (todas las categorías en 0)? */
export function mesSinOperaciones(t: Record<string, number>) {
  return CATEGORIAS.every((c) => Math.abs(t[c] ?? 0) < 0.01);
}

export const pct = (actual: number, previo: number) =>
  previo > 0 ? ((actual - previo) / previo) * 100 : null;

export function frase(nombre: string, actual: number, prevMes: number, labelPrevMes: string, prevAnio: number | null, labelPrevAnio: string, fmtUsd: (n: number) => string) {
  const pm = pct(actual, prevMes);
  const pa = prevAnio != null ? pct(actual, prevAnio) : null;
  let t = `${nombre} de **${fmtUsd(actual)}**`;
  if (pm != null) t += `, un **${Math.abs(pm).toFixed(1)}%** ${pm >= 0 ? "más" : "menos"} que ${labelPrevMes} (${fmtUsd(prevMes)})`;
  else t += `, sin cifra comparable en ${labelPrevMes}`;
  if (pa != null) t += ` y un **${Math.abs(pa).toFixed(1)}%** ${pa >= 0 ? "más" : "menos"} que ${labelPrevAnio} (${fmtUsd(prevAnio as number)})`;
  return t + ".";
}

type Estimados = Map<string, { cogsUsdBcv: number }> | undefined;

/** Serie mensual del año para el gráfico de categorías — nunca más allá del mes de corte. */
export function construirSerieCategorias(rowsAnio: Row[], grupoDe: Map<string, string>, cogsEstimadoPorMes: Estimados, anio: number, mesCorte: number) {
  return Array.from({ length: mesCorte }, (_, i) => {
    const { t } = calcularTotalesMes(rowsAnio, grupoDe, i + 1, cogsEstimadoPorMes, anio);
    const gastos = CATEGORIAS.filter((c) => c !== "Ingresos").reduce((s, c) => s + t[c], 0);
    return {
      mesLabel: MESES[i],
      ...Object.fromEntries(CATEGORIAS.map((c) => [c, Number((c === "Ingresos" ? t[c] : -t[c]).toFixed(2))])),
      utilidad: Number((t["Ingresos"] - gastos).toFixed(2)),
    } as any;
  });
}

/** Márgenes operativos (%) mes a mes. Meses sin ingresos quedan en null (no
 * se dibujan como una caída artificial a 0%; Recharts con connectNulls salta
 * el hueco en vez de conectarlo como si fuera un cero real). */
export function construirSerieMargenes(rowsAnio: Row[], grupoDe: Map<string, string>, cogsEstimadoPorMes: Estimados, anio: number, mesCorte: number) {
  return Array.from({ length: mesCorte }, (_, i) => {
    const { t } = calcularTotalesMes(rowsAnio, grupoDe, i + 1, cogsEstimadoPorMes, anio);
    const gastos = CATEGORIAS.filter((c) => c !== "Ingresos").reduce((s, c) => s + t[c], 0);
    const ing = t["Ingresos"] ?? 0;
    const margenBrutoPct = ing > 0 ? +(((ing - t["COGS"]) / ing) * 100).toFixed(1) : null;
    const utilidadNetaPct = ing > 0 ? +(((ing - gastos) / ing) * 100).toFixed(1) : null;
    return { mesLabel: MESES[i], margenBrutoPct, utilidadNetaPct };
  });
}

/** Comparativo mensual: Enero hasta el mes de corte — nunca meses posteriores. */
export function construirComparativoMensual(rowsAnio: Row[], grupoDe: Map<string, string>, cogsEstimadoPorMes: Estimados, anio: number, mesCorte: number) {
  return Array.from({ length: mesCorte }, (_, i) => {
    const m = i + 1;
    const { t, estimado } = calcularTotalesMes(rowsAnio, grupoDe, m, cogsEstimadoPorMes, anio);
    const gastos = CATEGORIAS.filter((c) => c !== "Ingresos").reduce((s, c) => s + t[c], 0);
    return { mesLabel: MESES[m - 1], t, estimado, utilidad: t["Ingresos"] - gastos, sinOperaciones: mesSinOperaciones(t) };
  });
}

/** Desglose G&P del mes por cuenta dentro de cada categoría. */
export function construirDesglose(rowsAnio: Row[], cuentas: Cuenta[] | undefined, mes: number, actual: { t: Record<string, number>; estimado: boolean }) {
  const porCuenta = new Map<string, number>();
  rowsAnio.filter((r) => r.mes === mes).forEach((r) => {
    porCuenta.set(r.cuenta_codigo, (porCuenta.get(r.cuenta_codigo) ?? 0) + (Number(r.base_usd) || 0));
  });
  return CATEGORIAS.map((cat) => {
    const items = (cuentas ?? [])
      .filter((c) => c.grupo === cat && Math.abs(porCuenta.get(c.codigo) ?? 0) > 0.009)
      .map((c) => ({ codigo: c.codigo, nombre: c.nombre, total: porCuenta.get(c.codigo) ?? 0 }));
    if (cat === "COGS" && actual.estimado) {
      const yaSumado = items.reduce((s, i) => s + i.total, 0);
      const dif = actual.t["COGS"] - yaSumado;
      if (Math.abs(dif) > 0.009) items.push({ codigo: "2.2*", nombre: "Ajuste estimado (mes abierto)", total: dif });
    }
    return { cat, items, subtotal: items.reduce((s, i) => s + i.total, 0) };
  }).filter((g) => g.items.length > 0);
}

/** Saldo de CxP pendiente al cierre de un mes (según el modo USD), y el cambio vs. el mes anterior. */
export function calcularCxpSaldos(cxp: any[] | undefined, anio: number, mes: number, mesAnterior: number, anioMesAnterior: number, mode: "bcv" | "paralela") {
  const valor = (c: any) => {
    const v = mode === "bcv" ? c.usd_bcv_factura : c.usd_paralelo_factura;
    return Number(v ?? c.monto_usd) || 0;
  };
  const saldoAl = (y: number, m: number) => {
    const corte = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString();
    return (cxp ?? [])
      .filter((c) => String(c.created_at) < corte && (!c.pagada_at || String(c.pagada_at) >= corte))
      .reduce((s, c) => s + valor(c), 0);
  };
  const hoySaldo = saldoAl(anio, mes);
  const prevSaldo = saldoAl(anioMesAnterior, mesAnterior);
  return { hoySaldo, prevSaldo, cambio: hoySaldo - prevSaldo };
}

/** Pago de préstamos (capital + intereses juntos, sin desglosar) y
 * dividendos repartidos en el mes — cuentas 5.2/5.3 y 5.4 específicamente. */
export function calcularPrestamosYDividendos(rowsAnio: Row[], mes: number) {
  const pagoPrestamos = rowsAnio
    .filter((r) => r.mes === mes && (r.cuenta_codigo === "5.2" || r.cuenta_codigo === "5.3"))
    .reduce((s, r) => s + (Number(r.base_usd) || 0), 0);
  const dividendos = rowsAnio
    .filter((r) => r.mes === mes && r.cuenta_codigo === "5.4")
    .reduce((s, r) => s + (Number(r.base_usd) || 0), 0);
  return { pagoPrestamos, dividendos };
}

/** Formato monetario contable: negativos entre paréntesis, ej. ($1,574.54). */
export function fmtUsdContable(fmtUsd: (n: number) => string, n: number) {
  if (n < -0.004) return `(${fmtUsd(Math.abs(n)).replace("$ ", "$")})`;
  return fmtUsd(n);
}
