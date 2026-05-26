import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cxp")({ component: CxPPage });

function CxPPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["cxp"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cuentas_por_pagar")
        .select("*, terceros(razon_social)")
        .order("fecha_vencimiento", { ascending: true });
      return data ?? [];
    },
  });

  const marcarPagada = async (id: string) => {
    const { error } = await supabase.from("cuentas_por_pagar").update({ estado: "pagada", pagada_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Marcada como pagada"); qc.invalidateQueries({ queryKey: ["cxp"] }); }
  };

  const badge = (c: any) => {
    if (c.estado === "pagada") return <Badge className="bg-green-600">pagada</Badge>;
    if (c.fecha_vencimiento && c.fecha_vencimiento < todayISO()) return <Badge variant="destructive">vencida</Badge>;
    return <Badge className="bg-green-600">vigente</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cuentas por pagar</h1>
        <p className="text-sm text-muted-foreground">Obligaciones pendientes con proveedores</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Listado</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin obligaciones pendientes.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Proveedor</th>
                    <th className="text-right py-2 px-2">Monto Bs</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Vence</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c: any) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 px-2">{c.terceros?.razon_social ?? "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(c.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(c.monto_usd)}</td>
                      <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                      <td className="py-2 px-2">{badge(c)}</td>
                      <td className="py-2 px-2">
                        {c.estado !== "pagada" && <Button size="sm" variant="outline" onClick={() => marcarPagada(c.id)}>Pagar</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
