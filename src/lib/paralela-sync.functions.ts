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
      return { tasa, fecha, fuente, status: "existe" as const, anterior: Number(existente.tasa) };
    }

    const { error } = await supabase
      .from("tasas_paralela")
      .insert({ fecha, tasa, registrado_por: userId });
    if (error) throw new Error(error.message);

    return { tasa, fecha, fuente, status: "insertada" as const, anterior: null };
  });
