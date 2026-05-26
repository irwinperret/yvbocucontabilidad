import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtBs, fmtUsd, currentPeriod } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/fc")({ component: FCPage });

function FCPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["fc", currentPeriod()],
    queryFn: async () => {
      const start = currentPeriod() + "-01";
      const { data: txs } = await supabase
        .from("transacciones")
        .select("cuenta_codigo, monto_bs, monto_usd, metodo_pago")
        .gte("fecha", start)
        .eq("modo", "on_balance")
        .neq("metodo_pago", "pendiente");
      const { data: cuentas } = await supabase
        .from("plan_de_cuentas")
        .select("codigo, nombre, grupo, afecta_fc")
        .eq("afecta_fc", true);
      return { txs: txs ?? [], cuentas: cuentas ?? [] };
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Cargando…</div>;

  let entradas = 0, salidas = 0, entradasUsd = 0, salidasUsd = 0;
  const detalle: { codigo: string; nombre: string; grupo: string; bs: number; usd: number }[] = [];

  (data?.cuentas ?? []).forEach((c: any) => {
    const items = (data?.txs ?? []).filter((t: any) => t.cuenta_codigo === c.codigo);
    const bs = items.reduce((s, t: any) => s + Number(t.monto_bs), 0);
    const usd = items.reduce((s, t: any) => s + Number(t.monto_usd), 0);
    if (bs === 0) return;
    detalle.push({ codigo: c.codigo, nombre: c.nombre, grupo: c.grupo, bs, usd });
    if (c.grupo === "Ingresos") { entradas += bs; entradasUsd += usd; }
    else { salidas += bs; salidasUsd += usd; }
  });

  const neto = entradas - salidas;
  const netoUsd = entradasUsd - salidasUsd;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Flujo de caja</h1>
        <p className="text-sm text-muted-foreground">Período {currentPeriod()} · excluye movimientos pendientes</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Entradas</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono positive">{fmtBs(entradas)}</div><div className="text-xs mono">{fmtUsd(entradasUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Salidas</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono negative">{fmtBs(salidas)}</div><div className="text-xs mono">{fmtUsd(salidasUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Flujo neto</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold mono ${neto >= 0 ? "positive" : "negative"}`}>{fmtBs(neto)}</div><div className="text-xs mono">{fmtUsd(netoUsd)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle</CardTitle></CardHeader>
        <CardContent>
          {detalle.length === 0 ? <p className="text-sm text-muted-foreground">Sin movimientos.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left py-2 px-2">Cód.</th><th className="text-left py-2 px-2">Cuenta</th><th className="text-left py-2 px-2">Grupo</th><th className="text-right py-2 px-2">Bs</th><th className="text-right py-2 px-2">USD</th></tr>
              </thead>
              <tbody>
                {detalle.map((d) => (
                  <tr key={d.codigo} className="border-b last:border-0">
                    <td className="py-1.5 px-2 text-muted-foreground">{d.codigo}</td>
                    <td className="py-1.5 px-2">{d.nombre}</td>
                    <td className="py-1.5 px-2 text-xs">{d.grupo}</td>
                    <td className="py-1.5 px-2 text-right mono">{fmtBs(d.bs)}</td>
                    <td className="py-1.5 px-2 text-right mono text-xs text-muted-foreground">{fmtUsd(d.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
