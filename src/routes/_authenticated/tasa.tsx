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
import { syncTasaBcv } from "@/lib/bcv-sync.functions";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tasa")({ component: TasaPage });

function TasaPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(todayISO());
  const [tasa, setTasa] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const sync = useServerFn(syncTasaBcv);


  const { data: tasas } = useQuery({
    queryKey: ["tasas-list"],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").order("fecha", { ascending: false });
      return data ?? [];
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("tasas_bcv").insert({
      fecha, tasa: Number(tasa), registrado_por: user.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Tasa registrada");
      setTasa("");
      qc.invalidateQueries({ queryKey: ["tasas-list"] });
      qc.invalidateQueries({ queryKey: ["tasa"] });
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await sync();
      if (r.status === "insertada") toast.success(`Tasa ${r.tasa} Bs/USD insertada (${r.fecha}) · ${r.fuente}`);
      else toast.info(`Ya existía tasa para ${r.fecha}: ${r.anterior} Bs/USD`);
      qc.invalidateQueries({ queryKey: ["tasas-list"] });
      qc.invalidateQueries({ queryKey: ["tasa"] });
    } catch (e: any) {
      toast.error(`No se pudo sincronizar: ${e?.message ?? "error"}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasa BCV</h1>
          <p className="text-sm text-muted-foreground">Registra la tasa diaria para conversión Bs → USD. Sync automático cada día y manual con el botón.</p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar ahora"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Nueva tasa (manual)</CardTitle></CardHeader>

        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div><Label>Tasa (Bs por 1 USD)</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required /></div>
            <Button type="submit" disabled={busy}>{busy ? "..." : "Registrar"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Todas las tasas registradas ({tasas?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 bg-background">
                <tr><th className="text-left py-2">Fecha</th><th className="text-right py-2">Tasa</th><th className="text-left py-2 pl-4">Estado</th></tr>
              </thead>
              <tbody>
                {tasas?.map((t: any) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 mono">{fmtDate(t.fecha)}</td>
                    <td className="py-2 text-right mono">{Number(t.tasa).toFixed(4)}</td>
                    <td className="py-2 pl-4">
                      {t.fecha === todayISO() ? <Badge className="bg-green-600">Vigente</Badge> : <Badge variant="outline">Histórica</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
