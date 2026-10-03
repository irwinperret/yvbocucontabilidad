import { MESES } from "@/lib/account-helpers";

export type RowIngreso = { periodo: string; anio: number; mes: number; cuenta_codigo: string; modo: string; base_usd: number };

/** Ventas "comunes": lo que efectivamente se vendió (contado YV, contado
 * Bocú, contado YV Market y a crédito). Es el grueso de los ingresos. */
export const CUENTAS_VENTAS_COMUNES = ["1.1", "1.2", "1.3", "1.4"];

/** Ajustes sobre ventas: descuentos y devoluciones / notas de crédito.
 * Son contra-ingreso — normalmente restan del total (quedan en negativo). */
export const CUENTAS_AJUSTES_INGRESO = ["1.6", "1.7"];

/** "Ingresos (Neto) Ops IVA" (1.8): existe en el plan de cuentas como
 * ingreso, pero el IVA que se cobra en cada venta (cuenta 7.3, IVA débito
 * fiscal cobrado) se contabiliza como pasivo transitorio con el SENIAT, no
 * como ingreso propio — por eso esta cuenta normalmente está en $0.00. */
export const CUENTAS_IVA_INGRESO = ["1.8"];

const sumaCuentas = (rows: RowIngreso[], mes: number, codigos: string[]) =>
  rows
    .filter((r) => r.mes === mes && codigos.includes(r.cuenta_codigo))
    .reduce((s, r) => s + (Number(r.base_usd) || 0), 0);

export type TotalesIngresosMes = {
  ventasComunes: number;
  ajustes: number;
  ingresosIva: number;
  total: number;
};

export function calcularTotalesIngresosMes(rowsAnio: RowIngreso[], mes: number): TotalesIngresosMes {
  const ventasComunes = sumaCuentas(rowsAnio, mes, CUENTAS_VENTAS_COMUNES);
  const ajustes = sumaCuentas(rowsAnio, mes, CUENTAS_AJUSTES_INGRESO);
  const ingresosIva = sumaCuentas(rowsAnio, mes, CUENTAS_IVA_INGRESO);
  return {
    ventasComunes: Number(ventasComunes.toFixed(2)),
    ajustes: Number(ajustes.toFixed(2)),
    ingresosIva: Number(ingresosIva.toFixed(2)),
    total: Number((ventasComunes + ajustes + ingresosIva).toFixed(2)),
  };
}

/** Serie mensual del año para el gráfico — nunca más allá del mes de corte. */
export function construirSerieIngresos(rowsAnio: RowIngreso[], mesCorte: number) {
  return Array.from({ length: mesCorte }, (_, i) => {
    const t = calcularTotalesIngresosMes(rowsAnio, i + 1);
    return { mesLabel: MESES[i], ...t };
  });
}

export type CuentaIngreso = { codigo: string; nombre: string };

/** Desglose por cuenta del mes seleccionado, para la tabla de detalle. */
export function construirDesgloseIngresos(rowsAnio: RowIngreso[], cuentas: CuentaIngreso[] | undefined, mes: number) {
  const porCuenta = new Map<string, number>();
  rowsAnio.filter((r) => r.mes === mes).forEach((r) => {
    porCuenta.set(r.cuenta_codigo, (porCuenta.get(r.cuenta_codigo) ?? 0) + (Number(r.base_usd) || 0));
  });
  return (cuentas ?? [])
    .map((c) => ({ codigo: c.codigo, nombre: c.nombre, total: porCuenta.get(c.codigo) ?? 0 }))
    .filter((c) => Math.abs(c.total) > 0.009);
}
