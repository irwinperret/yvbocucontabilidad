import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { logAudit, isPeriodClosed } from "@/lib/audit";
import { CENTROS, METODOS, CAPEX_CATEGORIAS, type Centro } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";

export function EditDialog({ tx, onClose, onSaved }: { tx: any; onClose: () => void; onSaved: () => void }) {
  const [fecha, setFecha] = useState<string>(tx.fecha);
  const [centro, setCentro] = useState<Centro>(tx.centro_costo);
  const [montoUsd, setMontoUsd] = useState<string>(String(tx.monto_usd ?? ""));
  const [tasa, setTasa] = useState<string>(String(tx.tasa_bcv ?? ""));
  const [tasaPar, setTasaPar] = useState<string>(tx.tasa_paralela == null ? "" : String(tx.tasa_paralela));
  const [metodo, setMetodo] = useState<string>(tx.metodo_pago ?? "transferencia");
  const [numFactura, setNumFactura] = useState<string>(tx.numero_factura ?? "");
  const [numOrden, setNumOrden] = useState<string>(tx.numero_orden ?? "");
  const [referencia, setReferencia] = useState<string>(tx.referencia ?? "");
  const [notas, setNotas] = useState<string>(tx.notas ?? "");
  const [detalle, setDetalle] = useState<string>(tx.detalle ?? "");
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>(tx.cuenta_bancaria_id ?? "");
  const [capexCategoria, setCapexCategoria] = useState<string>(tx.capex_categoria ?? "Otros");
  const [busy, setBusy] = useState(false);

  // Hermanos del grupo: se cargan al abrir el diálogo.
  const [hermanos, setHermanos] = useState<any[]>([]);
  const [propagar, setPropagar] = useState(true);
  useEffect(() => {
    if (!tx.grupo_transaccion_id) { setHermanos([]); return; }
    (async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, cuenta_codigo, centro_costo, monto_bs, monto_usd, tasa_bcv, tasa_paralela")
        .eq("grupo_transaccion_id", tx.grupo_transaccion_id)
        .neq("id", tx.id);
      setHermanos(data ?? []);
    })();
  }, [tx.id, tx.grupo_transaccion_id]);

  // Al cambiar la fecha, traer las tasas (última ≤ fecha) de ese día y precargarlas.
  const [tasasNuevaFecha, setTasasNuevaFecha] = useState<{ bcv: number; par: number } | null>(null);
  useEffect(() => {
    if (fecha === tx.fecha) { setTasasNuevaFecha(null); return; }
    let cancelado = false;
    (async () => {
      const [{ data: b }, { data: p }] = await Promise.all([
        supabase.from("tasas_bcv").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelado) return;
      const bcv = Number((b as any)?.tasa) || 0;
      const par = Number((p as any)?.tasa) || 0;
      setTasasNuevaFecha({ bcv, par });
      if (bcv > 0) setTasa(String(bcv));
      if (par > 0) setTasaPar(String(par));
    })();
    return () => { cancelado = true; };
  }, [fecha, tx.fecha]);

  const usdN = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  // Bs se recalcula desde USD usando la tasa paralela vigente en el formulario (o BCV como fallback).
  const tasaParalelaN = Number(tasaPar) || 0;
  const tasaConvN = tasaParalelaN || tasaN;
  const baseUsd = tx.iva_aplica ? usdN / 1.16 : usdN;
  const total = usdN * tasaConvN;            // monto Bs total (con IVA si aplica)
  const base = baseUsd * tasaConvN;          // base Bs sin IVA
  const iva = tx.iva_aplica ? total - base : 0;

  // Detecta qué campos de propagación cambiaron respecto al original.
  const fechaCambio = fecha !== tx.fecha;
  const centroCambio = centro !== tx.centro_costo;
  const tasaCambio =
    tasaN !== Number(tx.tasa_bcv ?? 0) || tasaParalelaN !== Number(tx.tasa_paralela ?? 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await isPeriodClosed(fecha) || await isPeriodClosed(tx.fecha)) {
      return toast.error("Período cerrado — no se puede editar");
    }
    if (!tasaN) return toast.error("Falta tasa");
    if (!usdN) return toast.error("Indica un monto en USD");
    setBusy(true);
    const patch = {
      fecha,
      centro_costo: centro as any,
      monto_bs: total,
      monto_base_bs: base,
      iva_bs: iva,
      tasa_bcv: tasaN,
      tasa_paralela: tasaParalelaN || null,
      monto_usd: usdN,
      metodo_pago: metodo as any,
      numero_factura: numFactura || null,
      numero_orden: numOrden || null,
      referencia: referencia || null,
      notas: notas || null,
      detalle: detalle || null,
      cuenta_bancaria_id: cuentaBancariaId || null,
      capex_categoria: tx.cuenta_codigo === "10.6" ? capexCategoria : tx.capex_categoria ?? null,
    };
    const { data: updated, error } = await supabase
      .from("transacciones")
      .update(patch as any)
      .eq("id", tx.id)
      .select()
      .single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (updated) await logAudit("transacciones", "UPDATE", tx.id, tx, updated);

    // Propagación a hermanos del grupo (solo campos seguros: fecha, centro, tasas).
    let propagados = 0;
    if (propagar && hermanos.length > 0 && (fechaCambio || centroCambio || tasaCambio)) {
      // Validar mes cerrado en la fecha destino de los hermanos (usan la nueva fecha si se propaga).
      const fechaDestino = fechaCambio ? fecha : null;
      if (fechaDestino && await isPeriodClosed(fechaDestino)) {
        toast.warning("La nueva fecha cae en un mes cerrado — se guardó la transacción pero no se propagó al grupo.");
      } else {
        for (const h of hermanos) {
          const hPatch: any = {};
          if (fechaCambio) hPatch.fecha = fecha;
          if (centroCambio) hPatch.centro_costo = centro;
          if (tasaCambio) {
            hPatch.tasa_bcv = tasaN;
            if (tasaParalelaN > 0) hPatch.tasa_paralela = tasaParalelaN;
            // Recalcular monto_usd del hermano preservando su monto_bs.
            const hBs = Number(h.monto_bs) || 0;
            const conv = tasaParalelaN || Number(h.tasa_paralela) || tasaN;
            if (conv > 0) hPatch.monto_usd = +(hBs / conv).toFixed(2);
          }
          const { error: eH } = await supabase
            .from("transacciones")
            .update(hPatch)
            .eq("id", h.id);
          if (!eH) {
            await logAudit("transacciones", "UPDATE", h.id, h, { ...h, ...hPatch });
            propagados++;
          }
        }
      }
    }
    setBusy(false);
    toast.success(
      propagados > 0
        ? `Movimiento actualizado · ${propagados} transacción(es) del grupo propagadas`
        : "Movimiento actualizado",
    );
    onSaved();
  };


  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar movimiento — {tx.cuenta_codigo}</DialogTitle>
        </DialogHeader>
        {hermanos.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
            <div className="font-medium text-foreground">
              Esta transacción tiene {hermanos.length} transacción{hermanos.length === 1 ? "" : "es"} relacionada{hermanos.length === 1 ? "" : "s"} en el mismo grupo:
            </div>
            <ul className="space-y-0.5 max-h-24 overflow-auto">
              {hermanos.map((h) => (
                <li key={h.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{h.cuenta_codigo}</Badge>
                  <span className="text-muted-foreground">{fmtDate(h.fecha)}</span>
                  <span className="mono">{fmtUsd(Number(h.monto_usd) || 0)}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <Checkbox
                checked={propagar}
                onCheckedChange={(v) => setPropagar(v === true)}
                className="mt-0.5"
              />
              <span className="text-foreground">
                Propagar cambios de <b>fecha</b>, <b>centro</b> y <b>tasa</b> a las {hermanos.length} transacción{hermanos.length === 1 ? "" : "es"} relacionada{hermanos.length === 1 ? "" : "s"}.
                <span className="block text-muted-foreground text-[11px] mt-0.5">
                  Los cambios de monto no se propagan automáticamente — si editas IVA, bono o propina hazlo en su registro.
                </span>
              </span>
            </label>
          </div>
        )}
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-3">

          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Centro</Label>
            <Select value={centro} onValueChange={(v) => setCentro(v as Centro)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Monto USD {tx.iva_aplica ? "(IVA incluido)" : ""}</Label>
            <Input type="number" step="0.01" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Tasa BCV</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Tasa paralela</Label>
            <Input type="number" step="0.0001" value={tasaPar} onChange={(e) => setTasaPar(e.target.value)} className="mono" />
          </div>
          {fechaCambio && tasasNuevaFecha && (
            <div className="md:col-span-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              Se aplicarán las tasas del <span className="mono font-semibold">{fecha}</span> — BCV{" "}
              <span className="mono">{tasasNuevaFecha.bcv ? tasasNuevaFecha.bcv.toFixed(2) : "—"}</span>, paralela{" "}
              <span className="mono">{tasasNuevaFecha.par ? tasasNuevaFecha.par.toFixed(2) : "—"}</span>. Puedes
              ajustarlas manualmente arriba.
            </div>
          )}
          <div className="md:col-span-2 rounded-md bg-muted p-2 text-sm flex justify-between">
            <span className="text-muted-foreground">Equivalente Bs {tasaParalelaN ? "(tasa paralela)" : "(tasa BCV)"}</span>
            <span className="mono font-semibold">{fmtBs(total)}</span>
          </div>


          <div>
            <Label>Método</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METODOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>N° factura</Label><Input value={numFactura} onChange={(e) => setNumFactura(e.target.value)} /></div>
          <div><Label>N° orden</Label><Input value={numOrden} onChange={(e) => setNumOrden(e.target.value)} /></div>
          <div className="md:col-span-2">
            <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
          </div>
          <div><Label>Referencia</Label><Input value={referencia} onChange={(e) => setReferencia(e.target.value)} /></div>
          {(() => {
            const labelByCode: Record<string, string> = {
              "10.1": "Prestamista", "10.4": "Beneficiarios",
              "10.5": "Aportante", "10.6": "Descripción activo",
            };
            const lbl = labelByCode[tx.cuenta_codigo];
            if (!lbl && !detalle) return null;
            return (
              <div className="md:col-span-2"><Label>{lbl ?? "Detalle"}</Label><Input value={detalle} onChange={(e) => setDetalle(e.target.value)} /></div>
            );
          })()}
          {tx.cuenta_codigo === "10.6" && (
            <div className="md:col-span-2">
              <Label>Categoría CapEx</Label>
              <Select value={capexCategoria} onValueChange={setCapexCategoria}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAPEX_CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
