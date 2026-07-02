import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtBs, fmtUsd, fmtDate, todayISO, currentPeriod } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { DashboardCharts } from "@/components/dashboard-charts";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, usdVisual } from "@/lib/usd-view-context";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const { data: tasa } = useQuery({
    queryKey: ["tasa-paralela-dashboard", todayISO()],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_paralela").select("*").order("fecha", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });
  const { data: tasaBcv } = useQuery({
    queryKey: ["tasa-bcv-dashboard", todayISO()],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").order("fecha", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });
  const { data: ultimas } = useQuery({
    queryKey: ["ultimas-tx"],
    queryFn: async () => {
      const { data } = await supabase.from("transacciones").select("*").order("created_at", { ascending: false }).limit(8);
      return data ?? [];
    },
  });
  const { data: cxcCount } = useQuery({
    queryKey: ["cxc-count"],
    queryFn: async () => {
      const { count } = await supabase.from("cuentas_por_cobrar").select("*", { count: "exact", head: true }).eq("estado", "vigente");
      return count ?? 0;
    },
  });
  const { data: offCount } = useQuery({
    queryKey: ["off-count"],
    queryFn: async () => {
      const { count } = await supabase.from("transacciones").select("*", { count: "exact", head: true }).eq("modo", "off_balance");
      return count ?? 0;
    },
  });

  const tasaVencida = tasa && tasa.fecha !== todayISO();

  const { mode, label } = useUsdView();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inicio</h1>
          <p className="text-sm text-muted-foreground">Período {currentPeriod()}</p>
        </div>
        <UsdViewToggle />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasa paralela hoy</CardTitle>
          </CardHeader>
          <CardContent>
            {tasa ? (
              <>
                <div className="text-2xl font-bold mono">{Number(tasa.tasa).toFixed(2)}</div>
                <div className="text-xs mt-1 flex items-center gap-2">
                  {tasaVencida ? <Badge variant="destructive">Vencida {fmtDate(tasa.fecha)}</Badge> : <Badge className="bg-green-600">Vigente</Badge>}
                  {tasaBcv && <span className="text-muted-foreground">BCV ref: {Number(tasaBcv.tasa).toFixed(2)}</span>}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Sin tasa paralela. <Link to="/tasa-paralela" className="text-primary underline">Registrar</Link></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">CxC vigentes</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{cxcCount ?? 0}</div></CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Off-balance</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold mono">{offCount ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">No sincronizadas</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Acciones</CardTitle></CardHeader>
          <CardContent>
            <Button asChild size="sm" className="w-full h-auto py-2 whitespace-normal text-center leading-tight"><Link to="/registrar">Registrar movimiento <ArrowRight className="ml-1 h-3 w-3 inline" /></Link></Button>
          </CardContent>
        </Card>
      </div>

      <DashboardCharts />

      <Card>
        <CardHeader><CardTitle className="text-base">Últimos movimientos</CardTitle></CardHeader>
        <CardContent>
          {!ultimas || ultimas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos aún.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Cuenta</th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-right py-2 px-2">Bs</th>
                    <th className="text-right py-2 px-2">{label}</th>
                    <th className="text-left py-2 px-2">Modo</th>
                  </tr>
                </thead>
                <tbody>
                  {ultimas.map((t: any) => {
                    const usd = usdVisual(t, mode);
                    return (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-2 px-2 mono">{fmtDate(t.fecha)}</td>
                        <td className="py-2 px-2">{t.cuenta_codigo}</td>
                        <td className="py-2 px-2">{t.centro_costo}</td>
                        <td className="py-2 px-2 text-right mono">{fmtBs(t.monto_bs)}</td>
                        <td className="py-2 px-2 text-right mono">{usd == null ? "—" : fmtUsd(usd)}</td>
                        <td className="py-2 px-2">
                          {t.modo === "off_balance" ? <Badge variant="outline" className="text-orange-600 border-orange-300">off</Badge> : <Badge variant="outline" className="text-green-700 border-green-300">on</Badge>}
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
