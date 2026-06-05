import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { DeleteButton } from "@/components/delete-button";
import { ArrowLeftRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/off-balance")({ component: OffBalancePage });

function OffBalancePage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["off-balance"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones").select("*")
        .eq("modo", "off_balance").order("fecha", { ascending: true });
      return data ?? [];
    },
  });

  const { data: diferencial } = useQuery({
    queryKey: ["off-balance-diferencial-mes"],
    queryFn: async () => {
      const hoy = new Date();
      const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
      const [{ data: txs }, { data: tasas }] = await Promise.all([
        supabase.from("transacciones").select("fecha, metodo_pago, monto_usd, tasa_bcv, tasa_paralela")
          .gte("fecha", desde).in("metodo_pago", ["efectivo_usd", "zelle"]),
        supabase.from("tasas_paralela").select("fecha, tasa").gte("fecha", desde),
      ]);
      const byFecha = new Map((tasas ?? []).map((t: any) => [t.fecha, Number(t.tasa)]));
      let total = 0, count = 0, totalUsd = 0;
      for (const t of txs ?? []) {
        const par = t.tasa_paralela != null ? Number(t.tasa_paralela) : byFecha.get(t.fecha);
        if (!par) continue;
        const usd = Number(t.monto_usd) || 0;
        total += usd * (par - Number(t.tasa_bcv));
        totalUsd += usd;
        count++;
      }
      return { total, count, totalUsd };
    },
  });

  const dias = (fecha: string) => Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);

  const migrar = async (t: any) => {
    const { error } = await supabase.from("transacciones").update({ modo: "on_balance" }).eq("id", t.id);
    if (error) return toast.error(error.message);
    await logAudit("transacciones", "MIGRATE", t.id, { ...t, modo: "off_balance" }, { ...t, modo: "on_balance" });
    toast.success("Migrada a on-balance");
    qc.invalidateQueries({ queryKey: ["off-balance"] });
  };

  const eliminar = async (t: any) => {
    const { error } = await supabase.from("transacciones").delete().eq("id", t.id);
    if (error) throw error;
    await logAudit("transacciones", "DELETE", t.id, t, null);
    toast.success("Eliminada");
    qc.invalidateQueries({ queryKey: ["off-balance"] });
  };

  const badge = (d: number) => {
    if (d > 15) return <Badge variant="destructive">crítico {d}d</Badge>;
    if (d > 7) return <Badge className="bg-orange-500">advert. {d}d</Badge>;
    return <Badge className="bg-green-600">reciente {d}d</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Off balance</h1>
        <p className="text-sm text-muted-foreground">Movimientos pendientes de migrar al flujo principal</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" /> Diferencial cambiario (mes actual)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">USD × (paralela − BCV) · informativo, no afecta G&amp;P</p>
          </div>
          <Button asChild variant="outline" size="sm"><Link to="/diferencial-cambiario">Ver detalle</Link></Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Movimientos USD</div>
              <div className="text-xl font-bold mono">{diferencial?.count ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Volumen</div>
              <div className="text-xl font-bold mono">{fmtUsd(diferencial?.totalUsd ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Diferencial total</div>
              <div className={`text-xl font-bold mono ${(diferencial?.total ?? 0) >= 0 ? "text-orange-600" : "text-green-700"}`}>
                {(diferencial?.total ?? 0) >= 0 ? "+" : ""}{fmtBs(diferencial?.total ?? 0)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader><CardTitle className="text-base">Pendientes</CardTitle></CardHeader>
        <CardContent>
          {!data || data.length === 0 ? <p className="text-sm text-muted-foreground">Sin pendientes.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Cuenta</th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Urgencia</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((t: any) => {
                    const d = dias(t.fecha);
                    return (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-2 px-2 mono">{fmtDate(t.fecha)}</td>
                        <td className="py-2 px-2">{t.cuenta_codigo}</td>
                        <td className="py-2 px-2">{t.centro_costo}</td>
                        <td className="py-2 px-2 text-right mono">{fmtUsd(Number(t.monto_bs) / Number(t.tasa_paralela || t.tasa_bcv || 1))}</td>
                        <td className="py-2 px-2">{badge(d)}</td>
                        <td className="py-2 px-2 flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => migrar(t)}>Migrar</Button>
                          <DeleteButton
                            fecha={t.fecha}
                            detail={`${t.cuenta_codigo} · ${t.centro_costo} · ${fmtUsd(Number(t.monto_bs)/Number(t.tasa_bcv||1))} · ${fmtDate(t.fecha)}`}
                            onConfirm={() => eliminar(t)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
