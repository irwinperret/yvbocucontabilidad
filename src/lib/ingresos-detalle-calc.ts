import { MESES } from "@/lib/account-helpers";
import type { UsdViewMode } from "@/lib/usd-view-context";

/** Fila cruda de `transacciones` (no la vista agregada) — necesitamos
 * `referencia` fila por fila para separar los ajustes de venta lista, algo
 * que v_transacciones_mensual(_bcv) no conserva porque agrupa. */
export type RowIngresoRaw = {
  fecha: string;
  cuenta_codigo: string;
  modo: "on_balance" | "off_balance";
  referencia: string | null;
  notas: string | null;
  monto_bs: number | null;
  monto_base_bs: number | null;
  monto_usd: number | null;
  tasa_bcv: number | null;
};

/** Referencia que usa "Importar ajustes ventas" (importar-ajustes.tsx) al
 * insertar sus filas — es la forma real de identificar un ajuste de venta
 * lista, no la cuenta contable (cae en 1.1/1.2, mezclado con ventas normales). */
export const REF_AJUSTE_VENTA_LISTA = "ajuste";

/** Cuentas de "ventas comunes": lo que efectivamente se vendió (contado YV,
 * contado Bocú, contado YV Market, a crédito) más descuentos y devoluciones
 * sobre esas ventas. Los ajustes de venta lista NO entran aquí aunque caigan
 * en 1.1/1.2 — se identifican y separan por `referencia`, no por cuenta. */
export const CUENTAS_VENTAS_COMUNES = ["1.1", "1.2", "1.3", "1.4", "1.6", "1.7"];

/** "Importar ajustes ventas" solo escribe ingresos en 1.1 y 1.2 (el 3.1 de
 * Servicio Lista es gasto de nómina, no ingreso, y no se cuenta aquí). */
const CUENTAS_AJUSTE_INGRESO = ["1.1", "1.2"];

/** "Ingresos (Neto) Ops IVA": normalmente $0 — el IVA cobrado se contabiliza
 * como pasivo transitorio con el SENIAT (cuenta 7.3), no como ingreso. */
export const CUENTAS_IVA_INGRESO = ["1.8"];

const mesDeFecha = (fecha: string) => Number(fecha.slice(5, 7));

/** Replica, fila por fila, la fórmula de `base_usd` de
 * v_transacciones_mensual / v_transacciones_mensual_bcv (ver migración
 * 20260811193253), para poder separar ajustes por `referencia` sin perder
 * la conversión BCV/paralela que usa el resto de la app. */
export function baseUsdFila(r: RowIngresoRaw, mode: UsdViewMode): number {
  if (r.cuenta_codigo === "13.2" || /^pago cxp/i.test(r.notas ?? "")) return 0;
  const bs = Number(r.monto_bs) || 0;
  if (bs === 0) return 0;
  const baseBs = Number(r.monto_base_bs ?? r.monto_bs) || 0;
  if (mode === "bcv") {
    const tasa = Number(r.tasa_bcv) || 0;
    return tasa ? baseBs / tasa : 0;
  }
  const usd = Number(r.monto_usd) || 0;
  return usd * (baseBs / bs);
}

export function esAjusteVentaLista(r: RowIngresoRaw): boolean {
  return r.referencia === REF_AJUSTE_VENTA_LISTA && CUENTAS_AJUSTE_INGRESO.includes(r.cuenta_codigo);
}

function filasDelMes(rows: RowIngresoRaw[], mes: number, incluirOff: boolean) {
  return rows.filter((r) => mesDeFecha(r.fecha) === mes && (incluirOff || r.modo === "on_balance"));
}

export type TotalesIngresosMes = {
  ventasComunes: number;
  ajustes: number;
  ingresosIva: number;
  total: number;
};

export function calcularTotalesIngresosMes(
  rowsAnio: RowIngresoRaw[],
  mes: number,
  mode: UsdViewMode,
  incluirOff: boolean,
): TotalesIngresosMes {
  let ventasComunes = 0, ajustes = 0, ingresosIva = 0;
  for (const r of filasDelMes(rowsAnio, mes, incluirOff)) {
    const v = baseUsdFila(r, mode);
    if (esAjusteVentaLista(r)) ajustes += v;
    else if (CUENTAS_VENTAS_COMUNES.includes(r.cuenta_codigo)) ventasComunes += v;
    else if (CUENTAS_IVA_INGRESO.includes(r.cuenta_codigo)) ingresosIva += v;
  }
  return {
    ventasComunes: Number(ventasComunes.toFixed(2)),
    ajustes: Number(ajustes.toFixed(2)),
    ingresosIva: Number(ingresosIva.toFixed(2)),
    total: Number((ventasComunes + ajustes + ingresosIva).toFixed(2)),
  };
}

/** Serie mensual del año para el gráfico y la tabla — nunca más allá del mes de corte. */
export function construirSerieIngresos(
  rowsAnio: RowIngresoRaw[],
  mesCorte: number,
  mode: UsdViewMode,
  incluirOff: boolean,
) {
  return Array.from({ length: mesCorte }, (_, i) => {
    const t = calcularTotalesIngresosMes(rowsAnio, i + 1, mode, incluirOff);
    return { mesLabel: MESES[i], ...t };
  });
}

export type CuentaIngreso = { codigo: string; nombre: string };
export type FilaDesglose = { codigo: string; nombre: string; total: number };

/** Desglose por cuenta del mes seleccionado, para la tabla de detalle. Las
 * cuentas 1.1/1.2 excluyen los ajustes de venta lista (se muestran en una
 * fila aparte, igual que en los KPIs de arriba) para que ambas vistas sumen
 * exactamente lo mismo. */
export function construirDesgloseIngresos(
  rowsAnio: RowIngresoRaw[],
  cuentas: CuentaIngreso[] | undefined,
  mes: number,
  mode: UsdViewMode,
  incluirOff: boolean,
): FilaDesglose[] {
  const porCuenta = new Map<string, number>();
  let ajustes = 0;
  for (const r of filasDelMes(rowsAnio, mes, incluirOff)) {
    const v = baseUsdFila(r, mode);
    if (esAjusteVentaLista(r)) { ajustes += v; continue; }
    porCuenta.set(r.cuenta_codigo, (porCuenta.get(r.cuenta_codigo) ?? 0) + v);
  }
  const filas = (cuentas ?? [])
    .map((c) => ({ codigo: c.codigo, nombre: c.nombre, total: porCuenta.get(c.codigo) ?? 0 }))
    .filter((c) => Math.abs(c.total) > 0.009);
  if (Math.abs(ajustes) > 0.009) {
    filas.push({ codigo: "—", nombre: "Ajustes de venta lista (importados)", total: ajustes });
  }
  return filas;
}
