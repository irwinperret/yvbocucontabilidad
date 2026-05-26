import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtBs, fmtUsd, currentPeriod } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/gyp")({ component: GyPPage });

function GyPPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["gyp", currentPeriod()],
    queryFn: async () => {
      const start = currentPeriod() + "-01";
      const { data: txs } = await supabase
        .from("transacciones")
        .select("cuenta_codigo, monto_bs, monto_usd, centro_costo")
        .gte("fecha", start)
        .eq("modo", "on_balance");
      const { data: cuentas } = await supabase
        .from("plan_de_cuentas")
        .select("codigo, nombre, grupo, afecta_gyp")
        .eq("afecta_gyp", true);
      return { txs: txs ?? [], cuentas: cuentas ?? [] };
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Cargando…</div>;

  const byGrupo: Record<string, { codigo: string; nombre: string; bs: number; usd: number }[]> = {};
  let totalIng = 0, totalGastos = 0, totalIngUsd = 0, totalGastosUsd = 0;

  (data?.cuentas ?? []).forEach((c: any) => {
    const items = (data?.txs ?? []).filter((t: any) => t.cuenta_codigo === c.codigo);
    const bs = items.reduce((s, t: any) => s + Number(t.monto_bs), 0);
    const usd = items.reduce((s, t: any) => s + Number(t.monto_usd), 0);
    if (bs === 0) return;
    (byGrupo[c.grupo] ||= []).push({ codigo: c.codigo, nombre: c.nombre, bs, usd });
    if (c.grupo === "Ingresos") { totalIng += bs; totalIngUsd += usd; }
    else { totalGastos += bs; totalGastosUsd += usd; }
  });

  const utilidad = totalIng - totalGastos;
  const utilidadUsd = totalIngUsd - totalGastosUsd;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ganancias y Pérdidas</h1>
        <p className="text-sm text-muted-foreground">Período {currentPeriod()} · solo movimientos on-balance</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Ingresos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono positive">{fmtBs(totalIng)}</div><div className="text-xs mono">{fmtUsd(totalIngUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Gastos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono negative">{fmtBs(totalGastos)}</div><div className="text-xs mono">{fmtUsd(totalGastosUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Utilidad</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold mono ${utilidad >= 0 ? "positive" : "negative"}`}>{fmtBs(utilidad)}</div><div className="text-xs mono">{fmtUsd(utilidadUsd)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle</CardTitle></CardHeader>
        <CardContent>
          {Object.entries(byGrupo).map(([grupo, items]) => {
            const totBs = items.reduce((s, i) => s + i.bs, 0);
            const totUsd = items.reduce((s, i) => s + i.usd, 0);
            return (
              <div key={grupo} className="mb-4">
                <div className="flex justify-between items-center bg-muted/50 px-2 py-1.5 text-sm font-semibold rounded">
                  <span>{grupo}</span>
                  <span className="mono">{fmtBs(totBs)} · {fmtUsd(totUsd)}</span>
                </div>
                <table className="w-full text-sm mt-1">
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.codigo} className="border-b last:border-0">
                        <td className="py-1.5 px-2 text-muted-foreground">{i.codigo}</td>
                        <td className="py-1.5 px-2">{i.nombre}</td>
                        <td className="py-1.5 px-2 text-right mono">{fmtBs(i.bs)}</td>
                        <td className="py-1.5 px-2 text-right mono text-xs text-muted-foreground">{fmtUsd(i.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {Object.keys(byGrupo).length === 0 && <p className="text-sm text-muted-foreground">Sin movimientos en el período.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
