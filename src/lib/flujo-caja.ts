import { supabase } from "@/integrations/supabase/client";

/** Líneas del flujo de caja indirecto para un mes dado. */
export type LineasFCMes = {
  ebitda: number;
  cambioCxC: number;
  cambioInventario: number;
  cambioCxP: number;
  compraInmuebles: number;
  compraEquipos: number;
  aumentoCapital: number;
  aumentoPrestamos: number;
  gastoIntereses: number;
  gastoImpuestos: number;
  gastoDividendos: number;
};

export const CUENTA_INGRESO_CREDITO = "1.4";
export const CUENTA_COBRO_CREDITO = "1.5";
export const CUENTAS_INGRESO_GYP = ["1.1", "1.2", "1.3", "1.4", "1.6", "1.7", "1.8"];
export const CUENTAS_COGS = ["2.1", "2.2"];
export const CUENTA_PAGO_CXP = "8.2";
export const CUENTA_CAPEX = "5.6";
export const CUENTA_CAPITAL = "5.5";
export const CUENTA_PRESTAMO_RECIBIDO = "5.1";
export const CUENTA_PAGO_CAPITAL_PRESTAMO = "5.2";
export const CUENTA_INTERESES = "5.3";
export const CUENTA_DIVIDENDOS = "5.4";
export const CUENTAS_IMPUESTOS_GASTO = ["7.1", "7.2"];
export const CATEGORIA_INMUEBLES = "Remodelación/Obra Civil";

export function totalFCMes(l: LineasFCMes) {
  const operativo = l.ebitda + l.cambioCxC + l.cambioInventario + l.cambioCxP;
  const inversion = -l.compraInmuebles - l.compraEquipos;
  const financiero = l.aumentoCapital + l.aumentoPrestamos - l.gastoIntereses - l.gastoImpuestos - l.gastoDividendos;
  return { operativo, inversion, financiero, neto: operativo + inversion + financiero };
}

type Row = { anio: number; mes: number; cuenta_codigo: string; centro_costo: string; modo: string; base_usd: number; total_usd: number };

/**
 * Calcula las 12 líneas mensuales de flujo de caja (método indirecto) para
 * un año, a partir de datos ya cargados. Esta es la ÚNICA fórmula de flujo
 * de caja en todo el sistema — tanto la pantalla de Flujo de Caja como el
 * gráfico "Efectivo disponible (FC)" del Dashboard llaman a esta misma
 * función, para que nunca queden dos versiones que se puedan desincronizar.
 *
 * IMPORTANTE: la cuenta 2.1 (Compras) se toma como gasto DEVENGADO (dentro
 * del EBITDA), no como salida de caja directa — la salida de caja real para
 * esas compras es 8.2 (Pago de CxP), capturada en "Cambios en Cuentas por
 * pagar". Contar 2.1 Y 8.2 como salidas por separado duplicaría la misma
 * plata (una vez al comprar, otra vez al pagar).
 */
export function calcularLineasFC(opts: {
  rows: Row[];
  capexRows: any[];
  inventario: { periodo: string; tipo: string; monto_usd: number }[];
  cxpCreadas: { created_at: string; monto_usd: number }[];
  anio: number;
  usdDe: (t: any) => number;
}): LineasFCMes[] {
  const { rows: r, capexRows, inventario, cxpCreadas, anio, usdDe } = opts;
  const sum = (codigos: string[], mes: number) =>
    r.filter((x) => codigos.includes(x.cuenta_codigo) && x.mes === mes).reduce((s, x) => s + Number(x.base_usd || 0), 0);
  const sumTotal = (codigo: string, mes: number) =>
    r.filter((x) => x.cuenta_codigo === codigo && x.mes === mes).reduce((s, x) => s + Number(x.total_usd || 0), 0);

  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const periodo = `${anio}-${String(mes).padStart(2, "0")}`;

    const ingresos = sum(CUENTAS_INGRESO_GYP, mes);
    const cogs = sum(CUENTAS_COGS, mes);
    const costosFijos = r.filter((x) => x.cuenta_codigo.startsWith("3.") && x.mes === mes).reduce((s, x) => s + Number(x.base_usd || 0), 0);
    const costosVariables = r.filter((x) => (x.cuenta_codigo.startsWith("4.") || x.cuenta_codigo === "99") && x.mes === mes).reduce((s, x) => s + Number(x.base_usd || 0), 0);
    const ebitda = ingresos - cogs - costosFijos - costosVariables;

    const ventasCredito = sumTotal(CUENTA_INGRESO_CREDITO, mes);
    const cobrosCredito = sumTotal(CUENTA_COBRO_CREDITO, mes);
    const cambioCxC = cobrosCredito - ventasCredito;

    const invIni = inventario.find((s) => s.periodo === periodo && s.tipo === "inicial");
    const invFin = inventario.find((s) => s.periodo === periodo && s.tipo === "final");
    const cambioInventario = invIni && invFin ? Number(invIni.monto_usd || 0) - Number(invFin.monto_usd || 0) : 0;

    const nuevasCxp = cxpCreadas
      .filter((c) => { const d = new Date(c.created_at); return d.getFullYear() === anio && d.getMonth() + 1 === mes; })
      .reduce((s, c) => s + Number(c.monto_usd || 0), 0);
    const pagosCxp = sumTotal(CUENTA_PAGO_CXP, mes);
    const cambioCxP = nuevasCxp - Math.abs(pagosCxp);

    const capexMes = capexRows.filter((c) => new Date(c.fecha).getMonth() + 1 === mes);
    const compraInmuebles = capexMes.filter((c) => c.capex_categoria === CATEGORIA_INMUEBLES).reduce((s, c) => s + usdDe(c), 0);
    const compraEquipos = capexMes.filter((c) => c.capex_categoria !== CATEGORIA_INMUEBLES).reduce((s, c) => s + usdDe(c), 0);

    const aumentoCapital = sumTotal(CUENTA_CAPITAL, mes);
    const aumentoPrestamos = sumTotal(CUENTA_PRESTAMO_RECIBIDO, mes) - sumTotal(CUENTA_PAGO_CAPITAL_PRESTAMO, mes);
    const gastoIntereses = sumTotal(CUENTA_INTERESES, mes);
    const gastoImpuestos = sum(CUENTAS_IMPUESTOS_GASTO, mes);
    const gastoDividendos = sumTotal(CUENTA_DIVIDENDOS, mes);

    return { ebitda, cambioCxC, cambioInventario, cambioCxP, compraInmuebles, compraEquipos, aumentoCapital, aumentoPrestamos, gastoIntereses, gastoImpuestos, gastoDividendos };
  });
}

/** Trae los 3 insumos adicionales (CapEx, inventario, CxP creadas) que necesita calcularLineasFC, dado un año/centro/modo ya filtrados. */
export async function fetchInsumosFC(opts: { anio: number; centro: string; modoFiltro: string | undefined; cuentaBancariaId?: string }) {
  const { anio, centro, modoFiltro, cuentaBancariaId } = opts;
  const { fetchAllRows } = await import("@/lib/fetch-all");

  const capexRows = await fetchAllRows<any>(async (from, to) => {
    let q = supabase.from("transacciones").select("fecha, monto_bs, monto_usd, tasa_bcv, capex_categoria, centro_costo, modo")
      .eq("cuenta_codigo", CUENTA_CAPEX).neq("standby", true)
      .gte("fecha", `${anio}-01-01`).lte("fecha", `${anio}-12-31`);
    if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
    if (modoFiltro) q = q.eq("modo", modoFiltro as any);
    if (cuentaBancariaId && cuentaBancariaId !== "todas") q = q.eq("cuenta_bancaria_id" as any, cuentaBancariaId);
    return await q.range(from, to);
  });

  const { data: inventario } = await supabase.from("inventario_snapshots").select("periodo, tipo, monto_usd")
    .gte("periodo", `${anio}-01`).lte("periodo", `${anio}-12`);

  let cxpQ = supabase.from("cuentas_por_pagar").select("created_at, monto_usd, centro_costo")
    .gte("created_at", `${anio}-01-01`).lt("created_at", `${anio + 1}-01-01`);
  if (centro !== "Consolidado") cxpQ = cxpQ.eq("centro_costo", centro as any);
  const { data: cxpCreadas } = await cxpQ;

  return { capexRows, inventario: inventario ?? [], cxpCreadas: cxpCreadas ?? [] };
}
