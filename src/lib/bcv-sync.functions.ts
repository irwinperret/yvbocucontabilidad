import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchTasaBcv } from "./bcv-sync";

// Trae la tasa de la fuente pública y la inserta (o reemplaza) para la fecha devuelta.
export const syncTasaBcv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { tasa, fecha, fuente } = await fetchTasaBcv();

    // Si ya hay tasa para esa fecha, no duplicar.
    const { data: existente } = await supabase
      .from("tasas_bcv")
      .select("id, tasa")
      .eq("fecha", fecha)
      .maybeSingle();

    if (existente) {
      return { tasa, fecha, fuente, status: "existe" as const, anterior: Number(existente.tasa) };
    }

    const { error } = await supabase
      .from("tasas_bcv")
      .insert({ fecha, tasa, registrado_por: userId });
    if (error) throw new Error(error.message);

    return { tasa, fecha, fuente, status: "insertada" as const, anterior: null };
  });
