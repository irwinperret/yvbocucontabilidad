import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { toast } from "sonner";

export function FacturaDetalleDialog({ factura, onClose, onSaved }: { factura: any; onClose: () => void; onSaved: () => void }) {
  const [proveedor, setProveedor] = useState(factura.proveedor ?? "");
  const [numeroFactura, setNumeroFactura] = useState(factura.numero_factura ?? "");
  const [fechaVencimiento, setFechaVencimiento] = useState(factura.fecha_vencimiento ?? "");
  const [montoBs, setMontoBs] = useState(String(factura.monto_bs ?? ""));
  const [montoUsd, setMontoUsd] = useState(String(factura.monto_usd ?? ""));
  const [guardando, setGuardando] = useState(false);
  const [transaccion, setTransaccion] = useState<any | null>(null);

  useEffect(() => {
    if (!factura.transaccion_id) return;
    supabase.from("transacciones").select("*").eq("id", factura.transaccion_id).maybeSingle().then(({ data }) => setTransaccion(data));
  }, [factura.transaccion_id]);

  const montoCambio = Number(montoBs) !== Number(factura.monto_bs) || Number(montoUsd) !== Number(factura.monto_usd);

  const guardar = async () => {
    setGuardando(true);
    const nuevaTasa = Number(montoUsd) > 0 ? +(Number(montoBs) / Number(montoUsd)).toFixed(6) : 0;
    const { error } = await supabase
      .from("cuentas_por_pagar")
      .update({
        proveedor: proveedor.trim() || null,
        numero_factura: numeroFactura.trim() || null,
        fecha_vencimiento: fechaVencimiento || null,
        monto_bs: Number(montoBs) || 0,
        monto_usd: Number(montoUsd) || 0,
        usd_bcv_factura: Number(montoUsd) || 0,
        ...(montoCambio && nuevaTasa > 0 ? { tasa_bcv_factura: nuevaTasa } : {}),
      } as any)
      .eq("id", factura.id);
    if (error) { setGuardando(false); return toast.error(error.message); }
    if (montoCambio) {
      const { sincronizarCxpDesdeVinculos } = await import("@/lib/pareo-cxp");
      await sincronizarCxpDesdeVinculos(factura.id);
    }
    setGuardando(false);
    toast.success("Factura actualizada");
    onSaved();
  };

  const campos = Object.entries({ ...(factura ?? {}), ...(transaccion ? { transaccion_asociada: transaccion } : {}) })
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .filter(([k]) => !["created_at", "updated_at"].includes(k));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Detalle y edición de factura {numeroFactura || "s/n"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Proveedor</Label><Input value={proveedor} onChange={(e) => setProveedor(e.target.value)} /></div>
            <div><Label className="text-xs">Nº de factura</Label><Input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} /></div>
            <div><Label className="text-xs">Fecha de vencimiento</Label><Input type="date" value={fechaVencimiento ?? ""} onChange={(e) => setFechaVencimiento(e.target.value)} /></div>
            <div><Label className="text-xs">Monto original (Bs)</Label><Input type="number" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} /></div>
            <div><Label className="text-xs">Monto original (USD)</Label><Input type="number" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} /></div>
          </div>
          {montoCambio && <div className="text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded px-2 py-1.5">Cambiaste el monto original. Al guardar, el saldo pendiente se recalcula desde los pagos ya vinculados.</div>}
          <div className="border-t pt-3">
            <div className="text-xs font-medium mb-2">Todos los detalles disponibles</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {campos.map(([k, v]) => (
                <div key={k} className="rounded border px-2 py-1.5 min-w-0">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="font-medium break-words">{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
                </div>
              ))}
            </div>
          </div>
          {transaccion && <div className="text-xs text-muted-foreground">Transacción asociada cargada: {fmtDate(transaccion.fecha)} · {fmtBs(Number(transaccion.monto_bs) || 0)} · {fmtUsd(Number(transaccion.monto_usd) || 0)} USD</div>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
