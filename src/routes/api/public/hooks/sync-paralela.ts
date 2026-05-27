import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchTasaParalela } from "@/lib/paralela-sync";

// Endpoint público (lo invoca pg_cron diariamente). Sin payload.
// Idempotente: si ya existe tasa paralela para la fecha devuelta por la fuente, no duplica.
export const Route = createFileRoute("/api/public/hooks/sync-paralela")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { tasa, fecha, fuente } = await fetchTasaParalela();

          const { data: existente } = await supabaseAdmin
            .from("tasas_paralela")
            .select("id")
            .eq("fecha", fecha)
            .maybeSingle();

          if (existente) {
            return Response.json({ ok: true, status: "existe", fecha, tasa, fuente });
          }

          const { error } = await supabaseAdmin
            .from("tasas_paralela")
            .insert({ fecha, tasa, registrado_por: null });
          if (error) throw new Error(error.message);

          return Response.json({ ok: true, status: "insertada", fecha, tasa, fuente });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "error desconocido";
          console.error("sync-paralela error:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
