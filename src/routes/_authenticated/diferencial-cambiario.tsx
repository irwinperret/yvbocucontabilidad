import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/diferencial-cambiario")({
  component: DiferencialPage,
});

const USD_METHODS = new Set(["efectivo_usd", "zelle"]);

function DiferencialPage() {
  const periodos = useMemo(() => {
    const arr: string[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return arr;
  }, []);
  const [periodo, setPeriodo] = useState(periodos[0]);

  const { data, isLoading } = useQuery({
    queryKey: ["diferencial-cambiario", periodo],
    queryFn: async () => {
      const [year, month] = periodo.split("-").map(Number);
      const desde = `${year}-${String(month).padStart(2, "0")}-01`;
      const hastaD = new Date(year, month, 0);
      const hasta = `${hastaD.getFullYear()}-${String(hastaD.getMonth() + 1).padStart(2, "0")}-${String(hastaD.getDate()).padStart(2, "0")}`;

      const [{ data: txs }, { data: tasas }] = await Promise.all([
        supabase
          .from("transacciones")
          .select("*")
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", { ascending: true }),
        supabase
          .from("tasas_paralela")
          .select("*")
          .gte("fecha", desde)
          .lte("fecha", hasta),
      ]);

      const paralelaByFecha = new Map<string, number>(
        (tasas ?? []).map((t: any) => [t.fecha, Number(t.tasa)])
      );

      const filas = (txs ?? [])
        .filter((t: any) => t.metodo_pago && USD_METHODS.has(t.metodo_pago))
        .map((t: any) => {
          const tasaParalela = t.tasa_paralela != null
            ? Number(t.tasa_paralela)
            : paralelaByFecha.get(t.fecha) ?? null;
          const tasaBcv = Number(t.tasa_bcv) || 0;
          const usd = Number(t.monto_usd) || 0;
          const diffPorUsd = tasaParalela ? tasaParalela - tasaBcv : 0;
          const diffBs = diffPorUsd * usd;
          return {
            ...t,
            tasaParalela,
            diffPorUsd,
            diffBs,
            usd,
          };
        });

      const totalUsd = filas.reduce((s, f) => s + f.usd, 0);
      const totalDiffBs = filas.reduce((s, f) => s + f.diffBs, 0);

      return { filas, totalUsd, totalDiffBs };
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Diferencial cambiario</h1>
          <p className="text-sm text-muted-foreground">
            Diferencia informativa (off-balance) entre tasa paralela y BCV para movimientos en USD. No afecta G&amp;P ni FC oficial.
          </p>
        </div>
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{periodos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Movimientos USD</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{data?.filas.length ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Volumen USD</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(data?.totalUsd ?? 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Diferencial total</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold mono ${(data?.totalDiffBs ?? 0) >= 0 ? "text-orange-600" : "text-green-700"}`}>
              {(data?.totalDiffBs ?? 0) >= 0 ? "+" : ""}{fmtBs(data?.totalDiffBs ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">USD × (paralela − BCV)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle por transacción</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> :
            !data?.filas.length ? <p className="text-sm text-muted-foreground">Sin movimientos USD en el período.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2 px-2">Fecha</th>
                      <th className="text-left py-2 px-2">Cuenta</th>
                      <th className="text-left py-2 px-2">Método</th>
                      <th className="text-right py-2 px-2">USD</th>
                      <th className="text-right py-2 px-2">BCV</th>
                      <th className="text-right py-2 px-2">Paralela</th>
                      <th className="text-right py-2 px-2">Δ Bs/USD</th>
                      <th className="text-right py-2 px-2">Diferencial Bs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.filas.map((f: any) => (
                      <tr key={f.id} className="border-b last:border-0">
                        <td className="py-2 px-2 mono">{fmtDate(f.fecha)}</td>
                        <td className="py-2 px-2">{f.cuenta_codigo}</td>
                        <td className="py-2 px-2"><Badge variant="outline" className="text-[10px]">{f.metodo_pago}</Badge></td>
                        <td className="py-2 px-2 text-right mono">{fmtUsd(f.usd)}</td>
                        <td className="py-2 px-2 text-right mono text-muted-foreground">{Number(f.tasa_bcv).toFixed(4)}</td>
                        <td className="py-2 px-2 text-right mono">{f.tasaParalela ? f.tasaParalela.toFixed(4) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-2 px-2 text-right mono">{f.tasaParalela ? f.diffPorUsd.toFixed(4) : "—"}</td>
                        <td className={`py-2 px-2 text-right mono ${f.diffBs >= 0 ? "text-orange-600" : "text-green-700"}`}>
                          {f.tasaParalela ? `${f.diffBs >= 0 ? "+" : ""}${fmtBs(f.diffBs)}` : "—"}
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
