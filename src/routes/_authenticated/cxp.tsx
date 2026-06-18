import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/cxp")({ component: CxPAnalisisPage });

function CxPAnalisisPage() {
  const { data } = useQuery({
    queryKey: ["cxp-analisis"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) =>
        await supabase.from("cuentas_por_pagar").select("*").neq("estado", "pagada").order("fecha_vencimiento", { ascending: true }).range(from, to),
      );
    },
  });

  const badge = (c: any) => {
    if (!c.fecha_vencimiento) return <Badge className="bg-green-600">vigente</Badge>;
    if (c.fecha_vencimiento < todayISO()) return <Badge variant="destructive">vencida</Badge>;
    const diff = (new Date(c.fecha_vencimiento).getTime() - Date.now()) / 86400000;
    if (diff <= 7) return <Badge className="bg-orange-500">por vencer</Badge>;
    return <Badge className="bg-green-600">vigente</Badge>;
  };

  const items = data ?? [];
  const vencidas = items.filter((c: any) => c.fecha_vencimiento && c.fecha_vencimiento < todayISO());
  const porVencer = items.filter((c: any) => c.fecha_vencimiento && c.fecha_vencimiento >= todayISO() && (new Date(c.fecha_vencimiento).getTime() - Date.now()) / 86400000 <= 7);
  const pendUsdOf = (c: any) => {
    const pendBs = Number(c.monto_pendiente_bs ?? c.monto_bs);
    const ratio = Number(c.monto_bs) > 0 ? pendBs / Number(c.monto_bs) : 1;
    return Number(c.monto_usd) * ratio;
  };
  const totalVencidas = vencidas.reduce((s: number, c: any) => s + pendUsdOf(c), 0);
  const totalPorVencer = porVencer.reduce((s: number, c: any) => s + pendUsdOf(c), 0);
  const total = items.reduce((s: number, c: any) => s + pendUsdOf(c), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cuentas por pagar — análisis</h1>
        <p className="text-sm text-muted-foreground">Vista de obligaciones pendientes (solo lectura)</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Vencidas" value={fmtUsd(totalVencidas)} count={vencidas.length} color="negative" />
        <Kpi label="Por vencer 7d" value={fmtUsd(totalPorVencer)} count={porVencer.length} color="warning" />
        <Kpi label="Vigentes" value={fmtUsd(total - totalVencidas - totalPorVencer)} count={items.length - vencidas.length - porVencer.length} color="positive" />
        <Kpi label="Total" value={fmtUsd(total)} count={items.length} color="" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? <p className="text-sm text-muted-foreground">Sin pendientes.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Proveedor</th>
                    <th className="text-left py-2 px-2">N° factura</th>
                    <th className="text-left py-2 px-2">N° Orden</th>
                    <th className="text-right py-2 px-2">Pendiente Bs</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Vence</th>
                    <th className="text-left py-2 px-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c: any) => {
                    const pendBs = Number(c.monto_pendiente_bs ?? c.monto_bs);
                    const ratio = Number(c.monto_bs) > 0 ? pendBs / Number(c.monto_bs) : 1;
                    const pendUsd = Number(c.monto_usd) * ratio;
                    const tasa = Number(c.monto_bs) > 0 && Number(c.monto_usd) > 0 ? Number(c.monto_bs) / Number(c.monto_usd) : 0;
                    const fechaRef = c.created_at ? String(c.created_at).slice(0, 10) : null;
                    return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 px-2">{c.proveedor ?? "—"}</td>
                      <td className="py-2 px-2 mono text-xs">{c.numero_factura ?? "—"}</td>
                      <td className="py-2 px-2 mono text-xs">{(c as any).numero_orden ?? "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(pendBs)}</td>
                      <td className="py-2 px-2 text-right mono">
                        <div>{fmtUsd(pendUsd)}</div>
                        {tasa > 0 && (
                          <div className="text-[10px] text-muted-foreground font-normal">
                            BCV {tasa.toFixed(2)}{fechaRef ? ` · ${fmtDate(fechaRef)}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                      <td className="py-2 px-2">{badge(c)}</td>
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

function Kpi({ label, value, count, color }: { label: string; value: string; count: number; color: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold mono ${color === "negative" ? "negative" : color === "warning" ? "text-orange-600" : color === "positive" ? "positive" : ""}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{count} registros</div>
      </CardContent>
    </Card>
  );
}
