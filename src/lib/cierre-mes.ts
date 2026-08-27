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
  const { data } = await supabase
    .from("transacciones")
    .select("monto_bs, monto_base_bs, monto_usd, monto_base_usd, tasa_bcv, modo")
    .eq("cuenta_codigo", "2.1")
    .neq("standby", true)
    .gte("fecha", `${periodo}-01`)
    .lt("fecha", finExclusivo.toISOString().slice(0, 10));
  const comprasOn = (data ?? []).filter((c: any) => c.modo !== "off_balance");
  const totalComprasNetoBs = comprasOn.reduce((s: number, c: any) => s + (Number(c.monto_base_bs) || Number(c.monto_bs) || 0), 0);
  const totalComprasNetoUsdBcv = comprasOn.reduce((s: number, c: any) => {
    const netoBs = Number(c.monto_base_bs) || Number(c.monto_bs) || 0;
    const tasa = Number(c.tasa_bcv) || 0;
    if (tasa > 0) return s + +(netoBs / tasa).toFixed(2);
    const neto = Number(c.monto_base_usd);
    return s + (Number.isFinite(neto) && neto !== 0 ? neto : Number(c.monto_usd) || 0);
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
