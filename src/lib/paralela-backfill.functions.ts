import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type HistRow = { fecha: string; promedio: number | null; venta: number | null; compra: number | null };

export const backfillTasaParalela = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const res = await fetch("https://ve.dolarapi.com/v1/historicos/dolares/paralelo", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`dolarapi histórico respondió ${res.status}`);
    const raw = (await res.json()) as HistRow[];

    const desde = "2026-01-01";
    const filas = raw
      .map((r) => {
        const tasa = r.promedio ?? r.venta ?? r.compra;
        const fecha = (r.fecha ?? "").slice(0, 10);
        return { fecha, tasa: tasa ? Number(tasa) : null };
      })
      .filter((r) => r.fecha >= desde && r.tasa && r.tasa > 0) as { fecha: string; tasa: number }[];

    if (!filas.length) {
      return { total: 0, insertadas: 0, existentes: 0, minFecha: null, maxFecha: null };
    }

    const { data: existentes } = await supabase
      .from("tasas_paralela")
      .select("fecha")
      .gte("fecha", desde);
    const existSet = new Set((existentes ?? []).map((e: any) => e.fecha));

    const nuevas = filas.filter((f) => !existSet.has(f.fecha));
    if (nuevas.length) {
      const { error } = await supabase
        .from("tasas_paralela")
        .insert(nuevas.map((f) => ({ fecha: f.fecha, tasa: f.tasa, registrado_por: userId })));
      if (error) throw new Error(error.message);
    }

    const fechas = filas.map((f) => f.fecha).sort();
    return {
      total: filas.length,
      insertadas: nuevas.length,
      existentes: filas.length - nuevas.length,
      minFecha: fechas[0],
      maxFecha: fechas[fechas.length - 1],
    };
  });
