import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { DeleteButton } from "@/components/delete-button";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/cxc")({ component: CxCPage });

function CxCPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["cxc"],
    queryFn: async () => {
      const { data } = await supabase.from("cuentas_por_cobrar").select("*").order("fecha_vencimiento", { ascending: true });
      return data ?? [];
    },
  });

  const cobrar = async (c: any) => {
    if (!user) return;
    // Crear transacción 1.5 (cobro de crédito anterior) a la tasa BCV de hoy
    const { data: tasa } = await supabase.from("tasas_bcv").select("*").lte("fecha", todayISO()).order("fecha", { ascending: false }).limit(1).maybeSingle();
    if (!tasa) return toast.error("Registra la tasa BCV de hoy primero");
    const tasaHoy = Number(tasa.tasa);
    // La deuda real está en USD: cobramos el pendiente USD a la tasa BCV de HOY
    const pendienteUsd = Number(c.monto_pendiente_usd ?? c.monto_usd);
    const cobroBs = pendienteUsd * tasaHoy;
    const cobroUsd = pendienteUsd;
    const tasaOrig = Number(c.monto_usd) > 0 ? Number(c.monto_bs) / Number(c.monto_usd) : tasaHoy;
    // Dif. cambiaria sobre la porción cobrada
    const fxBs = cobroUsd * (tasaHoy - tasaOrig);
    const fxDeltaUsd = tasaHoy > 0 ? fxBs / tasaHoy : 0;

    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha: todayISO(),
      cuenta_codigo: "1.5",
      centro_costo: c.centro_costo,
      monto_bs: cobroBs, monto_base_bs: cobroBs, iva_bs: 0,
      tasa_bcv: tasaHoy, monto_usd: cobroUsd,
      metodo_pago: "transferencia",
      notas: `Cobro CxC — ${c.cliente}`,
      modo: "on_balance", created_by: user.id,
    } as any).select().single();
    if (error) return toast.error(error.message);
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);

    // Diferencia cambiaria: solo si hay delta material (≥ 0.01 USD)
    if (Math.abs(fxDeltaUsd) >= 0.01) {
      const esGanancia = fxDeltaUsd > 0;
      const cuentaFx = esGanancia ? "11.1" : "11.2";
      const absUsd = Math.abs(fxDeltaUsd);
      const absBs = Math.abs(fxBs);
      const { data: txFx, error: errFx } = await supabase.from("transacciones").insert({
        fecha: todayISO(),
        cuenta_codigo: cuentaFx,
        centro_costo: c.centro_costo,
        monto_bs: absBs, monto_base_bs: absBs, iva_bs: 0,
        tasa_bcv: tasaHoy, monto_usd: absUsd,
        metodo_pago: "transferencia",
        notas: `Dif. cambiaria CxC ${c.cliente} — tasa original ${tasaOrig.toFixed(4)} → hoy ${tasaHoy.toFixed(4)}`,
        modo: "on_balance", created_by: user.id,
      } as any).select().single();
      if (errFx) toast.error("Cobro OK, pero falló el ajuste cambiario: " + errFx.message);
      else if (txFx) await logAudit("transacciones", "INSERT", txFx.id, null, txFx);
    }

    await supabase.from("cuentas_por_cobrar").update({
      estado: "cobrada",
      monto_pendiente_bs: 0,
      monto_pendiente_usd: 0,
      cobrada_at: new Date().toISOString(),
      transaccion_cobro_id: tx!.id,
    }).eq("id", c.id);
    toast.success(
      Math.abs(fxDeltaUsd) >= 0.01
        ? `Cobro registrado · ${fxDeltaUsd > 0 ? "ganancia" : "pérdida"} cambiaria ${fmtUsd(Math.abs(fxDeltaUsd))}`
        : "Cobro registrado"
    );
    qc.invalidateQueries();
  };



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
  const totalVencidas = vencidas.reduce((s: number, c: any) => s + Number(c.monto_usd), 0);
  const totalPorVencer = porVencer.reduce((s: number, c: any) => s + Number(c.monto_usd), 0);
  const totalVigentes = vigentes.reduce((s: number, c: any) => s + Number(c.monto_usd), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cuentas por cobrar</h1>
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
                        <td className="py-2 px-2 text-right mono">{fmtUsd(c.monto_usd)}</td>
                        <td className="py-2 px-2 text-right mono">
                          {fmtUsd(pendUsd)}
                          {parcial && <span className="ml-1 text-[10px] text-orange-600">parcial</span>}
                        </td>
                        <td className="py-2 px-2 text-right mono">{fmtBs(c.monto_bs)}</td>
                        <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                        <td className="py-2 px-2">{estadoBadge(c)}</td>
                        <td className="py-2 px-2 flex justify-end gap-1">
                          {c.estado !== "cobrada" && <Button size="sm" variant="outline" onClick={() => cobrar(c)}>Cobrar saldo</Button>}
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
