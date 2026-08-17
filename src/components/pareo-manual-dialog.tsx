import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchCombobox } from "@/components/search-combobox";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { tasaBcvQuery } from "@/lib/tasas";
import { aplicarPareoCxp, marcaPareo, quitarPareoCxp } from "@/lib/pareo-cxp";
import {
  pendienteBsHistorico,
  pendienteUsdBcv,
  pendienteBsAFecha,
  dentroDeTolerancia,
} from "@/lib/cxp-saldo";


export { marcaPareo };

const pendienteBsDe = (c: any) => pendienteBsHistorico(c);
const pendienteUsdBcvDe = (c: any) => pendienteUsdBcv(c);



export type TerceroOpt = { id: string; razon_social: string; nombre_comercial?: string | null; tipo_rif?: string | null; rif?: string | null };

/**
 * Panel de pareo manual de un movimiento bancario contra las CxP abiertas
 * de un proveedor. Aplica los pagos (13.2), actualiza saldos de CxP y deja
 * el vínculo de conciliación registrado como manual.
 */
export function PareoManualDialog({
  mov,
  proveedorActual,
  onClose,
  onSaved,
}: {
  mov: any;
  proveedorActual?: { id: string; nombre: string } | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [terceroId, setTerceroId] = useState<string | null>(mov.tercero_id ?? proveedorActual?.id ?? null);
  const [sel, setSel] = useState<string[]>([]);
  const [excedente, setExcedente] = useState<"anticipo" | "nada">("nada");
  const [busy, setBusy] = useState(false);

  const montoMov = Math.abs(Number(mov.monto_bs) || 0);
  const fecha = String(mov.fecha);

  const { data: terceros } = useQuery({
    queryKey: ["terceros-pareo-manual"],
    queryFn: async () => {
      const { data } = await supabase
        .from("terceros")
        .select("id,razon_social,nombre_comercial,tipo_rif,rif")
        .order("razon_social");
      return (data ?? []) as TerceroOpt[];
    },
  });

  const opciones = useMemo(
    () =>
      (terceros ?? []).map((t) => ({
        value: t.id,
        label: `${t.nombre_comercial || t.razon_social}${t.rif ? ` · ${t.tipo_rif}-${t.rif}` : ""}`,
        keywords: `${t.razon_social} ${t.nombre_comercial ?? ""} ${t.rif ?? ""}`,
      })),
    [terceros],
  );

  const { data: cxps, isLoading: cargandoCxp } = useQuery({
    queryKey: ["cxp-pareo-manual", terceroId],
    enabled: !!terceroId,
    queryFn: async () => {
      const { data } = await supabase
        .from("cuentas_por_pagar")
        .select("*")
        .eq("tercero_id", terceroId as string)
        .in("estado", ["pendiente", "parcial"])
        .order("created_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  // Tasa BCV del día del movimiento: la deuda (USD BCV) se revalúa a esa tasa.
  const { data: tasaMov } = useQuery({
    queryKey: ["tasa-bcv-pareo", fecha],
    queryFn: async () => {
      const { data } = await tasaBcvQuery(fecha, "tasa");
      return Number(data?.tasa) || Number(mov.tasa_bcv) || 0;
    },
  });
  const tasaBcvMov = Number(tasaMov) || Number(mov.tasa_bcv) || 0;

  useEffect(() => { setSel([]); }, [terceroId]);

  const pendienteHoy = (c: any) => pendienteBsAFecha(c, tasaBcvMov);

  const seleccionadas = useMemo(() => (cxps ?? []).filter((c) => sel.includes(c.id)), [cxps, sel]);
  const totalSel = useMemo(
    () => seleccionadas.reduce((s, c) => s + pendienteBsAFecha(c, tasaBcvMov), 0),
    [seleccionadas, tasaBcvMov],
  );
  const diferencia = +(montoMov - totalSel).toFixed(2);
  const difDespreciable = totalSel > 0 && dentroDeTolerancia(diferencia, totalSel);


  const toggle = (id: string) =>
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const guardarProveedor = async (id: string | null) => {
    setTerceroId(id);
    const { error } = await supabase.from("transacciones").update({ tercero_id: id } as any).eq("id", mov.id);
    if (error) toast.error(error.message);
  };

  const confirmar = async () => {
    if (!user) return;
    if (!terceroId) return toast.error("Selecciona un proveedor");
    if (!seleccionadas.length) return toast.error("Selecciona al menos una factura");
    setBusy(true);
    try {
      const { estadoVinculo, creadas, previos } = await aplicarPareoCxp({
        mov,
        terceroId,
        cxps: seleccionadas,
        excedente: excedente as "anticipo" | "nada",
        userId: user.id,
      });


      toast.success(
        estadoVinculo === "pareado" ? "Movimiento pareado" : "Pareo parcial guardado",
        {
          duration: 15000,
          action: {
            label: "Deshacer",
            onClick: async () => {
              await supabase.from("transacciones").delete().in("id", creadas);
              for (const p of previos) {
                await supabase.from("cuentas_por_pagar").update({
                  estado: p.estado,
                  monto_pendiente_bs: p.monto_pendiente_bs,
                  monto_pendiente_usd_bcv: p.monto_pendiente_usd_bcv,
                  pagada_at: p.pagada_at,
                } as any).eq("id", p.id);
              }
              await (supabase.from as any)("conciliacion_bancaria").delete().eq("transaccion_bancaria_id", mov.id);
              toast.success("Pareo deshecho");
              await onSaved();
            },
          },
        },
      );
      await onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar el pareo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Parear movimiento bancario</DialogTitle>
          <DialogDescription>
            {fmtDate(fecha)} · {fmtBs(montoMov)} · {mov.notas ?? "sin memo"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Proveedor</Label>
          <SearchCombobox
            options={opciones}
            value={terceroId}
            onChange={guardarProveedor}
            placeholder="Buscar proveedor por nombre o RIF…"
            searchPlaceholder="Nombre o RIF…"
            triggerClassName="w-full h-9 text-sm"
            className="w-[420px]"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Facturas abiertas del proveedor</Label>
          {!terceroId ? (
            <p className="text-sm text-muted-foreground">Selecciona un proveedor para ver sus facturas pendientes.</p>
          ) : cargandoCxp ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : !cxps?.length ? (
            <p className="text-sm text-muted-foreground">Este proveedor no tiene facturas pendientes o parciales.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="w-8 py-2 px-2"></th>
                    <th className="text-left py-2 px-2">N° Factura</th>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-right py-2 px-2">Pendiente Bs (a la fecha del pago)</th>
                    <th className="text-right py-2 px-2">Pendiente USD (BCV)</th>
                    <th className="text-left py-2 px-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cxps.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-1.5 px-2">
                        <Checkbox checked={sel.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                      </td>
                      <td className="py-1.5 px-2 mono">{c.numero_factura ?? "—"}</td>
                      <td className="py-1.5 px-2 mono">{c.created_at ? fmtDate(String(c.created_at).slice(0, 10)) : "—"}</td>
                      <td className="py-1.5 px-2 text-right mono">
                        {fmtBs(pendienteHoy(c))}
                        {Math.abs(pendienteHoy(c) - pendienteBsDe(c)) > 0.01 && (
                          <div className="text-[10px] text-muted-foreground">
                            {fmtBs(pendienteBsDe(c))} a la tasa de la factura
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right mono">{fmtUsd(pendienteUsdBcvDe(c))}</td>
                      <td className="py-1.5 px-2">
                        <Badge variant={c.estado === "parcial" ? "secondary" : "outline"} className="text-[10px]">
                          {c.estado}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-md border p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span>Movimiento bancario:</span><span className="mono">{fmtBs(montoMov)}</span></div>
          <div className="flex justify-between">
            <span>Seleccionado (deuda al {fmtDate(fecha)}):</span>
            <span className="mono">{fmtBs(totalSel)}</span>
          </div>
          <div className={`flex justify-between font-semibold ${Math.abs(diferencia) < 0.01 || difDespreciable ? "text-green-600" : "text-destructive"}`}>
            <span>Diferencia:</span><span className="mono">{fmtBs(diferencia)}</span>
          </div>
          {difDespreciable && Math.abs(diferencia) >= 0.01 && (
            <p className="text-[11px] text-muted-foreground">
              Diferencia despreciable (dentro de la tolerancia): la factura se marcará como pagada y el delta se
              registra como diferencial cambiario.
            </p>
          )}
        </div>

        {diferencia > 0.01 && !difDespreciable && seleccionadas.length > 0 && (

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Excedente del movimiento ({fmtBs(diferencia)})</Label>
            <RadioGroup value={excedente} onValueChange={(v) => setExcedente(v as any)} className="space-y-1">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="anticipo" id="exc-anticipo" />
                <Label htmlFor="exc-anticipo" className="text-sm font-normal">Registrar excedente como anticipo (14.2)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="nada" id="exc-nada" />
                <Label htmlFor="exc-nada" className="text-sm font-normal">Dejar sin aplicar</Label>
              </div>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !seleccionadas.length} onClick={confirmar}>
            {busy ? "Guardando…" : "Confirmar pareo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Revierte un pareo manual (delegado a la librería compartida). */
export const quitarPareoManual = quitarPareoCxp;
