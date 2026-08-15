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
import { guardarVinculosConciliacion } from "@/lib/conciliacion";
import { logAudit } from "@/lib/audit";
import {
  pendienteBsHistorico,
  pendienteUsdBcv,
  pendienteBsAFecha,
  dentroDeTolerancia,
  tasaBcvFactura,
  diferencialCambiario,
  registrarDiferencialCambiario,
} from "@/lib/cxp-saldo";

const CUENTA_PAGO_CXP = "13.2";
const CUENTA_ANTICIPO = "14.2";

/** Marca en `referencia` de los pagos creados desde el pareo manual. */
export const marcaPareo = (movId: string) => `PAREO:${movId}`;
/** Marca en `detalle` que enlaza el pago con la CxP aplicada. */
const marcaCxp = (cxpId: string, monto: number) => `PAREO_CXP:${cxpId}|${monto.toFixed(2)}`;

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

  useEffect(() => { setSel([]); }, [terceroId]);

  const seleccionadas = useMemo(() => (cxps ?? []).filter((c) => sel.includes(c.id)), [cxps, sel]);
  const totalSel = useMemo(() => seleccionadas.reduce((s, c) => s + pendienteBsDe(c), 0), [seleccionadas]);
  const diferencia = +(montoMov - totalSel).toFixed(2);

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
      const { data: bcv } = await tasaBcvQuery(fecha, "tasa");
      const tasaBcv = Number(bcv?.tasa) || Number(mov.tasa_bcv) || 0;
      const { data: par } = await supabase
        .from("tasas_paralela").select("tasa").lte("fecha", fecha)
        .order("fecha", { ascending: false }).limit(1).maybeSingle();
      const tasaPar = Number(par?.tasa) || Number(mov.tasa_paralela) || 0;

      const previos = seleccionadas.map((c) => ({
        id: c.id,
        estado: c.estado,
        monto_pendiente_bs: c.monto_pendiente_bs,
        monto_pendiente_usd_bcv: c.monto_pendiente_usd_bcv,
        pagada_at: c.pagada_at,
      }));
      const creadas: string[] = [];
      let restante = montoMov;

      for (const c of seleccionadas) {
        const pend = pendienteBsDe(c);
        const aplicar = +Math.min(pend, restante).toFixed(2);
        if (aplicar <= 0.01) continue;
        restante = +(restante - aplicar).toFixed(2);

        const { data: txOrig } = await supabase
          .from("transacciones")
          .select("cuenta_codigo, centro_costo, grupo_transaccion_id")
          .eq("id", c.transaccion_id)
          .maybeSingle();
        const grupoId = txOrig?.grupo_transaccion_id ?? crypto.randomUUID();
        if (c.transaccion_id && !txOrig?.grupo_transaccion_id) {
          await supabase.from("transacciones").update({ grupo_transaccion_id: grupoId } as any).eq("id", c.transaccion_id);
        }

        const { calcularSplitIvaPagoCxp } = await import("@/lib/iva-helpers");
        const { data: ivaLegs } = await supabase
          .from("transacciones").select("id").eq("grupo_transaccion_id", grupoId)
          .eq("cuenta_codigo", "12.5").gt("monto_bs", 0).limit(1);
        const split = await calcularSplitIvaPagoCxp(grupoId, aplicar, (ivaLegs?.length ?? 0) > 0);

        const { data: tx, error } = await supabase.from("transacciones").insert({
          fecha,
          cuenta_codigo: CUENTA_PAGO_CXP,
          centro_costo: (txOrig?.centro_costo ?? c.centro_costo ?? mov.centro_costo ?? "Compartido") as any,
          monto_bs: aplicar,
          monto_base_bs: split.monto_base_bs,
          iva_bs: split.iva_bs,
          iva_aplica: split.iva_bs > 0,
          tasa_bcv: tasaBcv,
          tasa_paralela: tasaPar || null,
          monto_usd: tasaPar > 0 ? +(aplicar / tasaPar).toFixed(2) : (tasaBcv > 0 ? +(aplicar / tasaBcv).toFixed(2) : 0),
          metodo_pago: (mov.metodo_pago ?? "transferencia") as any,
          referencia: marcaPareo(mov.id),
          detalle: marcaCxp(c.id, aplicar),
          notas: `Pareo manual de movimiento bancario — Fact ${c.numero_factura ?? "s/n"}`,
          modo: "on_balance" as any,
          cuenta_bancaria_id: mov.cuenta_bancaria_id ?? null,
          tercero_id: terceroId,
          grupo_transaccion_id: grupoId,
          created_by: user.id,
        } as any).select().single();
        if (error) throw new Error(error.message);
        if (tx) { creadas.push(tx.id); await logAudit("transacciones", "INSERT", tx.id, null, tx); }

        const usdBcvAplicado = tasaBcv > 0 ? +(aplicar / tasaBcv).toFixed(2) : 0;
        const nuevoBs = +Math.max(0, pend - aplicar).toFixed(2);
        const nuevoUsd = +Math.max(0, pendienteUsdBcvDe(c) - usdBcvAplicado).toFixed(2);
        await supabase.from("cuentas_por_pagar").update(
          nuevoBs <= 0.01
            ? { estado: "pagada", pagada_at: new Date().toISOString(), monto_pendiente_bs: 0, monto_pendiente_usd_bcv: 0 }
            : { estado: "parcial", monto_pendiente_bs: nuevoBs, monto_pendiente_usd_bcv: nuevoUsd },
        ).eq("id", c.id);
      }

      // Excedente → anticipo a proveedor (14.2)
      if (restante > 0.01 && excedente === "anticipo") {
        const { data: tx, error } = await supabase.from("transacciones").insert({
          fecha,
          cuenta_codigo: CUENTA_ANTICIPO,
          centro_costo: (mov.centro_costo ?? "Compartido") as any,
          monto_bs: restante,
          monto_base_bs: restante,
          iva_bs: 0,
          iva_aplica: false,
          tasa_bcv: tasaBcv,
          tasa_paralela: tasaPar || null,
          monto_usd: tasaPar > 0 ? +(restante / tasaPar).toFixed(2) : 0,
          metodo_pago: (mov.metodo_pago ?? "transferencia") as any,
          referencia: marcaPareo(mov.id),
          detalle: "PAREO_ANTICIPO",
          notas: "Excedente de pareo manual registrado como anticipo a proveedor",
          modo: "on_balance" as any,
          cuenta_bancaria_id: mov.cuenta_bancaria_id ?? null,
          tercero_id: terceroId,
          anticipo_estado: "abierto",
          created_by: user.id,
        } as any).select().single();
        if (error) throw new Error(error.message);
        if (tx) creadas.push(tx.id);
      }

      // Vínculo de conciliación (contra las transacciones-factura de las CxP)
      const facturaIds = seleccionadas.map((c) => c.transaccion_id).filter(Boolean) as string[];
      const estadoVinculo = restante > 0.01 ? "parcial" : "pareado";
      if (facturaIds.length) {
        const r = await guardarVinculosConciliacion({
          movimientoId: mov.id,
          contrapartes: facturaIds,
          estado: estadoVinculo,
          origen: "manual",
          userId: user.id,
        });
        if (!r.ok) throw new Error(r.error ?? "No se pudo guardar el vínculo");
      }

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
                    <th className="text-right py-2 px-2">Pendiente Bs</th>
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
                      <td className="py-1.5 px-2 text-right mono">{fmtBs(pendienteBsDe(c))}</td>
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
          <div className="flex justify-between"><span>Seleccionado:</span><span className="mono">{fmtBs(totalSel)}</span></div>
          <div className={`flex justify-between font-semibold ${Math.abs(diferencia) < 0.01 ? "text-green-600" : "text-destructive"}`}>
            <span>Diferencia:</span><span className="mono">{fmtBs(diferencia)}</span>
          </div>
        </div>

        {diferencia > 0.01 && seleccionadas.length > 0 && (
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

/**
 * Revierte un pareo manual: elimina los pagos 13.2 (y el anticipo si lo hubo),
 * restituye los saldos de las CxP y borra los vínculos de conciliación.
 */
export async function quitarPareoManual(movId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: pagos, error } = await supabase
    .from("transacciones")
    .select("id, detalle, monto_bs, tasa_bcv")
    .eq("referencia", marcaPareo(movId));
  if (error) return { ok: false, error: error.message };

  for (const p of pagos ?? []) {
    const m = String((p as any).detalle ?? "").match(/^PAREO_CXP:([^|]+)\|([\d.]+)$/);
    if (!m) continue;
    const [, cxpId, montoStr] = m;
    const monto = Number(montoStr) || 0;
    const { data: cxp } = await supabase.from("cuentas_por_pagar").select("*").eq("id", cxpId).maybeSingle();
    if (!cxp) continue;
    const tasa = Number((p as any).tasa_bcv) || 0;
    const nuevoBs = +(Number(cxp.monto_pendiente_bs ?? 0) + monto).toFixed(2);
    const nuevoUsd = +(Number(cxp.monto_pendiente_usd_bcv ?? 0) + (tasa > 0 ? monto / tasa : 0)).toFixed(2);
    await supabase.from("cuentas_por_pagar").update({
      estado: nuevoBs >= Number(cxp.monto_bs) - 0.01 ? "pendiente" : "parcial",
      monto_pendiente_bs: nuevoBs,
      monto_pendiente_usd_bcv: nuevoUsd,
      pagada_at: null,
    } as any).eq("id", cxpId);
  }

  const ids = (pagos ?? []).map((p: any) => p.id);
  if (ids.length) {
    const del = await supabase.from("transacciones").delete().in("id", ids);
    if (del.error) return { ok: false, error: del.error.message };
  }
  const delV = await (supabase.from as any)("conciliacion_bancaria").delete().eq("transaccion_bancaria_id", movId);
  if (delV.error) return { ok: false, error: delV.error.message };
  return { ok: true };
}
