import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { DeleteButton } from "@/components/delete-button";
import { logAudit } from "@/lib/audit";
import { METODOS } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";
import { UsdRateBadge } from "@/components/usd-rate-badge";

export const Route = createFileRoute("/_authenticated/cxc")({ component: CxCPage });

function CxCPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [cobrando, setCobrando] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["cxc"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) =>
        await supabase.from("cuentas_por_cobrar").select("*").order("fecha_vencimiento", { ascending: true }).range(from, to),
      );
    },
  });

  const eliminar = async (c: any) => {
    const { error } = await supabase.from("cuentas_por_cobrar").delete().eq("id", c.id);
    if (error) throw error;
    await logAudit("cuentas_por_cobrar", "DELETE", c.id, c, null);
    toast.success("CxC eliminada");
    qc.invalidateQueries({ queryKey: ["cxc"] });
  };

  const estadoBadge = (cxc: any) => {
    if (cxc.estado === "cobrada") return <Badge className="bg-green-600">cobrada</Badge>;
    if (cxc.fecha_vencimiento && cxc.fecha_vencimiento < todayISO()) return <Badge variant="destructive">vencida</Badge>;
    const diff = cxc.fecha_vencimiento ? (new Date(cxc.fecha_vencimiento).getTime() - Date.now()) / 86400000 : 999;
    if (diff <= 7) return <Badge className="bg-orange-500">por vencer</Badge>;
    return <Badge className="bg-green-600">vigente</Badge>;
  };

  const vigentes = (data ?? []).filter((c: any) => c.estado === "vigente");
  const vencidas = vigentes.filter((c: any) => c.fecha_vencimiento && c.fecha_vencimiento < todayISO());
  const porVencer = vigentes.filter((c: any) => c.fecha_vencimiento && c.fecha_vencimiento >= todayISO() && (new Date(c.fecha_vencimiento).getTime() - Date.now()) / 86400000 <= 7);
  const totalVencidas = vencidas.reduce((s: number, c: any) => s + Number(c.monto_pendiente_usd ?? c.monto_usd), 0);
  const totalPorVencer = porVencer.reduce((s: number, c: any) => s + Number(c.monto_pendiente_usd ?? c.monto_usd), 0);
  const totalVigentes = vigentes.reduce((s: number, c: any) => s + Number(c.monto_pendiente_usd ?? c.monto_usd), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cuentas por cobrar</h1>
          <div className="mt-1"><UsdRateBadge /></div>
        <p className="text-sm text-muted-foreground">Ventas a crédito pendientes</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Vencidas" value={fmtUsd(totalVencidas)} count={vencidas.length} color="negative" />
        <Kpi label="Por vencer 7d" value={fmtUsd(totalPorVencer)} count={porVencer.length} color="warning" />
        <Kpi label="Vigentes" value={fmtUsd(totalVigentes - totalVencidas - totalPorVencer)} count={vigentes.length - vencidas.length - porVencer.length} color="positive" />
        <Kpi label="Total" value={fmtUsd(totalVigentes)} count={vigentes.length} color="" />
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
                    <th className="text-left py-2 px-2">N° Orden</th>
                    <th className="text-right py-2 px-2">Original USD</th>
                    <th className="text-right py-2 px-2">Pendiente USD</th>
                    <th className="text-right py-2 px-2">Original Bs (a tasa emisión)</th>
                    <th className="text-left py-2 px-2">Vence</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c: any) => {
                    const pendUsd = Number(c.monto_pendiente_usd ?? c.monto_usd);
                    const parcial = pendUsd > 0 && pendUsd < Number(c.monto_usd) - 0.01;
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="py-2 px-2">{c.cliente}</td>
                        <td className="py-2 px-2">{c.centro_costo}</td>
                        <td className="py-2 px-2 mono text-xs">{(c as any).numero_orden ?? "—"}</td>
                        <td className="py-2 px-2 text-right mono">{fmtUsd(c.monto_usd)}</td>
                        <td className="py-2 px-2 text-right mono">
                          {fmtUsd(pendUsd)}
                          {parcial && <span className="ml-1 text-[10px] text-orange-600">parcial</span>}
                        </td>
                        <td className="py-2 px-2 text-right mono">{fmtBs(c.monto_bs)}</td>
                        <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                        <td className="py-2 px-2">{estadoBadge(c)}</td>
                        <td className="py-2 px-2 flex justify-end gap-1">
                          {c.estado !== "cobrada" && (
                            <Button size="sm" onClick={() => setCobrando(c)}>Cobrar</Button>
                          )}
                          <DeleteButton
                            detail={`${c.cliente} · ${fmtBs(c.monto_bs)} · ${fmtUsd(c.monto_usd)}`}
                            onConfirm={() => eliminar(c)}
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

      {cobrando && (
        <CobroModal
          cxc={cobrando}
          userId={user!.id}
          onClose={() => setCobrando(null)}
          onDone={() => { setCobrando(null); qc.invalidateQueries(); }}
        />
      )}
    </div>
  );
}

function CobroModal({ cxc, userId, onClose, onDone }: { cxc: any; userId: string; onClose: () => void; onDone: () => void }) {
  const pendienteUsd = Number(cxc.monto_pendiente_usd ?? cxc.monto_usd);
  const [fecha, setFecha] = useState(todayISO());
  const [montoUsd, setMontoUsd] = useState(String(pendienteUsd.toFixed(2)));
  const [tasa, setTasa] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [notas, setNotas] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  useQuery({
    queryKey: ["tasa-cobro", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
      if (data && !tasa) setTasa(String(data.tasa));
      return data;
    },
  });

  const { data: paralelaSug } = useQuery({
    queryKey: ["paralela-cobro", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_paralela").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const cobroUsd = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  const tasaParalelaN = Number(paralelaSug?.tasa) || 0;
  const cobroBs = cobroUsd * tasaN;
  const tasaOrig = Number(cxc.monto_usd) > 0 ? Number(cxc.monto_bs) / Number(cxc.monto_usd) : tasaN;
  const fxBs = cobroUsd * (tasaN - tasaOrig);
  const fxDeltaUsd = tasaN > 0 ? fxBs / tasaN : 0;
  const cubreTodo = cobroUsd >= pendienteUsd - 0.01;

  const confirmar = async () => {
    if (!tasaN) return toast.error("Falta tasa BCV");
    if (cobroUsd <= 0) return toast.error("Monto inválido");
    if (cobroUsd > pendienteUsd + 0.01) return toast.error("Excede el pendiente");
    if (!cuentaBancariaId) return toast.error("Selecciona cuenta bancaria");
    setBusy(true);

    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha,
      cuenta_codigo: "1.5",
      centro_costo: cxc.centro_costo,
      monto_bs: cobroBs, monto_base_bs: cobroBs, iva_bs: 0,
      tasa_bcv: tasaN, tasa_paralela: tasaParalelaN || null, monto_usd: cobroUsd,
      metodo_pago: metodo as any,
      referencia: ref || null,
      cuenta_bancaria_id: cuentaBancariaId || null,
      notas: `Cobro CxC — ${cxc.cliente}${notas ? " · " + notas : ""}`,
      modo: "on_balance", created_by: userId,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);

    // Diferencia cambiaria proporcional al cobro (solo ganancia)
    if (fxDeltaUsd >= 0.01) {
      const absUsd = fxDeltaUsd;
      const absBs = Math.abs(fxBs);
      const { data: txFx, error: errFx } = await supabase.from("transacciones").insert({
        fecha,
        cuenta_codigo: "11.1",
        centro_costo: cxc.centro_costo,
        monto_bs: absBs, monto_base_bs: absBs, iva_bs: 0,
        tasa_bcv: tasaN, monto_usd: absUsd,
        metodo_pago: "transferencia",
        notas: `Dif. cambiaria CxC ${cxc.cliente} — tasa original ${tasaOrig.toFixed(4)} → cobro ${tasaN.toFixed(4)}`,
        modo: "on_balance", created_by: userId,
      } as any).select().single();
      if (errFx) toast.error("Cobro OK, pero falló ajuste cambiario: " + errFx.message);
      else if (txFx) await logAudit("transacciones", "INSERT", txFx.id, null, txFx);
    } else if (fxDeltaUsd <= -0.01) {
      toast.info(`Pérdida cambiaria ${fmtUsd(Math.abs(fxDeltaUsd))} no contabilizada (cuenta 11.2 eliminada)`);
    }

    if (cubreTodo) {
      await supabase.from("cuentas_por_cobrar").update({
        estado: "cobrada",
        monto_pendiente_bs: 0,
        monto_pendiente_usd: 0,
        cobrada_at: new Date().toISOString(),
        transaccion_cobro_id: tx!.id,
      }).eq("id", cxc.id);
    } else {
      const nuevoPendUsd = +(pendienteUsd - cobroUsd).toFixed(2);
      const nuevoPendBs = +(nuevoPendUsd * tasaOrig).toFixed(2);
      await supabase.from("cuentas_por_cobrar").update({
        monto_pendiente_usd: nuevoPendUsd,
        monto_pendiente_bs: nuevoPendBs,
      }).eq("id", cxc.id);
    }

    setBusy(false);
    toast.success(cubreTodo ? "Cobro total registrado" : "Cobro parcial registrado");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Registrar cobro — {cxc.cliente}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          Pendiente: <span className="mono font-semibold">{fmtUsd(pendienteUsd)}</span>
        </div>
        <div className="space-y-3">
          <div><Label>Fecha del cobro</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Monto USD a cobrar</Label><Input type="number" step="0.01" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} className="mono" /></div>
            <div><Label>Tasa BCV</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} className="mono" /></div>
          </div>
          <div className="rounded-md bg-muted p-2 flex justify-between text-sm">
            <span>Bs equivalente</span><span className="mono font-semibold">{fmtBs(cobroBs)}</span>
          </div>
          {Math.abs(fxDeltaUsd) >= 0.01 && (
            <div className={`text-xs rounded p-2 border ${fxDeltaUsd > 0 ? "text-green-700 bg-green-50 border-green-300" : "text-orange-700 bg-orange-50 border-orange-300"}`}>
              {fxDeltaUsd > 0 ? "Ganancia" : "Pérdida"} cambiaria proporcional: {fmtUsd(Math.abs(fxDeltaUsd))}
              {fxDeltaUsd < 0 && " (no se contabiliza)"}
            </div>
          )}
          <div>
            <Label>Método</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>N° referencia</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
          <div><Label>Notas</Label><Input value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          {!cubreTodo && cobroUsd > 0 && (
            <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
              Cobro parcial — quedará un saldo de {fmtUsd(pendienteUsd - cobroUsd)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={confirmar} disabled={busy}>{busy ? "Procesando…" : "Confirmar cobro"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
