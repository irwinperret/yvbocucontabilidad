// Lógica compartida de pareo de movimientos bancarios contra cuentas por pagar.
// La usan el diálogo de pareo manual (movimientos bancarios) y el tablero de
// conciliación por proveedor.

import { supabase } from "@/integrations/supabase/client";
import { tasaBcvQuery } from "@/lib/tasas";
import { guardarVinculosConciliacion } from "@/lib/conciliacion";
import { logAudit } from "@/lib/audit";
import {
  pendienteUsdBcv,
  pendienteBsAFecha,
  dentroDeTolerancia,
  tasaBcvFactura,
} from "@/lib/cxp-saldo";

export const CUENTA_PAGO_CXP = "13.2";
export const CUENTA_ANTICIPO = "14.2";

/** Marca en `referencia` de los pagos creados desde el pareo manual. */
export const marcaPareo = (movId: string) => `PAREO:${movId}`;
/** Marca en `detalle` que enlaza el pago con la CxP aplicada. */
export const marcaCxp = (cxpId: string, monto: number) => `PAREO_CXP:${cxpId}|${monto.toFixed(2)}`;

export type EstadoPrevioCxp = {
  id: string;
  estado: string;
  monto_pendiente_bs: number | null;
  monto_pendiente_usd_bcv: number | null;
  pagada_at: string | null;
};

export type ResultadoPareo = {
  estadoVinculo: "pareado" | "parcial";
  creadas: string[];
  previos: EstadoPrevioCxp[];
};

/**
 * Aplica un movimiento bancario contra una o varias CxP:
 * crea los pagos 13.2 (revaluando la deuda en USD BCV a la tasa del día del
 * movimiento), actualiza los saldos de las CxP, opcionalmente registra el
 * excedente como anticipo (14.2) y guarda el vínculo de conciliación.
 */
export async function aplicarPareoCxp(args: {
  mov: any;
  terceroId: string;
  cxps: any[];
  excedente?: "anticipo" | "nada";
  userId: string;
}): Promise<ResultadoPareo> {
  const { mov, terceroId, cxps, userId } = args;
  const excedente = args.excedente ?? "nada";
  const fecha = String(mov.fecha);
  const montoMov = Math.abs(Number(mov.monto_bs) || 0);

  const { data: bcv } = await tasaBcvQuery(fecha, "tasa");
  const tasaBcv = Number(bcv?.tasa) || Number(mov.tasa_bcv) || 0;
  const { data: par } = await supabase
    .from("tasas_paralela")
    .select("tasa")
    .lte("fecha", fecha)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  const tasaPar = Number(par?.tasa) || Number(mov.tasa_paralela) || 0;

  const previos: EstadoPrevioCxp[] = cxps.map((c) => ({
    id: c.id,
    estado: c.estado,
    monto_pendiente_bs: c.monto_pendiente_bs,
    monto_pendiente_usd_bcv: c.monto_pendiente_usd_bcv,
    pagada_at: c.pagada_at,
  }));
  const creadas: string[] = [];
  let restante = montoMov;
  let quedoPendiente = false;

  for (const c of cxps) {
    const pend = pendienteBsAFecha(c, tasaBcv);
    let aplicar = +Math.min(pend, restante).toFixed(2);
    const saldaCompleta = dentroDeTolerancia(pend - aplicar, pend);
    if (saldaCompleta) aplicar = +Math.min(pend, restante).toFixed(2);
    if (aplicar <= 0.01) continue;
    restante = +(restante - aplicar).toFixed(2);

    const { data: txOrig } = await supabase
      .from("transacciones")
      .select("cuenta_codigo, centro_costo, grupo_transaccion_id")
      .eq("id", c.transaccion_id)
      .maybeSingle();
    const grupoId = txOrig?.grupo_transaccion_id ?? crypto.randomUUID();
    if (c.transaccion_id && !txOrig?.grupo_transaccion_id) {
      await supabase
        .from("transacciones")
        .update({ grupo_transaccion_id: grupoId } as any)
        .eq("id", c.transaccion_id);
    }

    const { calcularSplitIvaPagoCxp } = await import("@/lib/iva-helpers");
    const { data: ivaLegs } = await supabase
      .from("transacciones")
      .select("id")
      .eq("grupo_transaccion_id", grupoId)
      .eq("cuenta_codigo", "12.5")
      .gt("monto_bs", 0)
      .limit(1);
    const split = await calcularSplitIvaPagoCxp(grupoId, aplicar, (ivaLegs?.length ?? 0) > 0);

    const { data: tx, error } = await supabase
      .from("transacciones")
      .insert({
        fecha,
        cuenta_codigo: CUENTA_PAGO_CXP,
        centro_costo: (txOrig?.centro_costo ?? c.centro_costo ?? mov.centro_costo ?? "Compartido") as any,
        monto_bs: aplicar,
        monto_base_bs: split.monto_base_bs,
        iva_bs: split.iva_bs,
        iva_aplica: split.iva_bs > 0,
        tasa_bcv: tasaBcv,
        tasa_paralela: tasaPar || null,
        monto_usd:
          tasaPar > 0 ? +(aplicar / tasaPar).toFixed(2) : tasaBcv > 0 ? +(aplicar / tasaBcv).toFixed(2) : 0,
        metodo_pago: (mov.metodo_pago ?? "transferencia") as any,
        referencia: marcaPareo(mov.id),
        detalle: marcaCxp(c.id, aplicar),
        notas: `Pareo manual de movimiento bancario — Fact ${c.numero_factura ?? "s/n"}`,
        modo: "on_balance" as any,
        cuenta_bancaria_id: mov.cuenta_bancaria_id ?? null,
        tercero_id: terceroId,
        grupo_transaccion_id: grupoId,
        created_by: userId,
      } as any)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (tx) {
      creadas.push(tx.id);
      await logAudit("transacciones", "INSERT", tx.id, null, tx);
    }

    const usdBcvAplicado = tasaBcv > 0 ? +(aplicar / tasaBcv).toFixed(2) : 0;
    const usdRestante = +Math.max(0, pendienteUsdBcv(c) - usdBcvAplicado).toFixed(2);
    const saldada = saldaCompleta || usdRestante <= 0.01;
    if (!saldada) quedoPendiente = true;

    await supabase
      .from("cuentas_por_pagar")
      .update(
        saldada
          ? {
              estado: "pagada",
              pagada_at: new Date().toISOString(),
              monto_pendiente_bs: 0,
              monto_pendiente_usd_bcv: 0,
            }
          : {
              estado: "parcial",
              monto_pendiente_usd_bcv: usdRestante,
              monto_pendiente_bs: +(usdRestante * (tasaBcvFactura(c) || tasaBcv)).toFixed(2),
            },
      )
      .eq("id", c.id);
  }

  // Excedente por encima de la tolerancia → anticipo a proveedor (14.2).
  const excedenteReal = dentroDeTolerancia(restante, montoMov) ? 0 : restante;
  if (excedenteReal > 0.01 && excedente === "anticipo") {
    const { data: tx, error } = await supabase
      .from("transacciones")
      .insert({
        fecha,
        cuenta_codigo: CUENTA_ANTICIPO,
        centro_costo: (mov.centro_costo ?? "Compartido") as any,
        monto_bs: excedenteReal,
        monto_base_bs: excedenteReal,
        iva_bs: 0,
        iva_aplica: false,
        tasa_bcv: tasaBcv,
        tasa_paralela: tasaPar || null,
        monto_usd: tasaPar > 0 ? +(excedenteReal / tasaPar).toFixed(2) : 0,
        metodo_pago: (mov.metodo_pago ?? "transferencia") as any,
        referencia: marcaPareo(mov.id),
        detalle: "PAREO_ANTICIPO",
        notas: "Excedente de pareo registrado como anticipo a proveedor",
        modo: "on_balance" as any,
        cuenta_bancaria_id: mov.cuenta_bancaria_id ?? null,
        tercero_id: terceroId,
        anticipo_estado: "abierto",
        created_by: userId,
      } as any)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (tx) creadas.push(tx.id);
  }

  const facturaIds = cxps.map((c) => c.transaccion_id).filter(Boolean) as string[];
  const estadoVinculo: "pareado" | "parcial" =
    excedenteReal > 0.01 || quedoPendiente ? "parcial" : "pareado";

  if (facturaIds.length) {
    const r = await guardarVinculosConciliacion({
      movimientoId: mov.id,
      contrapartes: facturaIds,
      estado: estadoVinculo,
      origen: "manual",
      userId,
    });
    if (!r.ok) throw new Error(r.error ?? "No se pudo guardar el vínculo");
  }

  return { estadoVinculo, creadas, previos };
}

/**
 * Revierte un pareo: elimina los pagos 13.2 (y el anticipo si lo hubo),
 * restituye los saldos de las CxP y borra los vínculos de conciliación.
 */
export async function quitarPareoCxp(movId: string): Promise<{ ok: boolean; error?: string }> {
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
    await supabase
      .from("cuentas_por_pagar")
      .update({
        estado: nuevoBs >= Number(cxp.monto_bs) - 0.01 ? "pendiente" : "parcial",
        monto_pendiente_bs: nuevoBs,
        monto_pendiente_usd_bcv: nuevoUsd,
        pagada_at: null,
      } as any)
      .eq("id", cxpId);
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
