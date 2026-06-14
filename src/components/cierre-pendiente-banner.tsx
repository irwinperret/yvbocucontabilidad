import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle } from "lucide-react";

/**
 * Banner persistente: si el mes anterior tiene movimientos y aún no fue cerrado,
 * recordamos al usuario con CTA directo a "COGS e Inventario".
 */
export function CierrePendienteBanner() {
  const { data } = useQuery({
    queryKey: ["cierre-pendiente-banner"],
    staleTime: 60_000,
    queryFn: async () => {
      const hoy = new Date();
      const ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const periodoAnt = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, "0")}`;
      const firstAnt = `${periodoAnt}-01`;
      const lastAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0).toISOString().slice(0, 10);

      const [cierreRes, txRes] = await Promise.all([
        supabase.from("cierres_de_mes").select("id").eq("periodo", periodoAnt).maybeSingle(),
        supabase
          .from("transacciones")
          .select("id", { count: "exact", head: true })
          .gte("fecha", firstAnt)
          .lte("fecha", lastAnt),
      ]);

      return {
        periodo: periodoAnt,
        cerrado: !!cierreRes.data,
        movimientos: txRes.count ?? 0,
      };
    },
  });

  if (!data || data.cerrado || data.movimientos === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 p-3 flex items-start gap-3">
      <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <strong>Mes {data.periodo} sin cerrar</strong> — tiene {data.movimientos.toLocaleString()} movimientos.
        El COGS de ese período queda en cero y el G&amp;P no refleja la realidad hasta que lo cierres.
      </div>
      <Link
        to="/registrar"
        search={{ tab: "cierre" }}
        className="text-sm font-semibold px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap"
      >
        Cerrar mes →
      </Link>
    </div>
  );
}
