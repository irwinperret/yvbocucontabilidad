import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sugerencias para Gastos/Facturas a partir del histórico de transacciones del tercero.
 * Devuelve:
 *  - cuentaTop: cuenta_codigo más usada con este tercero (centro opcional)
 *  - metodoTop: método de pago más usado
 *  - notasRecientes: últimas notas distintas (máx 5) para click-to-fill
 */
export function useGastosSugerencias(terceroId: string, centro?: string) {
  return useQuery({
    queryKey: ["gastos-sugerencias", terceroId, centro ?? ""],
    enabled: !!terceroId,
    queryFn: async () => {
      let q = supabase
        .from("transacciones")
        .select("cuenta_codigo, metodo_pago, notas, centro_costo, fecha")
        .eq("tercero_id", terceroId)
        .not("cuenta_codigo", "in", "(1.9,2.3)")
        .order("fecha", { ascending: false })
        .limit(50);
      const { data } = await q;
      const rows = data ?? [];
      const sameCentro = centro ? rows.filter((r: any) => r.centro_costo === centro) : rows;
      const pool = sameCentro.length >= 3 ? sameCentro : rows;
      const count = (key: string) => {
        const m = new Map<string, number>();
        for (const r of pool) {
          const v = (r as any)[key];
          if (!v) continue;
          m.set(String(v), (m.get(String(v)) ?? 0) + 1);
        }
        let best: string | null = null;
        let bestN = 0;
        for (const [k, n] of m) if (n > bestN) { best = k; bestN = n; }
        return best;
      };
      const notasRecientes = Array.from(
        new Set(pool.map((r: any) => (r.notas ?? "").trim()).filter(Boolean))
      ).slice(0, 5);
      return {
        cuentaTop: count("cuenta_codigo"),
        metodoTop: count("metodo_pago"),
        notasRecientes,
        total: rows.length,
      };
    },
  });
}
