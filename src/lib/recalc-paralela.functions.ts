import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Recalcula monto_usd y tasa_paralela en todas las transacciones de una fecha
 * tras un cambio (insert/update) de la tasa paralela para ese día.
 * monto_bs se mantiene como fuente; monto_usd = monto_bs / tasa_nueva.
 */
export const recalcParalelaPorFecha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fecha: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { fecha } = data;

    const { data: t } = await supabase
      .from("tasas_paralela")
      .select("tasa")
      .lte("fecha", fecha)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();
    const tasa = Number(t?.tasa || 0);
    if (!tasa) return { actualizadas: 0, fecha, tasa: 0 };

    const { data: txs, error: e1 } = await supabase
      .from("transacciones")
      .select("id, monto_bs")
      .eq("fecha", fecha);
    if (e1) throw new Error(e1.message);

    let n = 0;
    for (const tx of txs ?? []) {
      const usd = +(Number(tx.monto_bs || 0) / tasa).toFixed(2);
      const { error } = await supabase
        .from("transacciones")
        .update({ tasa_paralela: tasa, monto_usd: usd })
        .eq("id", tx.id);
      if (!error) n++;
    }
    return { actualizadas: n, fecha, tasa };
  });

/** Recalcula múltiples fechas en lote (para backfill). */
export const recalcParalelaPorFechas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fechas: string[] }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let total = 0;
    for (const fecha of data.fechas) {
      const { data: t } = await supabase
        .from("tasas_paralela")
        .select("tasa")
        .lte("fecha", fecha)
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();
      const tasa = Number(t?.tasa || 0);
      if (!tasa) continue;
      const { data: txs } = await supabase
        .from("transacciones")
        .select("id, monto_bs")
        .eq("fecha", fecha);
      for (const tx of txs ?? []) {
        const usd = +(Number(tx.monto_bs || 0) / tasa).toFixed(2);
        const { error } = await supabase
          .from("transacciones")
          .update({ tasa_paralela: tasa, monto_usd: usd })
          .eq("id", tx.id);
        if (!error) total++;
      }
    }
    return { actualizadas: total, fechas: data.fechas.length };
  });
