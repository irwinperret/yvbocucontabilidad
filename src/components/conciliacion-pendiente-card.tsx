import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { periodoActual, rangoDePeriodo } from "@/lib/home-checklist";

/**
 * Cuenta, para el mes actual, cuántos movimientos bancarios todavía no
 * quedaron resueltos en la conciliación: ni pareados a una factura real, ni
 * marcados a mano como gasto directo / no contable. Agrupa "sin pareo",
 * "posible pareo sin confirmar" y "pendiente de revisión" en un solo
 * número, porque las tres son, en el fondo, "esto necesita que lo mires".
 */
export function ConciliacionPendienteCard() {
  const { data } = useQuery({
    queryKey: ["home-conciliacion-pendiente"],
    staleTime: 60_000,
    queryFn: async () => {
      const periodo = periodoActual();
      const { primero, ultimo } = rangoDePeriodo(periodo);

      const { data: movs, error: eMov } = await supabase
        .from("transacciones")
        .select("id")
        .like("referencia", "BANK:%")
        .neq("standby", true)
        .gte("fecha", primero)
        .lte("fecha", ultimo);
      if (eMov || !movs?.length) return { total: 0, porRevisar: 0 };

      const ids = movs.map((m: any) => m.id);
      const { data: vinculos } = await (supabase.from as any)("conciliacion_bancaria")
        .select("transaccion_bancaria_id, estado, transaccion_factura_id")
        .in("transaccion_bancaria_id", ids);

      const resueltos = new Set<string>();
      for (const v of vinculos ?? []) {
        const resuelto =
          (v.transaccion_factura_id && v.estado !== "rechazado") ||
          v.estado === "gasto_directo" ||
          v.estado === "no_contable";
        if (resuelto) resueltos.add(v.transaccion_bancaria_id);
      }
      return { total: movs.length, porRevisar: movs.length - resueltos.size };
    },
  });

  if (!data || data.porRevisar <= 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
      <CardContent className="p-4 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
        <div className="flex-1 text-sm">
          <strong>{data.porRevisar}</strong> movimiento{data.porRevisar === 1 ? "" : "s"} bancario
          {data.porRevisar === 1 ? "" : "s"} de este mes sin resolver en la conciliación (sin pareo, posible pareo
          sin confirmar, o pendiente de revisión).
        </div>
        <Link
          to="/movimientos-bancarios"
          className="text-sm font-semibold px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap"
        >
          Revisar →
        </Link>
      </CardContent>
    </Card>
  );
}
