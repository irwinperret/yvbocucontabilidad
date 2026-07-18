import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  snapshot_id: z.string().uuid(),
  monto_usd: z.number(),
  monto_bs: z.number(),
  tasa_bcv: z.number().nullable().optional(),
  notas: z.string().nullable().optional(),
  cascade_next_month: z.boolean().default(false),
  cascade_prev_month: z.boolean().default(false),
});

const DeleteInputSchema = z.object({
  snapshot_id: z.string().uuid(),
  cascade_next_month_inicial: z.boolean().default(false),
});

function shiftPeriodo(periodo: string, delta: number) {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodBoundaries(periodo: string) {
  const [y, m] = periodo.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

function r2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function fetchTasaBcvPromedio(supabase: any, periodo: string): Promise<number> {
  const { from, to } = periodBoundaries(periodo);
  const { data } = await supabase
    .from("tasas_bcv")
    .select("tasa")
    .gte("fecha", from)
    .lte("fecha", to);
  const arr = (data ?? []) as any[];
  if (!arr.length) return 0;
  const sum = arr.reduce((s, r) => s + Number(r.tasa || 0), 0);
  return sum / arr.length;
}

async function fetchParalelaPromedio(supabase: any, periodo: string): Promise<number> {
  const { from, to } = periodBoundaries(periodo);
  const { data } = await supabase
    .from("tasas_paralela")
    .select("tasa")
    .gte("fecha", from)
    .lte("fecha", to);
  const arr = (data ?? []) as any[];
  if (!arr.length) return 0;
  const sum = arr.reduce((s, r) => s + Number(r.tasa || 0), 0);
  return sum / arr.length;
}

async function recalcCierreForPeriod(
  supabase: any,
  periodo: string,
  userId: string,
): Promise<{ periodo: string; cogs_usd: number; cogs_bs: number } | null> {
  const { data: cierre } = await supabase
    .from("cierres_de_mes")
    .select("id, tasa_bcv_promedio")
    .eq("periodo", periodo)
    .maybeSingle();
  if (!cierre) return null;

  const { to } = periodBoundaries(periodo);

  // Tasa BCV promedio: usar la del cierre si existe; si no, promedio real del período.
  let tasaBcvProm = Number((cierre as any).tasa_bcv_promedio) || 0;
  if (!tasaBcvProm) tasaBcvProm = await fetchTasaBcvPromedio(supabase, periodo);

  // Paralela promedio del período (para expresar COGS en USD paralelo).
  const paralelaProm = await fetchParalelaPromedio(supabase, periodo);

  const [{ data: iniSnap }, { data: finSnap }, { data: compras }] = await Promise.all([
    supabase
      .from("inventario_snapshots")
      .select("id, monto_usd")
      .eq("periodo", periodo)
      .eq("tipo", "inicial")
      .maybeSingle(),
    supabase
      .from("inventario_snapshots")
      .select("id, monto_usd")
      .eq("periodo", periodo)
      .eq("tipo", "final")
      .maybeSingle(),
    supabase
      .from("transacciones")
      .select("monto_bs, monto_base_bs")
      .eq("cuenta_codigo", "2.1")
      .gte("fecha", periodBoundaries(periodo).from)
      .lte("fecha", to),
  ]);

  const iniUsd = Number((iniSnap as any)?.monto_usd) || 0;
  const finUsd = Number((finSnap as any)?.monto_usd) || 0;

  // Bs derivado de USD × tasa BCV promedio del período (invariante).
  const iniBs = r2(iniUsd * tasaBcvProm);
  const finBs = r2(finUsd * tasaBcvProm);

  const comprasNetoBs = (compras ?? []).reduce(
    (s: number, r: any) => s + (Number(r.monto_base_bs) || Number(r.monto_bs) || 0),
    0,
  );

  const cogsBs = r2(iniBs + comprasNetoBs - finBs);
  const cogsUsd = paralelaProm > 0 ? r2(cogsBs / paralelaProm) : 0;

  // Reabrir cierre
  await supabase.from("cierres_de_mes").update({ estado: "abierto" }).eq("id", (cierre as any).id);

  // Actualizar snapshots.monto_bs para consistencia
  if (iniSnap) {
    await supabase
      .from("inventario_snapshots")
      .update({ monto_bs: iniBs, tasa_bcv: tasaBcvProm || null } as any)
      .eq("id", (iniSnap as any).id);
  }
  if (finSnap) {
    await supabase
      .from("inventario_snapshots")
      .update({ monto_bs: finBs, tasa_bcv: tasaBcvProm || null } as any)
      .eq("id", (finSnap as any).id);
  }

  // Actualizar cierre
  await supabase
    .from("cierres_de_mes")
    .update({
      inventario_inicial_bs: iniBs,
      inventario_final_bs: finBs,
      compras_mes_bs: r2(comprasNetoBs),
      cogs_bs: cogsBs,
      cogs_usd: cogsUsd,
      tasa_bcv_promedio: tasaBcvProm || null,
    } as any)
    .eq("id", (cierre as any).id);

  // Regenerar transacción 2.2
  await supabase.from("transacciones").delete().eq("referencia", `CIERRE-${periodo}`);
  if (Math.abs(cogsBs) > 0.01) {
    await supabase.from("transacciones").insert({
      fecha: to,
      cuenta_codigo: "2.2",
      centro_costo: "Compartido" as any,
      monto_bs: cogsBs,
      monto_base_bs: cogsBs,
      iva_bs: 0,
      tasa_bcv: tasaBcvProm || null,
      tasa_paralela: paralelaProm || null,
      monto_usd: cogsUsd,
      metodo_pago: "transferencia" as any,
      modo: "on_balance" as any,
      referencia: `CIERRE-${periodo}`,
      notas: `COGS recalculado del cierre de ${periodo}`,
      created_by: userId,
    } as any);
  }

  // Volver a cerrar
  await supabase.from("cierres_de_mes").update({ estado: "cerrado" }).eq("id", (cierre as any).id);

  return { periodo, cogs_usd: cogsUsd, cogs_bs: cogsBs };
}

// Exportado para uso desde otros server functions (registrar.tsx llama vía server fn wrapper).
export const recalcCierrePeriodo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ periodo: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    return await recalcCierreForPeriod(context.supabase, data.periodo, context.userId);
  });

export const editarInventarioSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: snap, error: snapErr } = await supabase
      .from("inventario_snapshots")
      .select("id, periodo, tipo, tasa_bcv")
      .eq("id", data.snapshot_id)
      .maybeSingle();
    if (snapErr) throw snapErr;
    if (!snap) throw new Error("Snapshot no encontrado");

    const periodo = (snap as any).periodo as string;
    const tipo = (snap as any).tipo as "inicial" | "final";

    // Update snapshot (monto_bs se recomputa dentro de recalc; aquí guardamos el input tal cual)
    const { error: updErr } = await supabase
      .from("inventario_snapshots")
      .update({
        monto_usd: data.monto_usd,
        monto_bs: data.monto_bs,
        tasa_bcv: data.tasa_bcv ?? (snap as any).tasa_bcv,
        notas: data.notas ?? null,
      } as any)
      .eq("id", data.snapshot_id);
    if (updErr) throw updErr;

    let cascadedNextPeriodo: string | null = null;
    let cascadedPrevPeriodo: string | null = null;

    // Cascada: final → siguiente inicial
    if (tipo === "final" && data.cascade_next_month) {
      const nextPeriodo = shiftPeriodo(periodo, 1);
      const tasaBcvNext = (await fetchTasaBcvPromedio(supabase, nextPeriodo)) || Number(data.tasa_bcv) || 0;
      const nextMontoBs = r2(data.monto_usd * tasaBcvNext);

      const { data: nextIni } = await supabase
        .from("inventario_snapshots")
        .select("id, tasa_bcv")
        .eq("periodo", nextPeriodo)
        .eq("tipo", "inicial")
        .maybeSingle();
      if (nextIni) {
        await supabase
          .from("inventario_snapshots")
          .update({
            monto_usd: data.monto_usd,
            monto_bs: nextMontoBs,
            tasa_bcv: tasaBcvNext || (nextIni as any).tasa_bcv,
          } as any)
          .eq("id", (nextIni as any).id);
      } else {
        await supabase.from("inventario_snapshots").insert({
          periodo: nextPeriodo,
          tipo: "inicial",
          monto_usd: data.monto_usd,
          monto_bs: nextMontoBs,
          tasa_bcv: tasaBcvNext || null,
          registrado_por: userId,
          fecha: `${nextPeriodo}-01`,
        } as any);
      }
      cascadedNextPeriodo = nextPeriodo;
    }

    // Cascada: inicial → mes anterior final
    if (tipo === "inicial" && data.cascade_prev_month) {
      const prevPeriodo = shiftPeriodo(periodo, -1);
      const tasaBcvPrev = (await fetchTasaBcvPromedio(supabase, prevPeriodo)) || Number(data.tasa_bcv) || 0;
      const prevMontoBs = r2(data.monto_usd * tasaBcvPrev);

      // Fecha = último día del mes anterior
      const [y, m] = prevPeriodo.split("-").map(Number);
      const finPrev = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

      const { data: prevFin } = await supabase
        .from("inventario_snapshots")
        .select("id, tasa_bcv")
        .eq("periodo", prevPeriodo)
        .eq("tipo", "final")
        .maybeSingle();
      if (prevFin) {
        await supabase
          .from("inventario_snapshots")
          .update({
            monto_usd: data.monto_usd,
            monto_bs: prevMontoBs,
            tasa_bcv: tasaBcvPrev || (prevFin as any).tasa_bcv,
          } as any)
          .eq("id", (prevFin as any).id);
      } else {
        await supabase.from("inventario_snapshots").insert({
          periodo: prevPeriodo,
          tipo: "final",
          monto_usd: data.monto_usd,
          monto_bs: prevMontoBs,
          tasa_bcv: tasaBcvPrev || null,
          registrado_por: userId,
          fecha: finPrev,
        } as any);
      }
      cascadedPrevPeriodo = prevPeriodo;
    }

    const primary = await recalcCierreForPeriod(supabase, periodo, userId);
    const cascaded_next = cascadedNextPeriodo
      ? await recalcCierreForPeriod(supabase, cascadedNextPeriodo, userId)
      : null;
    const cascaded_prev = cascadedPrevPeriodo
      ? await recalcCierreForPeriod(supabase, cascadedPrevPeriodo, userId)
      : null;

    return { primary, cascaded: cascaded_next, cascaded_next, cascaded_prev };
  });

async function assertPeriodoNotClosed(supabase: any, periodo: string) {
  const { data: cierre } = await supabase
    .from("cierres_de_mes")
    .select("estado")
    .eq("periodo", periodo)
    .maybeSingle();
  if (cierre && (cierre as any).estado === "cerrado") {
    throw new Error(
      `No se puede borrar: el cierre de ${periodo} está cerrado. Reábrelo primero.`,
    );
  }
}

export const borrarInventarioSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DeleteInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: snap, error: snapErr } = await supabase
      .from("inventario_snapshots")
      .select("id, periodo, tipo")
      .eq("id", data.snapshot_id)
      .maybeSingle();
    if (snapErr) throw snapErr;
    if (!snap) throw new Error("Snapshot no encontrado");

    const periodo = (snap as any).periodo as string;
    const tipo = (snap as any).tipo as "inicial" | "final";

    await assertPeriodoNotClosed(supabase, periodo);

    let cascadedPeriodo: string | null = null;
    if (tipo === "final" && data.cascade_next_month_inicial) {
      const nextPeriodo = shiftPeriodo(periodo, 1);
      await assertPeriodoNotClosed(supabase, nextPeriodo);
      const { data: nextIni } = await supabase
        .from("inventario_snapshots")
        .select("id")
        .eq("periodo", nextPeriodo)
        .eq("tipo", "inicial")
        .maybeSingle();
      if (nextIni) {
        const { error: delNextErr } = await supabase
          .from("inventario_snapshots")
          .delete()
          .eq("id", (nextIni as any).id);
        if (delNextErr) throw delNextErr;
        cascadedPeriodo = nextPeriodo;
      }
    }

    const { error: delErr } = await supabase
      .from("inventario_snapshots")
      .delete()
      .eq("id", data.snapshot_id);
    if (delErr) throw delErr;

    return { deleted_periodo: periodo, tipo, cascaded_periodo: cascadedPeriodo };
  });
