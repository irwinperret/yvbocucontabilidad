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

  const { from, to } = periodBoundaries(periodo);

  const [{ data: iniSnap }, { data: finSnap }, { data: compras }] = await Promise.all([
    supabase
      .from("inventario_snapshots")
      .select("monto_usd, monto_bs, tasa_bcv")
      .eq("periodo", periodo)
      .eq("tipo", "inicial")
      .maybeSingle(),
    supabase
      .from("inventario_snapshots")
      .select("monto_usd, monto_bs, tasa_bcv")
      .eq("periodo", periodo)
      .eq("tipo", "final")
      .maybeSingle(),
    supabase
      .from("transacciones")
      .select("monto_usd, monto_bs")
      .eq("cuenta_codigo", "2.1")
      .gte("fecha", from)
      .lte("fecha", to),
  ]);

  const iniUsd = Number((iniSnap as any)?.monto_usd) || 0;
  const finUsd = Number((finSnap as any)?.monto_usd) || 0;
  const iniBs = Number((iniSnap as any)?.monto_bs) || 0;
  const finBs = Number((finSnap as any)?.monto_bs) || 0;
  const comprasUsd = (compras ?? []).reduce((s: number, r: any) => s + (Number(r.monto_usd) || 0), 0);
  const comprasBs = (compras ?? []).reduce((s: number, r: any) => s + (Number(r.monto_bs) || 0), 0);

  const cogsUsd = Math.round((iniUsd + comprasUsd - finUsd) * 100) / 100;
  const cogsBs = Math.round((iniBs + comprasBs - finBs) * 100) / 100;
  const tasaProm = Number((cierre as any).tasa_bcv_promedio) || 0;

  // reopen
  await supabase.from("cierres_de_mes").update({ estado: "abierto" }).eq("id", (cierre as any).id);

  // Update cierre with new values
  await supabase
    .from("cierres_de_mes")
    .update({
      inventario_inicial_bs: iniBs,
      inventario_final_bs: finBs,
      compras_mes_bs: comprasBs,
      cogs_bs: cogsBs,
      cogs_usd: cogsUsd,
    } as any)
    .eq("id", (cierre as any).id);

  // Regenerate COGS transaction (cuenta 2.2)
  await supabase.from("transacciones").delete().eq("referencia", `CIERRE-${periodo}`);
  if (Math.abs(cogsUsd) > 0.01) {
    await supabase.from("transacciones").insert({
      fecha: to,
      cuenta_codigo: "2.2",
      centro_costo: "Compartido" as any,
      monto_bs: cogsBs,
      monto_base_bs: cogsBs,
      iva_bs: 0,
      tasa_bcv: tasaProm || null,
      monto_usd: cogsUsd,
      metodo_pago: "transferencia" as any,
      modo: "on_balance" as any,
      referencia: `CIERRE-${periodo}`,
      notas: `COGS recalculado del cierre de ${periodo}`,
      created_by: userId,
    } as any);
  }

  // reclose
  await supabase.from("cierres_de_mes").update({ estado: "cerrado" }).eq("id", (cierre as any).id);

  return { periodo, cogs_usd: cogsUsd, cogs_bs: cogsBs };
}

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

    // Update snapshot
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

    // Cascade: si es final y hay siguiente mes, actualizar su inicial
    let cascadedPeriodo: string | null = null;
    if (tipo === "final" && data.cascade_next_month) {
      const nextPeriodo = shiftPeriodo(periodo, 1);
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
            monto_bs: data.monto_bs,
            tasa_bcv: data.tasa_bcv ?? (nextIni as any).tasa_bcv,
          } as any)
          .eq("id", (nextIni as any).id);
        cascadedPeriodo = nextPeriodo;
      }
    }

    const primary = await recalcCierreForPeriod(supabase, periodo, userId);
    const cascaded = cascadedPeriodo
      ? await recalcCierreForPeriod(supabase, cascadedPeriodo, userId)
      : null;

    return { primary, cascaded };
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

