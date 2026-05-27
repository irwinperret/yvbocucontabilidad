import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate, todayISO } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { syncTasaParalela } from "@/lib/paralela-sync.functions";
import { backfillTasaParalela } from "@/lib/paralela-backfill.functions";
import { RefreshCw, History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tasa-paralela")({ component: TasaParalelaPage });

function TasaParalelaPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(todayISO());
  const [tasa, setTasa] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const sync = useServerFn(syncTasaParalela);
  const backfill = useServerFn(backfillTasaParalela);

  const { data: tasas } = useQuery({
    queryKey: ["tasas-paralela-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasas_paralela")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const { data: bcvHoy } = useQuery({
    queryKey: ["bcv-hoy-comparativo"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasas_bcv").select("*")
        .order("fecha", { ascending: false }).limit(30);
      return data ?? [];
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("tasas_paralela").insert({
      fecha, tasa: Number(tasa), registrado_por: user.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Tasa paralela registrada");
      setTasa("");
      qc.invalidateQueries({ queryKey: ["tasas-paralela-list"] });
      qc.invalidateQueries({ queryKey: ["paralela-for"] });
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await sync();
      if (r.status === "insertada") toast.success(`Paralela ${r.tasa} Bs/USD insertada (${r.fecha})`);
      else toast.info(`Ya existía paralela para ${r.fecha}: ${r.anterior} Bs/USD`);
      qc.invalidateQueries({ queryKey: ["tasas-paralela-list"] });
      qc.invalidateQueries({ queryKey: ["paralela-for"] });
    } catch (e: any) {
      toast.error(`No se pudo sincronizar: ${e?.message ?? "error"}`);
    } finally {
      setSyncing(false);
    }
  };

  const bcvByFecha = new Map((bcvHoy ?? []).map((b: any) => [b.fecha, Number(b.tasa)]));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasa paralela</h1>
          <p className="text-sm text-muted-foreground">
            Usada para valorar transacciones en USD (efectivo, Zelle, nómina USD). El diferencial vs BCV es informativo y queda off-balance.
          </p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar ahora"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Nueva tasa paralela (manual)</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div><Label>Tasa paralela (Bs por 1 USD)</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required /></div>
            <Button type="submit" disabled={busy}>{busy ? "..." : "Registrar"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Últimas 30 tasas paralelas</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Fecha</th>
                <th className="text-right py-2">Paralela</th>
                <th className="text-right py-2">BCV</th>
                <th className="text-right py-2">Diferencial</th>
                <th className="text-left py-2 pl-4">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tasas?.map((t: any) => {
                const bcv = bcvByFecha.get(t.fecha);
                const diff = bcv ? Number(t.tasa) - bcv : null;
                const pct = bcv ? (diff! / bcv) * 100 : null;
                return (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 mono">{fmtDate(t.fecha)}</td>
                    <td className="py-2 text-right mono">{Number(t.tasa).toFixed(4)}</td>
                    <td className="py-2 text-right mono text-muted-foreground">{bcv ? bcv.toFixed(4) : "—"}</td>
                    <td className="py-2 text-right mono">
                      {diff !== null
                        ? <span className={diff >= 0 ? "text-orange-600" : "text-green-700"}>{diff >= 0 ? "+" : ""}{diff.toFixed(4)} ({pct!.toFixed(1)}%)</span>
                        : "—"}
                    </td>
                    <td className="py-2 pl-4">
                      {t.fecha === todayISO() ? <Badge className="bg-green-600">Vigente</Badge> : <Badge variant="outline">Histórica</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
