import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { AnticipoProveedorBanner, type AplicacionSel } from "@/components/anticipo-proveedor-banner";
import { aplicarAnticiposContraFactura } from "@/lib/anticipos-proveedor";

const CUENTA_PAGO_CXP = "13.2";

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
                  {data.map((c: any) => {
                    const pendBs = Number(c.monto_pendiente_bs ?? c.monto_bs);
                    const ratio = Number(c.monto_bs) > 0 ? pendBs / Number(c.monto_bs) : 1;
                    // Saldo pendiente en USD BCV (preferir snapshot frozen)
                    const usdBcvBase = Number(c.monto_pendiente_usd_bcv ?? c.usd_bcv_factura ?? c.monto_usd ?? 0);
                    const pendUsdBcv = c.monto_pendiente_usd_bcv != null
                      ? Number(c.monto_pendiente_usd_bcv)
                      : usdBcvBase * ratio;
                    const tasaBcvSnap = Number(c.tasa_bcv_factura) || (Number(c.monto_bs) > 0 && Number(c.monto_usd) > 0 ? Number(c.monto_bs) / Number(c.monto_usd) : 0);
                    const fechaRef = c.created_at ? String(c.created_at).slice(0, 10) : null;
                    return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 px-2">{c.proveedor ?? "—"}</td>
                      <td className="py-2 px-2 mono text-xs">{c.numero_factura ?? "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(pendBs)}</td>
                      <td className="py-2 px-2 text-right mono">
                        <div>{fmtUsd(pendUsdBcv)} <span className="text-[10px] text-muted-foreground">(USD BCV)</span></div>
                        {tasaBcvSnap > 0 && (
                          <div className="text-[10px] text-muted-foreground font-normal">
                            BCV {tasaBcvSnap.toFixed(2)}{fechaRef ? ` · ${fmtDate(fechaRef)}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                      <td className="py-2 px-2">{badge(c)}</td>
                      <td className="py-2 px-2 flex justify-end gap-1">
                        <Button size="sm" onClick={() => setPagando(c)}>Pagar</Button>
                        <DeleteButton
                          detail={`${c.proveedor} · Fact ${c.numero_factura} · ${fmtBs(pendBs)}`}
                          warnings={["Se eliminará también la transacción asociada del G&P."]}
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

export function PagoModal({ cxp, userId, onClose, onDone }: { cxp: any; userId: string; onClose: () => void; onDone: () => void }) {
  const [fecha, setFecha] = useState(todayISO());
  const [tasa, setTasa] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [notas, setNotas] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);
  const [aplicaciones, setAplicaciones] = useState<AplicacionSel[]>([]);

  const { data: txOrigData } = useQuery({
    queryKey: ["cxp-origen-transaccion", cxp.transaccion_id],
    queryFn: async () => {
      if (!cxp.transaccion_id) return null;
      const { data } = await supabase
        .from("transacciones")
        .select("cuenta_codigo, centro_costo, grupo_transaccion_id, monto_bs, monto_base_bs, iva_bs, tasa_bcv")
        .eq("id", cxp.transaccion_id)
        .maybeSingle();
      return data;
    },
  });

  const pendiente = Number(cxp.monto_pendiente_bs ?? cxp.monto_bs);
  // USD BCV pendiente (deuda inmutable expresada en USD BCV)
  const usdBcvFactura = Number(cxp.usd_bcv_factura ?? cxp.monto_usd ?? 0);
  const pendienteUsdBcv = cxp.monto_pendiente_usd_bcv != null
    ? Number(cxp.monto_pendiente_usd_bcv)
    : (Number(cxp.monto_bs) > 0 ? usdBcvFactura * (pendiente / Number(cxp.monto_bs)) : usdBcvFactura);
  const origTotalBs = Number(txOrigData?.monto_bs ?? cxp.monto_bs ?? 0);
  const origBaseBs = Number(txOrigData?.monto_base_bs ?? origTotalBs) || origTotalBs;
  const origIvaBs = Number(txOrigData?.iva_bs ?? 0);
  const tasaFactura = Number(cxp.tasa_bcv_factura ?? txOrigData?.tasa_bcv ?? 0);
  const baseRatioFactura = origTotalBs > 0 ? origBaseBs / origTotalBs : 1;
  const saldoRatio = usdBcvFactura > 0 ? pendienteUsdBcv / usdBcvFactura : 1;
  const ivaPendienteUsdBcv = tasaFactura > 0 ? +((origIvaBs / tasaFactura) * saldoRatio).toFixed(2) : 0;
  const totalPendienteUsdBcv = +(pendienteUsdBcv + ivaPendienteUsdBcv).toFixed(2);

  // Anticipos: reverso en Bs usa la tasa BCV del anticipo (egresos → BCV)
  const aplicadoUsd = useMemo(
    () => aplicaciones.reduce((s, a) => s + a.aplicarUsd, 0),
    [aplicaciones],
  );
  const aplicadoBs = useMemo(
    () => aplicaciones.reduce(
      (s, a) => s + a.aplicarUsd * Number(a.anticipo.tasa_bcv || 0),
      0,
    ),
    [aplicaciones],
  );

  // Saldo USD BCV restante tras aplicar anticipos (anticipos también se expresan en USD BCV)
  const usdBcvTrasAnticipo = Math.max(0, +(totalPendienteUsdBcv - aplicadoUsd).toFixed(2));

  const { data: bcvSug } = useQuery({
    queryKey: ["tasa-pago", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
      if (data && !tasa) setTasa(String(data.tasa));
      return data;
    },
  });

  const { data: paralelaSug } = useQuery({
    queryKey: ["paralela-pago", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_paralela").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const tasaN = Number(tasa) || 0;
  const tasaParalelaN = Number(paralelaSug?.tasa) || 0;
  // Monto Bs a pagar = USD BCV restante × tasa BCV del pago
  const montoBsSugerido = +(usdBcvTrasAnticipo * tasaN).toFixed(2);
  const [touchedMonto, setTouchedMonto] = useState(false);
  const [montoBs, setMontoBs] = useState(String(pendiente));
  useEffect(() => {
    if (!touchedMonto) setMontoBs(String(montoBsSugerido));
  }, [montoBsSugerido, touchedMonto]);

  const total = Number(montoBs) || 0;
  // Cobertura por USD BCV: lo aplicado por anticipo + lo pagado en Bs convertido a USD BCV
  const usdBcvPagado = tasaN > 0 ? +(total / tasaN).toFixed(2) : 0;
  // USD paralela para FC/contabilidad (mismo patrón que CxC)
  const usd = tasaParalelaN > 0 ? +(total / tasaParalelaN).toFixed(2) : (tasaN ? total / tasaN : 0);

  const pagoBaseBsPreview = +(total * baseRatioFactura).toFixed(2);
  const pagoBaseUsdBcv = tasaN > 0 ? +(pagoBaseBsPreview / tasaN).toFixed(2) : 0;
  const cubreTodo = +(aplicadoUsd + usdBcvPagado).toFixed(2) >= +totalPendienteUsdBcv.toFixed(2) - 0.01;

  const confirmar = async () => {
    if (total > 0 && !tasaN) return toast.error("Falta tasa");
    if (total > 0 && !cuentaBancariaId) return toast.error("Selecciona cuenta bancaria");
    if (total < 0) return toast.error("Monto inválido");
    if (+(aplicadoUsd + usdBcvPagado).toFixed(2) > +totalPendienteUsdBcv.toFixed(2) + 0.01) {
      return toast.error("Anticipo + pago exceden el saldo pendiente");
    }
    if (aplicaciones.length === 0 && total <= 0) return toast.error("Indica un monto a pagar o aplica un anticipo");
    setBusy(true);

    const { data: txOrig } = await supabase
      .from("transacciones")
      .select("cuenta_codigo, centro_costo, grupo_transaccion_id, monto_bs, monto_base_bs, iva_bs")
      .eq("id", cxp.transaccion_id).maybeSingle();
    const grupoId = txOrig?.grupo_transaccion_id ?? crypto.randomUUID();

    // 1) Aplicar anticipos (si hay)
    if (aplicaciones.length > 0) {
      const res = await aplicarAnticiposContraFactura({
        aplicaciones,
        grupoId,
        facturaFecha: fecha,
        facturaProveedorNombre: cxp.proveedor ?? "Proveedor",
        facturaNumero: cxp.numero_factura ?? null,
        created_by: userId,
        centro: (txOrig?.centro_costo ?? cxp.centro_costo ?? "Compartido") as string,
      });
      if (!res.ok) { setBusy(false); return toast.error(`Anticipo: ${res.error}`); }
      // Asegurar vinculación
      if (cxp.transaccion_id && !txOrig?.grupo_transaccion_id) {
        await supabase.from("transacciones").update({ grupo_transaccion_id: grupoId } as any).eq("id", cxp.transaccion_id);
      }
    }

    // 2) Pago en efectivo / transferencia por el remanente.
    // Usa una cuenta puente sin G&P: el gasto ya fue reconocido en la factura original.
    if (total > 0) {
      const usdPago = tasaParalelaN > 0 ? +(total / tasaParalelaN).toFixed(2) : (tasaN ? +(total / tasaN).toFixed(2) : 0);
      const { data: tx, error } = await supabase.from("transacciones").insert({
        fecha,
        cuenta_codigo: CUENTA_PAGO_CXP,
        centro_costo: (txOrig?.centro_costo ?? cxp.centro_costo ?? "Compartido") as any,
        monto_bs: total, monto_base_bs: total, iva_bs: 0,
        iva_aplica: false, tipo_iva: null,
        tasa_bcv: tasaN, tasa_paralela: tasaParalelaN || null, monto_usd: usdPago,
        metodo_pago: metodo as any,
        referencia: ref || null,
        notas: `Pago CxP — ${cxp.proveedor} · Fact ${cxp.numero_factura}${notas ? " · " + notas : ""}`,
        modo: "on_balance" as any,
        cuenta_bancaria_id: cuentaBancariaId || null,
        tercero_id: cxp.tercero_id ?? null,
        grupo_transaccion_id: grupoId,
        created_by: userId,
      } as any).select().single();
      if (error) { setBusy(false); return toast.error(error.message); }
      if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    }

    // 3) Actualizar CxP
    if (cubreTodo) {
      await supabase.from("cuentas_por_pagar").update({
        estado: "pagada",
        pagada_at: new Date().toISOString(),
        monto_pendiente_bs: 0,
        monto_pendiente_usd_bcv: 0,
      }).eq("id", cxp.id);
    } else {
      const nuevoUsdBcv = Math.max(0, +(pendienteUsdBcv - pagoBaseUsdBcv).toFixed(2));
      const nuevoBs = Math.max(0, +(nuevoUsdBcv * (tasaFactura || Number(cxp.tasa_bcv_factura) || 1) / Math.max(baseRatioFactura, 0.000001)).toFixed(2));
      await supabase.from("cuentas_por_pagar").update({
        monto_pendiente_bs: nuevoBs,
        monto_pendiente_usd_bcv: nuevoUsdBcv,
      }).eq("id", cxp.id);
    }

    setBusy(false);
    toast.success(cubreTodo ? "Pago total registrado" : "Pago parcial registrado");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Registrar pago — {cxp.proveedor}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          Saldo pendiente: <span className="mono font-semibold">{fmtUsd(pendienteUsdBcv)}</span> <span className="text-[10px]">(USD BCV neto)</span>
          {ivaPendienteUsdBcv > 0 && <span className="ml-1 text-xs">+ IVA {fmtUsd(ivaPendienteUsdBcv)} BCV</span>}
          {(() => {
            const tasaSnap = Number(cxp.tasa_bcv_factura) || (Number(cxp.monto_bs) > 0 && Number(cxp.monto_usd) > 0 ? Number(cxp.monto_bs) / Number(cxp.monto_usd) : 0);
            const fechaRef = cxp.created_at ? String(cxp.created_at).slice(0, 10) : null;
            return tasaSnap > 0 ? (
              <span className="ml-2 text-xs">(tasa BCV factura {tasaSnap.toFixed(2)}{fechaRef ? ` — ${fmtDate(fechaRef)}` : ""})</span>
            ) : null;
          })()}
          <div className="text-xs mt-0.5">
            Monto a pagar: <span className="mono font-semibold">{fmtBs(montoBsSugerido)}</span>
            {tasaN > 0 && <span className="ml-1">(= {fmtUsd(usdBcvTrasAnticipo)} USD BCV total × {tasaN.toFixed(4)} BCV pago)</span>}
          </div>
        </div>

        {cxp.tercero_id && (
          <div className="mb-3">
            <AnticipoProveedorBanner
              terceroId={cxp.tercero_id}
              facturaTotalUsd={pendienteUsdBcv}
              onAplicacionesChange={(sel) => { setAplicaciones(sel); setTouchedMonto(false); }}
            />
            {aplicaciones.length > 0 && (
              <div className="mt-2 rounded-md bg-green-50 border border-green-300 text-green-900 text-xs p-2 flex justify-between">
                <span>Anticipo a aplicar: <strong className="mono">{fmtUsd(aplicadoUsd)}</strong> (~{fmtBs(aplicadoBs)})</span>
                <span>Diferencia a pagar: <strong className="mono">{fmtBs(montoBsSugerido)}</strong></span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div><Label>Fecha del pago</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Monto Bs {aplicaciones.length > 0 ? "(remanente)" : ""}</Label>
              <Input
                type="number" step="0.01" value={montoBs}
                onChange={(e) => { setTouchedMonto(true); setMontoBs(e.target.value); }}
                className="mono"
              />
            </div>
            <div><Label>Tasa BCV</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} className="mono" /></div>
          </div>
          <div className="rounded-md bg-muted p-2 flex justify-between text-sm">
            <span>USD base pagada (paralelo)</span><span className="mono font-semibold">{fmtUsd(total > 0 && tasaParalelaN > 0 ? pagoBaseBsPreview / tasaParalelaN : usd)}</span>
          </div>
          {total > 0 && (
            <>
              <div>
                <Label>Método</Label>
                <Select value={metodo} onValueChange={setMetodo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>N° referencia</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
              <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
            </>
          )}
          <div><Label>Notas</Label><Input value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          {!cubreTodo && (aplicadoBs + total) > 0 && (
            <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
              Pago parcial — quedará un saldo de {fmtBs(pendiente - aplicadoBs - total)}
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
