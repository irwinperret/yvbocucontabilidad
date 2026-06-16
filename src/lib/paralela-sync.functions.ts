import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchTasaParalela } from "./paralela-sync";

export const syncTasaParalela = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { tasa, fecha, fuente } = await fetchTasaParalela();

    const { data: existente } = await supabase
      .from("tasas_paralela")
      .select("id, tasa")
      .eq("fecha", fecha)
      .maybeSingle();

    if (existente) {
      return { tasa, fecha, fuente, status: "existe" as const, anterior: Number(existente.tasa), recalculadas: 0 };
    }

    const { error } = await supabase
      .from("tasas_paralela")
      .insert({ fecha, tasa, registrado_por: userId });
    if (error) throw new Error(error.message);

    // Recalcular transacciones de esa fecha con la nueva tasa
    let recalculadas = 0;
    const { data: txs } = await supabase
      .from("transacciones")
      .select("id, monto_bs")
      .eq("fecha", fecha);
    for (const tx of txs ?? []) {
      const usd = +(Number(tx.monto_bs || 0) / tasa).toFixed(2);
      const { error: ue } = await supabase
        .from("transacciones")
        .update({ tasa_paralela: tasa, monto_usd: usd })
        .eq("id", tx.id);
      if (!ue) recalculadas++;
    }

    return { tasa, fecha, fuente, status: "insertada" as const, anterior: null, recalculadas };
  });
