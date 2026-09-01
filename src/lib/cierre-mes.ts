import { supabase } from "@/integrations/supabase/client";
import { tasaBcvQuery } from "@/lib/tasas";

/**
 * Cálculo y guardado del cierre de mes: MISMA lógica que usaba
 * registrar.tsx (tab "COGS e Inventario"), extraída aquí para que tanto esa
 * pestaña como la pantalla "Cierres de Mes" llamen a un solo lugar y nunca
 * puedan desincronizarse (fue justo eso lo que causó el bug del COGS
 * paralelo que se corrigió antes).
 *
 * El inventario SIEMPRE se ingresa en USD a tasa BCV.
 */
export type ResultadoCierre = {
  periodo: string;
  iniUsd: number;
  finUsd: number;
  iniBs: number;
  finBs: number;
  cogsBs: number;
  cogsUsdBcv: number;
  cogsUsdParalelo: number;
  tasaBcvPromedio: number;
  tasaBcvIni: number;
  tasaBcvFin: number;
  paralelaPromedio: number;
  totalComprasNetoBs: number;
};

function primerYUltimoDia(periodo: string) {
  const [y, m] = periodo.split("-").map(Number);
  const primerDia = `${periodo}-01`;
  const ultimoDia = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { primerDia, ultimoDia };
}

async function tasasDelPeriodo(periodo: string) {
  const { primerDia, ultimoDia } = primerYUltimoDia(periodo);
  const finExclusivo = new Date(`${periodo}-01T00:00:00`);
  finExclusivo.setMonth(finExclusivo.getMonth() + 1);
  const finExclusivoStr = finExclusivo.toISOString().slice(0, 10);

  const [{ data: tasasMes }, { data: paralelasMes }, { data: tasaIniDia }, { data: tasaFinDia }] = await Promise.all([
    supabase.from("tasas_bcv").select("fecha, tasa").gte("fecha", primerDia).lt("fecha", finExclusivoStr),
    supabase.from("tasas_paralela").select("fecha, tasa").gte("fecha", primerDia).lt("fecha", finExclusivoStr),
    tasaBcvQuery(primerDia, "fecha, tasa"),
    tasaBcvQuery(ultimoDia, "fecha, tasa"),
  ]);

  const promedio = (arr: any[] | null) => {
    const a = arr ?? [];
    if (!a.length) return 0;
    return a.reduce((s, t) => s + Number(t.tasa || 0), 0) / a.length;
  };

  return {
    tasaBcvPromedio: promedio(tasasMes),
    paralelaPromedio: promedio(paralelasMes),
    tasaBcvIni: Number((tasaIniDia as any)?.tasa) || 0,
    tasaBcvFin: Number((tasaFinDia as any)?.tasa) || 0,
    ultimoDia,
  };
}

async function comprasNetoDelPeriodo(periodo: string) {
  const finExclusivo = new Date(`${periodo}-01T00:00:00`);
  finExclusivo.setMonth(finExclusivo.getMonth() + 1);
  const { data, error } = await supabase
    .from("transacciones")
    .select("monto_bs, monto_base_bs, monto_usd, tasa_bcv, modo")
    .eq("cuenta_codigo", "2.1")
    .neq("standby", true)
    .gte("fecha", `${periodo}-01`)
    .lt("fecha", finExclusivo.toISOString().slice(0, 10));
  if (error) {
    // Antes este error se ignoraba en silencio (solo se desestructuraba
    // `data`), dejando compras_mes_bs en 0 siempre que la consulta fallara
    // — que es justo lo que pasaba: se pedía una columna ("monto_base_usd")
    // que no existe en la tabla, la consulta fallaba, y nadie se enteraba.
    throw new Error(`No se pudieron traer las compras del período ${periodo}: ${error.message}`);
  }
  const comprasOn = (data ?? []).filter((c: any) => c.modo !== "off_balance");
  const totalComprasNetoBs = comprasOn.reduce((s: number, c: any) => s + (Number(c.monto_base_bs) || Number(c.monto_bs) || 0), 0);
  const totalComprasNetoUsdBcv = comprasOn.reduce((s: number, c: any) => {
    const netoBs = Number(c.monto_base_bs) || Number(c.monto_bs) || 0;
    const tasa = Number(c.tasa_bcv) || 0;
    if (tasa > 0) return s + +(netoBs / tasa).toFixed(2);
    return s + (Number(c.monto_usd) || 0);
  }, 0);
  return { totalComprasNetoBs, totalComprasNetoUsdBcv };
}

/** Calcula el cierre de un período sin guardar nada (para previsualizar). */
export async function calcularCierre(periodo: string, invIniUsd: number, invFinUsd: number): Promise<ResultadoCierre> {
  const { tasaBcvPromedio, paralelaPromedio, tasaBcvIni, tasaBcvFin } = await tasasDelPeriodo(periodo);
  const { totalComprasNetoBs, totalComprasNetoUsdBcv } = await comprasNetoDelPeriodo(periodo);

  const iniBs = invIniUsd * tasaBcvIni;
  const finBs = invFinUsd * tasaBcvFin;
  const cogsBs = iniBs + totalComprasNetoBs - finBs;
  const cogsUsdBcv = invIniUsd + totalComprasNetoUsdBcv - invFinUsd;
  const cogsUsdParalelo = paralelaPromedio > 0 ? cogsBs / paralelaPromedio : 0;

  return {
    periodo, iniUsd: invIniUsd, finUsd: invFinUsd, iniBs, finBs,
    cogsBs, cogsUsdBcv, cogsUsdParalelo,
    tasaBcvPromedio, tasaBcvIni, tasaBcvFin, paralelaPromedio, totalComprasNetoBs,
  };
}

/** Calcula y guarda (crea o reemplaza) el cierre de un período. */
export async function calcularYGuardarCierre(
  periodo: string,
  invIniUsd: number,
  invFinUsd: number,
  userId: string,
  notas?: string | null,
): Promise<ResultadoCierre> {
  const r = await calcularCierre(periodo, invIniUsd, invFinUsd);
  const { ultimoDia } = await tasasDelPeriodo(periodo);

  const { error } = await supabase.from("cierres_de_mes").upsert(
    {
      periodo,
      inventario_inicial_bs: r.iniBs,
      inventario_final_bs: r.finBs,
      compras_mes_bs: r.totalComprasNetoBs,
      cogs_bs: r.cogsBs,
      cogs_usd: r.cogsUsdBcv,
      cogs_usd_paralelo: r.cogsUsdParalelo,
      tasa_bcv_promedio: r.tasaBcvPromedio,
      pasivos_laborales_bs: 0,
      depreciacion_bs: 0,
      notas: notas || null,
      registrado_por: userId,
      estado: "cerrado",
    } as any,
    { onConflict: "periodo" },
  );
  if (error) throw error;

  await supabase.from("inventario_snapshots").upsert(
    { periodo, tipo: "inicial", monto_bs: r.iniBs, monto_usd: invIniUsd, tasa_bcv: r.tasaBcvIni || null, registrado_por: userId, fecha: `${periodo}-01` } as any,
    { onConflict: "periodo,tipo" },
  );
  await supabase.from("inventario_snapshots").upsert(
    { periodo, tipo: "final", monto_bs: r.finBs, monto_usd: invFinUsd, tasa_bcv: r.tasaBcvFin || null, registrado_por: userId, fecha: ultimoDia } as any,
    { onConflict: "periodo,tipo" },
  );

  if (r.cogsBs && Math.abs(r.cogsBs) > 0.01) {
    await supabase.from("transacciones").delete().eq("referencia", `CIERRE-${periodo}`);
    await supabase.from("transacciones").insert({
      fecha: ultimoDia,
      cuenta_codigo: "2.2",
      centro_costo: "Compartido" as any,
      monto_bs: r.cogsBs,
      monto_base_bs: r.cogsBs,
      iva_bs: 0,
      tasa_bcv: r.tasaBcvPromedio,
      tasa_paralela: r.paralelaPromedio || null,
      monto_usd: r.cogsUsdParalelo,
      metodo_pago: "transferencia" as any,
      modo: "on_balance" as any,
      referencia: `CIERRE-${periodo}`,
      notas: `COGS automático del cierre de ${periodo}`,
      created_by: userId,
    } as any);
  }

  return r;
}

/** Reabre un mes: elimina el cierre y la transacción COGS que generó. */
export async function reabrirMes(periodo: string) {
  const { data: cierre } = await supabase.from("cierres_de_mes").select("id").eq("periodo", periodo).maybeSingle();
  if (!cierre) return;
  const { error } = await supabase.from("cierres_de_mes").delete().eq("id", (cierre as any).id);
  if (error) throw error;
  await supabase.from("transacciones").delete().eq("referencia", `CIERRE-${periodo}`);
}

export type CogsEstimado = { cogsBs: number; cogsUsdBcv: number; cogsUsdParalelo: number };

/**
 * Para meses ABIERTOS (sin cierre formal) donde ya se cargó el inventario
 * inicial y final, calcula un COGS estimado con la MISMA fórmula del cierre
 * oficial (Inicial + Compras − Final) — sin guardar nada, solo para mostrar
 * en pantalla con una advertencia de "estimado, mes abierto".
 *
 * Los meses YA cerrados no aparecen en el resultado — para esos se debe
 * seguir usando el valor real (la transacción 2.2 que ya existe).
 */
function mesAnteriorDe(periodo: string): string | null {
  const [y, m] = periodo.split("-").map(Number);
  if (!y || !m || y < 2000) return null; // corte de seguridad, no retroceder indefinidamente
  const mm = m === 1 ? 12 : m - 1;
  const yy = m === 1 ? y - 1 : y;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

export async function estimarCogsMesesAbiertos(anio: number): Promise<Map<string, CogsEstimado>> {
  // Sin límite inferior: para poder "arrastrar" el inventario desde el
  // último mes con dato cargado, sin importar cuántos meses atrás quede
  // (incluso cruzando de año), se necesita el historial completo de
  // inventario_snapshots, no solo el del año consultado.
  const [{ data: cierres }, { data: snaps }] = await Promise.all([
    supabase.from("cierres_de_mes").select("periodo").gte("periodo", `${anio}-01`).lte("periodo", `${anio}-12`),
    supabase.from("inventario_snapshots").select("periodo, tipo, monto_usd").lte("periodo", `${anio}-12`),
  ]);
  const cerrados = new Set((cierres ?? []).map((c: any) => c.periodo));

  const porPeriodo = new Map<string, { inicial?: number; final?: number }>();
  for (const s of (snaps ?? []) as any[]) {
    const e = porPeriodo.get(s.periodo) ?? {};
    if (s.tipo === "inicial") e.inicial = Number(s.monto_usd) || 0;
    if (s.tipo === "final") e.final = Number(s.monto_usd) || 0;
    porPeriodo.set(s.periodo, e);
  }

  /**
   * Nivel de inventario "conocido" al cierre de un período (para usarlo
   * como inicial del mes siguiente cuando ese mes no tiene su propio
   * inventario inicial cargado): el final registrado de ese período si
   * existe; si no, su inicial (asumiendo que no hubo cambio); si tampoco
   * hay inicial, se sigue retrocediendo un mes más — así un mes recién
   * abierto sin nada cargado hereda el último nivel de inventario conocido
   * en vez de tratarse como si el inventario fuera cero.
   */
  function inventarioAlCierreDe(periodo: string | null): number | null {
    if (!periodo) return null;
    const e = porPeriodo.get(periodo);
    if (e?.final != null) return e.final;
    if (e?.inicial != null) return e.inicial;
    return inventarioAlCierreDe(mesAnteriorDe(periodo));
  }

  const resultado = new Map<string, CogsEstimado>();
  for (let mes = 1; mes <= 12; mes++) {
    const periodo = `${anio}-${String(mes).padStart(2, "0")}`;
    if (cerrados.has(periodo)) continue; // cerrado: usar el valor real, no estimar

    const e = porPeriodo.get(periodo);
    // Inicial: el registrado a mano si existe; si no, el último nivel de
    // inventario conocido (mes anterior, o el que corresponda retrocediendo)
    // — mismo criterio que ya se usaba para el FINAL cuando no se había
    // cargado (asumir que no hubo cambio, no que el inventario es cero).
    const iniUsd = e?.inicial ?? inventarioAlCierreDe(mesAnteriorDe(periodo));
    if (iniUsd == null) continue; // ni este mes ni ninguno anterior tiene inventario cargado: no se puede estimar

    const finUsd = e?.final ?? iniUsd;

    const r = await calcularCierre(periodo, iniUsd, finUsd);
    resultado.set(periodo, { cogsBs: r.cogsBs, cogsUsdBcv: r.cogsUsdBcv, cogsUsdParalelo: r.cogsUsdParalelo });
  }
  return resultado;
}

/**
 * Dado un conjunto de meses (mes individual, YTD, o cualquier rango), calcula
 * cuánto hay que AJUSTAR el COGS ya sumado desde transacciones (que en un mes
 * abierto solo tiene compras, sin el ajuste de inventario que crea un cierre
 * real) para que refleje el estimado de estimarCogsMesesAbiertos(). Se usa
 * en G&P (tablas y gráficos) y en Flujo de Caja.
 */
export function ajusteCogsEstimado(
  rows: { cuenta_codigo: string; mes: number; base_usd: number }[],
  cogsEstimadoPorMes: Map<string, { cogsUsdBcv: number }> | undefined,
  anio: number,
  meses: number[],
): { ajuste: number; mesesEstimados: number[] } {
  if (!cogsEstimadoPorMes?.size) return { ajuste: 0, mesesEstimados: [] };
  let ajuste = 0;
  const mesesEstimados: number[] = [];
  for (const mes of meses) {
    const periodo = `${anio}-${String(mes).padStart(2, "0")}`;
    const estimado = cogsEstimadoPorMes.get(periodo);
    if (!estimado) continue;
    const cogsYaSumado = rows.filter((r) => r.cuenta_codigo.startsWith("2.") && r.mes === mes).reduce((s, r) => s + Number(r.base_usd || 0), 0);
    ajuste += estimado.cogsUsdBcv - cogsYaSumado;
    mesesEstimados.push(mes);
  }
  return { ajuste, mesesEstimados };
}
