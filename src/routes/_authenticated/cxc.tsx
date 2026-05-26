import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cxc")({ component: CxCPage });

function CxCPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["cxc"],
    queryFn: async () => {
      const { data } = await supabase.from("cuentas_por_cobrar").select("*").order("fecha_vencimiento", { ascending: true });
      return data ?? [];
    },
  });

  const marcarCobrada = async (id: string) => {
    const { error } = await supabase.from("cuentas_por_cobrar").update({ estado: "cobrada", cobrada_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Marcada como cobrada"); qc.invalidateQueries({ queryKey: ["cxc"] }); }
  };

  const estadoBadge = (cxc: any) => {
    if (cxc.estado === "cobrada") return <Badge className="bg-green-600">cobrada</Badge>;
    if (cxc.fecha_vencimiento && cxc.fecha_vencimiento < todayISO()) return <Badge variant="destructive">vencida</Badge>;
    const diff = cxc.fecha_vencimiento ? (new Date(cxc.fecha_vencimiento).getTime() - Date.now()) / 86400000 : 999;
    if (diff <= 7) return <Badge className="bg-orange-500">por vencer</Badge>;
    return <Badge className="bg-green-600">vigente</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cuentas por cobrar</h1>
        <p className="text-sm text-muted-foreground">Ventas a crédito pendientes</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Listado</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cuentas por cobrar.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Cliente</th>
                    <th className="text-left py-2 px-2">Centro</th>
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
                      <td className="py-2 px-2">{c.cliente}</td>
                      <td className="py-2 px-2">{c.centro_costo}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(c.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(c.monto_usd)}</td>
                      <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                      <td className="py-2 px-2">{estadoBadge(c)}</td>
                      <td className="py-2 px-2">
                        {c.estado !== "cobrada" && (
                          <Button size="sm" variant="outline" onClick={() => marcarCobrada(c.id)}>Cobrar</Button>
                        )}
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
