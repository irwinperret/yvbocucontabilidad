import { MESES } from "@/lib/account-helpers";
import type { UsdViewMode } from "@/lib/usd-view-context";
import { ajusteCogsEstimado } from "@/lib/cierre-mes";
import {
  CATEGORIAS, COLOR_CAT, calcularTotalesMes,
  type Cuenta as CuentaGyP, type Row as RowGyP,
} from "@/lib/resumen-mensual-calc";

// Reutiliza exactamente la misma categorización (y el mismo ajuste de COGS
// estimado para meses abiertos) que ya usan G&P y Resumen IPA Mensual — así
// "Egresos en Detalle" nunca queda desalineado con esas pantallas.

export type CategoriaEgreso = Exclude<(typeof CATEGORIAS)[number], "Ingresos">;
export const CATEGORIAS_EGRESO = CATEGORIAS.filter((c) => c !== "Ingresos") as CategoriaEgreso[];
export const COLOR_EGRESO: Record<CategoriaEgreso, string> = COLOR_CAT as Record<CategoriaEgreso, string>;

export type RowEgreso = RowGyP;
export type CuentaEgreso = CuentaGyP;
export type EstimadosCogs = Map<string, { cogsUsdBcv: number; cogsUsdParalelo: number }> | undefined;

export type TotalesEgresosMes = Record<CategoriaEgreso, number> & { total: number; cogsEstimado: boolean };

export function calcularTotalesEgresosMes(
  rows: RowEgreso[],
  grupoDe: Map<string, string>,
  mes: number,
  cogsEstimadoPorMes: EstimadosCogs,
  anio: number,
  mode: UsdViewMode,
): TotalesEgresosMes {
  const { t, estimado } = calcularTotalesMes(rows, grupoDe, mes, cogsEstimadoPorMes, anio, mode);
  const out = { cogsEstimado: estimado, total: 0 } as TotalesEgresosMes;
  CATEGORIAS_EGRESO.forEach((c) => {
    const v = Number((t[c] ?? 0).toFixed(2));
    (out as any)[c] = v;
    out.total += v;
  });
  out.total = Number(out.total.toFixed(2));
  return out;
}

/** Serie mensual del año para el gráfico y la tabla — nunca más allá del mes de corte. */
export function construirSerieEgresos(
  rowsAnio: RowEgreso[],
  grupoDe: Map<string, string>,
  cogsEstimadoPorMes: EstimadosCogs,
  anio: number,
  mesCorte: number,
  mode: UsdViewMode,
) {
  return Array.from({ length: mesCorte }, (_, i) => {
    const t = calcularTotalesEgresosMes(rowsAnio, grupoDe, i + 1, cogsEstimadoPorMes, anio, mode);
    return { mesLabel: MESES[i], ...t };
  });
}

export type FilaDesgloseEgreso = { codigo: string; nombre: string; categoria: string; total: number };

/** Desglose por cuenta del mes seleccionado, agrupado por categoría (mismo
 * orden que CATEGORIAS_EGRESO). Incluye la fila fantasma del ajuste de COGS
 * estimado (si el mes está abierto), igual que hace G&P, para que esta tabla
 * sume lo mismo que el KPI de COGS de arriba. */
export function construirDesgloseEgresos(
  rowsAnio: RowEgreso[],
  cuentas: CuentaEgreso[] | undefined,
  mes: number,
  cogsEstimadoPorMes: EstimadosCogs,
  anio: number,
  mode: UsdViewMode,
): FilaDesgloseEgreso[] {
  const porCuenta = new Map<string, number>();
  rowsAnio.filter((r) => r.mes === mes).forEach((r) => {
    porCuenta.set(r.cuenta_codigo, (porCuenta.get(r.cuenta_codigo) ?? 0) + (Number(r.base_usd) || 0));
  });

  const cuentasEgreso = (cuentas ?? []).filter((c) => (CATEGORIAS_EGRESO as string[]).includes(c.grupo));
  const filas: FilaDesgloseEgreso[] = cuentasEgreso
    .map((c) => ({ codigo: c.codigo, nombre: c.nombre, categoria: c.grupo, total: porCuenta.get(c.codigo) ?? 0 }))
    .filter((f) => Math.abs(f.total) > 0.009);

  const { ajuste } = ajusteCogsEstimado(rowsAnio, cogsEstimadoPorMes, anio, [mes], mode);
  if (Math.abs(ajuste) > 0.009) {
    filas.push({ codigo: "2.2*", nombre: "Ajuste estimado (mes abierto, por inventario)", categoria: "COGS", total: ajuste });
  }

  const orden = (cat: string) => CATEGORIAS_EGRESO.indexOf(cat as CategoriaEgreso);
  filas.sort((a, b) => (orden(a.categoria) - orden(b.categoria)) || a.codigo.localeCompare(b.codigo));
  return filas;
}
