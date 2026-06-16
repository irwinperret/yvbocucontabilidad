import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { DeleteButton } from "@/components/delete-button";
import { useAuth } from "@/lib/auth-context";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/saldos-bancarios")({ component: SaldosBancariosPage });

type Cuenta = {
  id: string;
  nombre: string;
  banco: string;
  numero: string;
  moneda: "BS" | "USD";
  activa: boolean;
  saldo_inicial: number;
  saldo_inicial_fecha: string | null;
};

type Ajuste = {
  id: string;
  cuenta_bancaria_id: string;
  fecha: string;
  monto: number;
  tipo: "error" | "robo" | "personal" | "otro";
  notas: string | null;
  created_at: string;
};

const TIPO_LABEL: Record<Ajuste["tipo"], string> = {
  error: "Error",
  robo: "Robo / pérdida",
  personal: "Uso personal",
  otro: "Otro",
};

// Cuentas de ingreso a banco (Ingresos del plan + préstamo recibido + aumento de capital).
// Para 13.1 (propinas en tránsito): el signo del monto define si es entrada o salida.
// Todo lo demás con afecta_fc=true es salida.
function esIngreso(grupo: string, codigo: string, monto: number): boolean {
  if (codigo === "13.1") return monto >= 0;
  if (grupo === "Ingresos") return true;
  if (codigo === "10.1" || codigo === "10.5") return true;
  return false;
}

function SaldosBancariosPage() {
  const qc = useQueryClient();
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [ajustando, setAjustando] = useState<Cuenta | null>(null);
  const [verAjustesDe, setVerAjustesDe] = useState<Cuenta | null>(null);

  const { data: cuentas } = useQuery({
    queryKey: ["saldos-bancarios-cuentas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cuentas_bancarias" as any)
        .select("id,nombre,banco,numero,moneda,activa,saldo_inicial,saldo_inicial_fecha")
        .order("activa", { ascending: false })
        .order("nombre");
      if (error) throw error;
      return (data as any[] as Cuenta[]) ?? [];
    },
  });

  const { data: plan } = useQuery({
    queryKey: ["plan-cuentas-min"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,grupo,afecta_fc");
      return (data as any[]) ?? [];
    },
  });

  const { data: transacciones } = useQuery({
    queryKey: ["saldos-bancarios-trx", hasta],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) => {
        return await supabase
          .from("transacciones")
          .select("cuenta_bancaria_id,cuenta_codigo,monto_bs,monto_usd,fecha,modo")
          .eq("modo", "on_balance")
          .not("cuenta_bancaria_id", "is", null)
          .lte("fecha", hasta)
          .range(from, to);
      });
    },
  });

  const { data: ajustes } = useQuery({
    queryKey: ["ajustes-bancarios", hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ajustes_bancarios" as any)
        .select("*")
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      if (error) throw error;
      return (data as any[] as Ajuste[]) ?? [];
    },
  });

  const planMap = useMemo(() => {
    const m: Record<string, { grupo: string; afecta_fc: boolean }> = {};
    (plan ?? []).forEach((p: any) => { m[p.codigo] = { grupo: p.grupo, afecta_fc: p.afecta_fc }; });
    return m;
  }, [plan]);

  const rows = useMemo(() => {
    return (cuentas ?? []).map((c) => {
      const sInicial = Number(c.saldo_inicial) || 0;
      let ingresos = 0;
      let egresos = 0;
      for (const t of transacciones ?? []) {
        if ((t as any).cuenta_bancaria_id !== c.id) continue;
        // Filtrar por fecha del saldo inicial (solo movimientos posteriores cuentan)
        if (c.saldo_inicial_fecha && (t as any).fecha < c.saldo_inicial_fecha) continue;
        const info = planMap[(t as any).cuenta_codigo];
        if (!info || !info.afecta_fc) continue;
        const montoRaw = c.moneda === "USD" ? Number((t as any).monto_usd) : Number((t as any).monto_bs);
        if (!montoRaw) continue;
        const absM = Math.abs(montoRaw);
        if (esIngreso(info.grupo, (t as any).cuenta_codigo, montoRaw)) ingresos += absM;
        else egresos += absM;
      }
      let ajusteTotal = 0;
      for (const a of ajustes ?? []) {
        if (a.cuenta_bancaria_id !== c.id) continue;
        if (c.saldo_inicial_fecha && a.fecha < c.saldo_inicial_fecha) continue;
        ajusteTotal += Number(a.monto) || 0;
      }
      const teorico = sInicial + ingresos - egresos + ajusteTotal;
      return { cuenta: c, sInicial, ingresos, egresos, ajusteTotal, teorico };
    });
  }, [cuentas, transacciones, ajustes, planMap]);

  const fmt = (n: number, m: "BS" | "USD") => (m === "USD" ? fmtUsd(n) : fmtBs(n));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saldos bancarios teóricos</h1>
          <p className="text-sm text-muted-foreground">
            Saldo esperado por cuenta = saldo inicial + ingresos − egresos + ajustes (basado en transacciones registradas)
          </p>
        </div>
        <div>
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Por cuenta</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cuentas bancarias.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Cuenta</th>
                    <th className="text-left py-2 px-2">Moneda</th>
                    <th className="text-right py-2 px-2">Saldo inicial</th>
                    <th className="text-left py-2 px-2 text-[10px]">Desde</th>
                    <th className="text-right py-2 px-2">Ingresos</th>
                    <th className="text-right py-2 px-2">Egresos</th>
                    <th className="text-right py-2 px-2">Ajustes</th>
                    <th className="text-right py-2 px-2">Saldo teórico</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cuenta.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2">
                        <div className="font-medium">{r.cuenta.nombre}</div>
                        <div className="text-xs text-muted-foreground">{r.cuenta.banco} ****{r.cuenta.numero.slice(-4)}</div>
                      </td>
                      <td className="py-2 px-2"><Badge variant="outline">{r.cuenta.moneda}</Badge></td>
                      <td className="py-2 px-2 text-right mono">{fmt(r.sInicial, r.cuenta.moneda)}</td>
                      <td className="py-2 px-2 text-[10px] text-muted-foreground">
                        {r.cuenta.saldo_inicial_fecha ? fmtDate(r.cuenta.saldo_inicial_fecha) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right mono text-green-700">{fmt(r.ingresos, r.cuenta.moneda)}</td>
                      <td className="py-2 px-2 text-right mono text-red-700">{fmt(r.egresos, r.cuenta.moneda)}</td>
                      <td className="py-2 px-2 text-right mono">
                        {r.ajusteTotal === 0 ? "—" : (
                          <button className="underline-offset-2 hover:underline" onClick={() => setVerAjustesDe(r.cuenta)}>
                            {fmt(r.ajusteTotal, r.cuenta.moneda)}
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right mono font-bold">{fmt(r.teorico, r.cuenta.moneda)}</td>
                      <td className="py-2 px-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => setAjustando(r.cuenta)}>+ Ajuste</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">
            Define el saldo inicial y su fecha desde <strong>Cuentas bancarias</strong>. Solo se cuentan movimientos posteriores a esa fecha.
            Las transacciones <em>off balance</em> no se incluyen.
          </p>
        </CardContent>
      </Card>

      {ajustando && (
        <AjusteModal
          cuenta={ajustando}
          onClose={() => setAjustando(null)}
          onDone={() => {
            setAjustando(null);
            qc.invalidateQueries({ queryKey: ["ajustes-bancarios"] });
          }}
        />
      )}
      {verAjustesDe && (
        <AjustesListModal cuenta={verAjustesDe} onClose={() => setVerAjustesDe(null)} />
      )}
    </div>
  );
}

function AjusteModal({ cuenta, onClose, onDone }: { cuenta: Cuenta; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState<Ajuste["tipo"]>("error");
  const [signo, setSigno] = useState<"+" | "-">("-");
  const [monto, setMonto] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(monto);
    if (!n || n <= 0) return toast.error("Monto inválido");
    if (!user) return toast.error("Sin sesión");
    setBusy(true);
    const payload = {
      cuenta_bancaria_id: cuenta.id,
      fecha,
      monto: signo === "+" ? n : -n,
      tipo,
      notas: notas || null,
      registrado_por: user.id,
    };
    const { data, error } = await supabase.from("ajustes_bancarios" as any).insert(payload as any).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) await logAudit("ajustes_bancarios", "INSERT", (data as any).id, null, data);
    toast.success("Ajuste registrado");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ajuste — {cuenta.nombre} ({cuenta.moneda})</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div>
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIPO_LABEL) as Ajuste["tipo"][]).map((k) => (
                    <SelectItem key={k} value={k}>{TIPO_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Signo</Label>
              <Select value={signo} onValueChange={(v) => setSigno(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">− Resta</SelectItem>
                  <SelectItem value="+">+ Suma</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Monto ({cuenta.moneda})</Label>
              <Input type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} required className="mono" />
            </div>
          </div>
          <div><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Describe el motivo del ajuste…" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar ajuste"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AjustesListModal({ cuenta, onClose }: { cuenta: Cuenta; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ajustes-de-cuenta", cuenta.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ajustes_bancarios" as any)
        .select("*")
        .eq("cuenta_bancaria_id", cuenta.id)
        .order("fecha", { ascending: false });
      return (data as any[] as Ajuste[]) ?? [];
    },
  });

  const eliminar = async (a: Ajuste) => {
    const { error } = await supabase.from("ajustes_bancarios" as any).delete().eq("id", a.id);
    if (error) { toast.error(error.message); throw error; }
    await logAudit("ajustes_bancarios", "DELETE", a.id, a, null);
    toast.success("Ajuste eliminado");
    qc.invalidateQueries({ queryKey: ["ajustes-de-cuenta", cuenta.id] });
    qc.invalidateQueries({ queryKey: ["ajustes-bancarios"] });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Ajustes — {cuenta.nombre}</DialogTitle></DialogHeader>
        {!data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ajustes.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Fecha</th>
                <th className="text-left py-2">Tipo</th>
                <th className="text-right py-2">Monto</th>
                <th className="text-left py-2">Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2 mono">{fmtDate(a.fecha)}</td>
                  <td className="py-2"><Badge variant="outline">{TIPO_LABEL[a.tipo]}</Badge></td>
                  <td className={`py-2 text-right mono ${a.monto < 0 ? "text-red-700" : "text-green-700"}`}>
                    {cuenta.moneda === "USD" ? fmtUsd(a.monto) : fmtBs(a.monto)}
                  </td>
                  <td className="py-2 text-xs">{a.notas ?? "—"}</td>
                  <td className="py-2 text-right">
                    <DeleteButton detail={`${fmtDate(a.fecha)} · ${TIPO_LABEL[a.tipo]}`} onConfirm={() => eliminar(a)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
