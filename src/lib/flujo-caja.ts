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
  /** true si el COGS de este mes es un estimado (mes abierto, sin cierre formal aún). */
  cogsEsEstimado?: boolean;
};

export const CUENTA_INGRESO_CREDITO = "1.4";
export const CUENTA_COBRO_CREDITO = "1.5";
export const CUENTAS_INGRESO_GYP = ["1.1", "1.2", "1.3", "1.4", "1.6", "1.7", "1.8"];
// OJO: solo "2.2" (el ajuste de COGS que crea un cierre formal, o el
// estimado equivalente para meses abiertos) -- NO "2.1" (Compras).
// Antes se sumaban ambas cuentas para meses ya cerrados, lo que contaba
// las compras del mes DOS veces: una como "2.1" crudo y otra ya neteada
// dentro de "2.2" (Inicial + Compras - Final). Eso inflaba el COGS usado
// en el EBITDA a casi el doble, y además hacia que la fila "Cambios en
// Inventario" (que ya reconcilia esa misma diferencia entre compras y
// COGS real) se sumara una segunda vez sobre un EBITDA que ya la traía
// implícita -- el bug reportado como "el EBITDA sale negativo en casi
// todos los meses y no hay coherencia" en Flujo de Caja > Comparativo mensual.
export const CUENTAS_COGS = ["2.2"];
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
  cxpCreadas: { anio: number; mes: number; montoUsdBcv: number; montoUsdParalelo: number }[];
  anio: number;
  usdDe: (t: any) => number;
  /** Meses abiertos con COGS estimado (de estimarCogsMesesAbiertos en cierre-mes.ts). */
  cogsEstimadoPorMes?: Map<string, { cogsUsdBcv: number; cogsUsdParalelo: number; iniUsd?: number; finUsd?: number }>;
  /** Moneda en la que ya vienen `rows` (vista BCV o paralelo) — para tomar el campo correcto del estimado. */
  moneda?: "bcv" | "paralela";
}): LineasFCMes[] {
  const { rows: r, capexRows, inventario, cxpCreadas, anio, usdDe, cogsEstimadoPorMes, moneda = "bcv" } = opts;
  const sum = (codigos: string[], mes: number) =>
    r.filter((x) => codigos.includes(x.cuenta_codigo) && x.mes === mes).reduce((s, x) => s + Number(x.base_usd || 0), 0);
  const sumTotal = (codigo: string, mes: number) =>
    r.filter((x) => x.cuenta_codigo === codigo && x.mes === mes).reduce((s, x) => s + Number(x.total_usd || 0), 0);

  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const periodo = `${anio}-${String(mes).padStart(2, "0")}`;

    const ingresos = sum(CUENTAS_INGRESO_GYP, mes);
    const estimado = cogsEstimadoPorMes?.get(periodo);
    const cogs = estimado ? (moneda === "paralela" ? estimado.cogsUsdParalelo : estimado.cogsUsdBcv) : sum(CUENTAS_COGS, mes);
    const costosFijos = r.filter((x) => x.cuenta_codigo.startsWith("3.") && x.mes === mes).reduce((s, x) => s + Number(x.base_usd || 0), 0);
    const costosVariables = r.filter((x) => (x.cuenta_codigo.startsWith("4.") || x.cuenta_codigo === "99") && x.mes === mes).reduce((s, x) => s + Number(x.base_usd || 0), 0);
    const ebitda = ingresos - cogs - costosFijos - costosVariables;

    const ventasCredito = sumTotal(CUENTA_INGRESO_CREDITO, mes);
    const cobrosCredito = sumTotal(CUENTA_COBRO_CREDITO, mes);
    const cambioCxC = cobrosCredito - ventasCredito;

    const invIni = inventario.find((s) => s.periodo === periodo && s.tipo === "inicial");
    const invFin = inventario.find((s) => s.periodo === periodo && s.tipo === "final");
    // Mes cerrado: usa el snapshot real (siempre existen ambos, los guarda
    // calcularYGuardarCierre). Mes abierto: usa el ini/fin que ya calculó
    // estimarCogsMesesAbiertos() para el COGS estimado -- que ya arrastra
    // el inventario del mes anterior cuando no hay inicial propio, y asume
    // "sin cambio" (fin = ini) cuando falta el final -- para que esta fila
    // nunca se desincronice del COGS que se está mostrando arriba.
    const cambioInventario =
      invIni && invFin
        ? Number(invIni.monto_usd || 0) - Number(invFin.monto_usd || 0)
        : estimado && estimado.iniUsd != null && estimado.finUsd != null
          ? estimado.iniUsd - estimado.finUsd
          : 0;

    // OJO: se agrupa por la fecha REAL de la factura (la de la transacción
    // vinculada), no por "created_at" de la fila de cuentas_por_pagar --
    // las facturas importadas en bloque quedan todas con el mismo
    // created_at (el día de la importación) sin importar de qué mes sea
    // cada factura, lo que amontonaba TODAS las CxP del año en un solo mes
    // ("Cambios en Cuentas por pagar" incoherente en Flujo de Caja). El
    // monto también se toma en la misma moneda que `rows` (usd_bcv_factura
    // vs usd_paralelo_factura), igual que el resto de esta función.
    const nuevasCxp = cxpCreadas
      .filter((c) => c.anio === anio && c.mes === mes)
      .reduce((s, c) => s + Number((moneda === "paralela" ? c.montoUsdParalelo : c.montoUsdBcv) || 0), 0);
    const pagosCxp = sumTotal(CUENTA_PAGO_CXP, mes);
    const cambioCxP = nuevasCxp - Math.abs(pagosCxp);

    // Se compara el string "YYYY-MM" directo (no new Date().getMonth()) para
    // no depender de la zona horaria del navegador -- fecha es un DATE sin
    // hora, y parsearlo con Date() lo interpreta a medianoche UTC, lo que
    // en un huso horario detrás de UTC (como Venezuela) corre el día 1 de
    // cada mes al mes anterior.
    const capexMes = capexRows.filter((c) => typeof c.fecha === "string" && c.fecha.slice(0, 7) === periodo);
    const compraInmuebles = capexMes.filter((c) => c.capex_categoria === CATEGORIA_INMUEBLES).reduce((s, c) => s + usdDe(c), 0);
    const compraEquipos = capexMes.filter((c) => c.capex_categoria !== CATEGORIA_INMUEBLES).reduce((s, c) => s + usdDe(c), 0);

    const aumentoCapital = sumTotal(CUENTA_CAPITAL, mes);
    const aumentoPrestamos = sumTotal(CUENTA_PRESTAMO_RECIBIDO, mes) - sumTotal(CUENTA_PAGO_CAPITAL_PRESTAMO, mes);
    const gastoIntereses = sumTotal(CUENTA_INTERESES, mes);
    const gastoImpuestos = sum(CUENTAS_IMPUESTOS_GASTO, mes);
    const gastoDividendos = sumTotal(CUENTA_DIVIDENDOS, mes);

    return { ebitda, cambioCxC, cambioInventario, cambioCxP, compraInmuebles, compraEquipos, aumentoCapital, aumentoPrestamos, gastoIntereses, gastoImpuestos, gastoDividendos, cogsEsEstimado: !!estimado };
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

  // "Cambios en Cuentas por pagar" tiene que agruparse por la fecha REAL de
  // la factura (la de la transacción que originó la CxP), no por
  // created_at de la fila de cuentas_por_pagar: una importación en bloque
  // deja el mismo created_at (el día de la importación) en cientos de
  // filas sin importar de qué mes sea cada factura. Se trae transaccion_id
  // + los montos ya congelados en ambas monedas (usd_bcv_factura /
  // usd_paralelo_factura) y se resuelve la fecha real con una consulta
  // aparte a transacciones (evita depender de que PostgREST reconozca el
  // embed automático por la FK).
  const cxpRaw = await fetchAllRows<any>(async (from, to) => {
    let q = supabase
      .from("cuentas_por_pagar")
      .select("transaccion_id, monto_usd, usd_bcv_factura, usd_paralelo_factura, centro_costo, created_at");
    if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
    return await q.range(from, to);
  });

  const idsTransacciones = Array.from(
    new Set((cxpRaw ?? []).map((c: any) => c.transaccion_id).filter((id: any): id is string => !!id)),
  );
  const fechaPorTransaccion = new Map<string, string>();
  const CHUNK = 200;
  for (let i = 0; i < idsTransacciones.length; i += CHUNK) {
    const lote = idsTransacciones.slice(i, i + CHUNK);
    const { data } = await supabase.from("transacciones").select("id, fecha").in("id", lote);
    (data ?? []).forEach((t: any) => fechaPorTransaccion.set(t.id, t.fecha));
  }

  const cxpCreadas = (cxpRaw ?? [])
    .map((c: any) => {
      // Si por algún motivo no hay transacción vinculada (dato manual muy
      // viejo, o borrada), se cae de vuelta a created_at antes que perder
      // la fila por completo.
      const fecha: string | undefined = (c.transaccion_id && fechaPorTransaccion.get(c.transaccion_id)) || c.created_at;
      if (!fecha || typeof fecha !== "string" || fecha.length < 7) return null;
      const anioFactura = Number(fecha.slice(0, 4));
      const mesFactura = Number(fecha.slice(5, 7));
      const montoUsdBcv = Number(c.usd_bcv_factura ?? c.monto_usd) || 0;
      const montoUsdParalelo = Number(c.usd_paralelo_factura ?? c.monto_usd) || 0;
      return { anio: anioFactura, mes: mesFactura, montoUsdBcv, montoUsdParalelo };
    })
    .filter((c): c is { anio: number; mes: number; montoUsdBcv: number; montoUsdParalelo: number } => c != null);

  return { capexRows, inventario: inventario ?? [], cxpCreadas };
}
