import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { DeleteButton } from "@/components/delete-button";
import { METODOS } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";

export const Route = createFileRoute("/_authenticated/pagar-cxp")({ component: PagarCxPPage });

function PagarCxPPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [pagando, setPagando] = useState<any | null>(null);

  const { data } = useQuery({
    queryKey: ["cxp-pendientes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cuentas_por_pagar").select("*")
        .neq("estado", "pagada").order("fecha_vencimiento", { ascending: true });
      return data ?? [];
    },
  });

  const badge = (c: any) => {
    if (!c.fecha_vencimiento) return <Badge className="bg-green-600">vigente</Badge>;
    if (c.fecha_vencimiento < todayISO()) return <Badge variant="destructive">vencida</Badge>;
    const diff = (new Date(c.fecha_vencimiento).getTime() - Date.now()) / 86400000;
    if (diff <= 7) return <Badge className="bg-orange-500">por vencer</Badge>;
    return <Badge className="bg-green-600">vigente</Badge>;
  };

  const eliminar = async (c: any) => {
    if (c.transaccion_id) {
      await supabase.from("transacciones").delete().eq("id", c.transaccion_id);
    }
    const { error } = await supabase.from("cuentas_por_pagar").delete().eq("id", c.id);
    if (error) throw error;
    await logAudit("cuentas_por_pagar", "DELETE", c.id, c, null);
    toast.success("CxP eliminada");
    qc.invalidateQueries({ queryKey: ["cxp-pendientes"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pagar cuentas por pagar</h1>
        <p className="text-sm text-muted-foreground">Registra el pago de facturas pendientes (genera el movimiento de FC)</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pendientes</CardTitle></CardHeader>
        <CardContent>
          {!data || data.length === 0 ? <p className="text-sm text-muted-foreground">No hay CxP pendientes.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Proveedor</th>
                    <th className="text-left py-2 px-2">N° factura</th>
                    <th className="text-right py-2 px-2">Pendiente Bs</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Vence</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c: any) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 px-2">{c.proveedor ?? "—"}</td>
                      <td className="py-2 px-2 mono text-xs">{c.numero_factura ?? "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(c.monto_pendiente_bs ?? c.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(c.monto_usd)}</td>
                      <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                      <td className="py-2 px-2">{badge(c)}</td>
                      <td className="py-2 px-2 flex justify-end gap-1">
                        <Button size="sm" onClick={() => setPagando(c)}>Pagar</Button>
                        <DeleteButton
                          detail={`${c.proveedor} · Fact ${c.numero_factura} · ${fmtBs(c.monto_pendiente_bs ?? c.monto_bs)}`}
                          warnings={["Se eliminará también la transacción asociada del G&P."]}
                          onConfirm={() => eliminar(c)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagando && (
        <PagoModal
          cxp={pagando}
          userId={user!.id}
          onClose={() => setPagando(null)}
          onDone={() => { setPagando(null); qc.invalidateQueries(); }}
        />
      )}
    </div>
  );
}

function PagoModal({ cxp, userId, onClose, onDone }: { cxp: any; userId: string; onClose: () => void; onDone: () => void }) {
  const [fecha, setFecha] = useState(todayISO());
  const [montoBs, setMontoBs] = useState(String(cxp.monto_pendiente_bs ?? cxp.monto_bs));
  const [tasa, setTasa] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [notas, setNotas] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSug } = useQuery({
    queryKey: ["tasa-pago", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
      if (data && !tasa) setTasa(String(data.tasa));
      return data;
    },
  });

  const total = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0;
  const usd = tasaN ? total / tasaN : 0;
  const pendiente = Number(cxp.monto_pendiente_bs ?? cxp.monto_bs);
  const esTotal = total >= pendiente;

  const confirmar = async () => {
    if (!tasaN) return toast.error("Falta tasa");
    if (total <= 0) return toast.error("Monto inválido");
    if (total > pendiente) return toast.error("Excede el saldo pendiente");
    setBusy(true);
    // Crear transacción del pago — cuenta 8.1 genérica o usar la misma cuenta original? Usamos la cuenta original para FC
    const { data: txOrig } = await supabase.from("transacciones").select("cuenta_codigo, centro_costo").eq("id", cxp.transaccion_id).maybeSingle();
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha,
      cuenta_codigo: txOrig?.cuenta_codigo ?? "9.1",
      centro_costo: (txOrig?.centro_costo ?? cxp.centro_costo ?? "Compartido") as any,
      monto_bs: total, monto_base_bs: total, iva_bs: 0,
      tasa_bcv: tasaN, monto_usd: usd,
      metodo_pago: metodo as any,
      referencia: ref || null,
      notas: `Pago CxP — ${cxp.proveedor} · Fact ${cxp.numero_factura}${notas ? " · " + notas : ""}`,
      modo: "on_balance" as any,
      cuenta_bancaria_id: cuentaBancariaId || null,
      created_by: userId,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);

    if (esTotal) {
      await supabase.from("cuentas_por_pagar").update({ estado: "pagada", pagada_at: new Date().toISOString(), monto_pendiente_bs: 0 }).eq("id", cxp.id);
    } else {
      await supabase.from("cuentas_por_pagar").update({ monto_pendiente_bs: pendiente - total }).eq("id", cxp.id);
    }
    setBusy(false);
    toast.success(esTotal ? "Pago total registrado" : "Pago parcial registrado");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar pago — {cxp.proveedor}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          Saldo pendiente: <span className="mono font-semibold">{fmtBs(pendiente)}</span>
        </div>
        <div className="space-y-3">
          <div><Label>Fecha del pago</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Monto Bs</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} className="mono" /></div>
            <div><Label>Tasa BCV</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} className="mono" /></div>
          </div>
          <div className="rounded-md bg-muted p-2 flex justify-between text-sm">
            <span>USD</span><span className="mono font-semibold">{fmtUsd(usd)}</span>
          </div>
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
          {!esTotal && total > 0 && (
            <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
              Pago parcial — quedará un saldo de {fmtBs(pendiente - total)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={confirmar} disabled={busy}>{busy ? "Procesando…" : "Confirmar pago"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
