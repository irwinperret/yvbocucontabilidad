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

export const CUENTA_PAGO_CXP = "8.2";
export const CUENTA_ANTICIPO = "9.2";

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
/**
 * Recalcula el estado y el saldo pendiente de UNA factura desde cero, a
 * partir de sus vínculos ACTIVOS en conciliacion_bancaria (pareado/parcial),
 * sumando los movimientos bancarios realmente vinculados. Se usa después de
 * guardar/quitar un vínculo desde guardarVinculosConciliacion(), que crea el
 * vínculo pero — a diferencia de aplicarPareoCxp() — no crea una transacción
 * de pago 8.2 nueva (el movimiento ya existe), así que sin esto la CxP se
 * quedaba "pendiente" para siempre aunque ya estuviera pareada de verdad.
 */
export async function sincronizarCxpDesdeVinculos(facturaId: string): Promise<void> {
  const { data: cxp } = await supabase.from("cuentas_por_pagar").select("*").eq("id", facturaId).maybeSingle();
  if (!cxp) return;
  // Una factura cerrada a mano (pagada sin movimiento bancario) no se recalcula.
  if ((cxp as any).cierre_manual) return;

  const montoOriginalUsdBcv = Number((cxp as any).usd_bcv_factura ?? (cxp as any).monto_usd) || 0;
  if (montoOriginalUsdBcv <= 0) return; // sin base para comparar, no se toca

  const { data: vinculos } = await supabase
    .from("conciliacion_bancaria")
    .select("transaccion_bancaria_id, estado")
    .eq("transaccion_factura_id", facturaId)
    .in("estado", ["pareado", "parcial"]);

  let aplicadoUsdBcv = 0;
  for (const v of vinculos ?? []) {
    const { data: mov } = await supabase
      .from("transacciones")
      .select("monto_bs, tasa_bcv")
      .eq("id", (v as any).transaccion_bancaria_id)
      .maybeSingle();
    if (!mov) continue;
    const tasa = Number((mov as any).tasa_bcv) || 0;
    if (tasa > 0) aplicadoUsdBcv += Math.abs(Number((mov as any).monto_bs) || 0) / tasa;
  }
  aplicadoUsdBcv = +aplicadoUsdBcv.toFixed(2);

  const pendienteUsd = +Math.max(0, montoOriginalUsdBcv - aplicadoUsdBcv).toFixed(2);
  const tasaFactura = tasaBcvFactura(cxp);
  const saldada = pendienteUsd <= 0.01;

  await supabase
    .from("cuentas_por_pagar")
    .update(
      saldada
        ? { estado: "pagada", pagada_at: new Date().toISOString(), monto_pendiente_bs: 0, monto_pendiente_usd_bcv: 0 }
        : {
            estado: aplicadoUsdBcv > 0.01 ? "parcial" : "pendiente",
            pagada_at: null,
            monto_pendiente_usd_bcv: pendienteUsd,
            monto_pendiente_bs: +(pendienteUsd * (tasaFactura || 0)).toFixed(2),
          },
    )
    .eq("id", facturaId);
}

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
      .eq("cuenta_codigo", "7.4")
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
  // El estado del VÍNCULO debe coincidir con el estado REAL que quedó cada
  // CxP (ya actualizada arriba) — antes se recalculaba aparte con un criterio
  // de tolerancia en Bs revaluados a la tasa del día del pago, que podía
  // divergir del criterio en USD BCV usado para la CxP si la tasa cambió
  // entre la fecha de la factura y la fecha del pago (la CxP quedaba
  // "pagada" pero el vínculo se marcaba "parcial", inconsistente).
  const { data: cxpsActualizadas } = await supabase
    .from("cuentas_por_pagar")
    .select("id, estado")
    .in("id", cxps.map((c) => c.id));
  const todasSaldadas = (cxpsActualizadas ?? []).every((c: any) => c.estado === "pagada");
  const estadoVinculo: "pareado" | "parcial" = excedenteReal > 0.01 || !todasSaldadas ? "parcial" : "pareado";

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

// ─────────────────────────────────────────────────────────────
// Pagos "directos": el propio movimiento bancario se registró como pago de
// CxP (cuenta 13.2) desde el importador, sin marca PAREO: y sin fila en
// conciliacion_bancaria. El enlace con la factura es implícito (mismo
// grupo_transaccion_id / número de factura en el detalle).
// ─────────────────────────────────────────────────────────────

/** ¿El movimiento es en sí mismo el pago de la CxP (importador bancario)? */
export function esPagoDirecto(mov: any): boolean {
  return (
    String(mov?.cuenta_codigo) === CUENTA_PAGO_CXP &&
    !String(mov?.referencia ?? "").startsWith("PAREO:")
  );
}

function usdBcvDelPago(mov: any): number {
  const bs = Math.abs(Number(mov?.monto_bs) || 0);
  const tasa = Number(mov?.tasa_bcv) || 0;
  return tasa > 0 ? +(bs / tasa).toFixed(2) : 0;
}

/** Devuelve saldo a una CxP (al liberar un pago). */
async function restaurarCxp(c: any, usdRestaurar: number) {
  const totalUsd = Number(c?.usd_bcv_factura ?? c?.monto_usd ?? 0) || 0;
  const pend = Number(c?.monto_pendiente_usd_bcv ?? 0) || 0;
  const nuevoUsd = +Math.min(totalUsd || pend + usdRestaurar, pend + usdRestaurar).toFixed(2);
  const tasaF = tasaBcvFactura(c) || 0;
  await supabase
    .from("cuentas_por_pagar")
    .update({
      estado: nuevoUsd >= totalUsd - 0.01 ? "pendiente" : nuevoUsd > 0.01 ? "parcial" : "pagada",
      monto_pendiente_usd_bcv: nuevoUsd,
      monto_pendiente_bs: +(nuevoUsd * (tasaF || 1)).toFixed(2),
      pagada_at: nuevoUsd > 0.01 ? null : c?.pagada_at ?? null,
    } as any)
    .eq("id", c.id);
}

/** Aplica un monto en USD BCV a una CxP (al asignar un pago). */
async function aplicarUsdACxp(c: any, usdAplicar: number, tasaPago: number) {
  const pend = pendienteUsdBcv(c);
  const aplicado = Math.min(pend, usdAplicar);
  let nuevo = +Math.max(0, pend - aplicado).toFixed(2);
  const deudaBs = pend * (tasaPago || 1);
  const pagadoBs = aplicado * (tasaPago || 1);
  if (nuevo > 0 && dentroDeTolerancia(pagadoBs - deudaBs, deudaBs)) nuevo = 0;
  const tasaF = tasaBcvFactura(c) || tasaPago || 1;
  await supabase
    .from("cuentas_por_pagar")
    .update({
      estado: nuevo <= 0.01 ? "pagada" : "parcial",
      pagada_at: nuevo <= 0.01 ? new Date().toISOString() : null,
      monto_pendiente_usd_bcv: nuevo,
      monto_pendiente_bs: +(nuevo * tasaF).toFixed(2),
    } as any)
    .eq("id", c.id);
}

/**
 * Libera un pago directo: restituye el saldo de las CxP que cubría y deja el
 * movimiento bancario suelto (sin grupo ni detalle de factura). El movimiento
 * NO se borra: sigue existiendo como transacción bancaria.
 */
export async function liberarPagoDirecto(mov: any, cxps: any[]): Promise<{ ok: boolean; error?: string }> {
  try {
    let restante = usdBcvDelPago(mov);
    for (const c of cxps) {
      if (restante <= 0.01) break;
      const totalUsd = Number(c?.usd_bcv_factura ?? c?.monto_usd ?? 0) || 0;
      const pend = Number(c?.monto_pendiente_usd_bcv ?? 0) || 0;
      const puede = +Math.max(0, totalUsd - pend).toFixed(2);
      const r = Math.min(puede, restante);
      if (r <= 0.01) continue;
      await restaurarCxp(c, r);
      restante = +(restante - r).toFixed(2);
    }
    await supabase
      .from("transacciones")
      .update({ grupo_transaccion_id: crypto.randomUUID(), detalle: null } as any)
      .eq("id", mov.id);
    await (supabase.from as any)("conciliacion_bancaria").delete().eq("transaccion_bancaria_id", mov.id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "No se pudo liberar el pago" };
  }
}

/**
 * Reasigna un pago directo a una o varias facturas: devuelve el saldo a las CxP
 * anteriores, reparte el USD BCV del pago entre las facturas destino (en orden)
 * y deja los vínculos formales registrados.
 */
export async function reasignarPagoDirecto(args: {
  mov: any;
  cxpsActuales: any[];
  /** Factura destino única (compatibilidad) */
  destino?: any;
  /** Facturas destino (una o varias) */
  destinos?: any[];
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { mov, cxpsActuales, userId } = args;
  const destinos = (args.destinos ?? (args.destino ? [args.destino] : [])).filter(Boolean);
  const lib = await liberarPagoDirecto(mov, cxpsActuales);
  if (!lib.ok) return lib;
  if (!destinos.length) return { ok: true };

  const tasaPago = Number(mov?.tasa_bcv) || 0;
  let restante = usdBcvDelPago(mov);
  const aplicadas: any[] = [];

  for (const d of destinos) {
    const { data: fresh } = await supabase
      .from("cuentas_por_pagar")
      .select("*")
      .eq("id", d.id)
      .maybeSingle();
    const c: any = fresh ?? d;
    if (restante > 0.01) {
      const pend = pendienteUsdBcv(c);
      const aplicar = Math.min(pend, restante);
      if (aplicar > 0.01) {
        await aplicarUsdACxp(c, aplicar, tasaPago);
        restante = +(restante - aplicar).toFixed(2);
      }
    }
    aplicadas.push(c);
  }

  // Grupo contable: el de la primera factura destino.
  const primera = aplicadas[0];
  const { data: txf } = await supabase
    .from("transacciones")
    .select("grupo_transaccion_id")
    .eq("id", primera.transaccion_id ?? "")
    .maybeSingle();
  const grupo = txf?.grupo_transaccion_id ?? crypto.randomUUID();
  if (primera.transaccion_id && !txf?.grupo_transaccion_id) {
    await supabase
      .from("transacciones")
      .update({ grupo_transaccion_id: grupo } as any)
      .eq("id", primera.transaccion_id);
  }
  await supabase
    .from("transacciones")
    .update({
      grupo_transaccion_id: grupo,
      detalle: `Pago facturas ${aplicadas.map((c) => c.numero_factura ?? "s/n").join(", ")}`.slice(0, 255),
      tercero_id: primera.tercero_id ?? mov.tercero_id ?? null,
    } as any)
    .eq("id", mov.id);

  const contrapartes = aplicadas.map((c) => c.transaccion_id).filter(Boolean) as string[];
  if (contrapartes.length) {
    const r = await guardarVinculosConciliacion({
      movimientoId: mov.id,
      contrapartes,
      estado: restante > 0.01 ? "parcial" : "pareado",
      origen: "manual",
      userId,
    });
    if (!r.ok) return { ok: false, error: r.error ?? "No se pudo guardar el vínculo" };
  }
  return { ok: true };
}



// ─────────────────────────────────────────────────────────────
// Cierre manual: la factura está pagada pero su movimiento bancario nunca
// va a aparecer (efectivo, cuenta no conciliada, nota de crédito, anulada).
// No crea ninguna transacción: solo cierra la cuenta por pagar.
// ─────────────────────────────────────────────────────────────

/**
 * Ya no se pide un motivo de la lista fija al cerrar una factura sin
 * movimiento — al usuario no le importa esa clasificación, solo la fecha y,
 * si quiere, una nota libre. La columna cierre_manual_motivo se deja en la
 * base (por si algún cierre viejo la tiene) pero no se vuelve a escribir.
 */
export async function cerrarCxpSinMovimiento(args: {
  cxp: any;
  nota?: string | null;
  fecha: string;
  userId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { cxp, nota, fecha, userId } = args;
  const antes = {
    estado: cxp.estado,
    monto_pendiente_bs: cxp.monto_pendiente_bs,
    monto_pendiente_usd_bcv: cxp.monto_pendiente_usd_bcv,
    pagada_at: cxp.pagada_at,
  };
  const despues = {
    estado: "pagada",
    pagada_at: new Date(`${fecha}T12:00:00`).toISOString(),
    monto_pendiente_bs: 0,
    monto_pendiente_usd_bcv: 0,
    cierre_manual: true,
    cierre_manual_nota: nota ?? null,
    cierre_manual_fecha: fecha,
    cierre_manual_por: userId,
    cierre_manual_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("cuentas_por_pagar").update(despues as any).eq("id", cxp.id);
  if (error) return { ok: false, error: error.message };
  await logAudit("cuentas_por_pagar", "UPDATE", cxp.id, antes, despues);
  return { ok: true };
}

export async function reabrirCxpCerradaManual(cxp: any): Promise<{ ok: boolean; error?: string }> {
  const totalUsd = Number(cxp?.usd_bcv_factura ?? cxp?.monto_usd ?? 0) || 0;
  const tasaF = tasaBcvFactura(cxp) || 0;
  const antes = { estado: cxp.estado, cierre_manual: true };
  const despues = {
    estado: "pendiente",
    pagada_at: null,
    monto_pendiente_usd_bcv: totalUsd,
    monto_pendiente_bs: +(totalUsd * (tasaF || 0)).toFixed(2),
    cierre_manual: false,
    cierre_manual_motivo: null,
    cierre_manual_nota: null,
    cierre_manual_fecha: null,
    cierre_manual_por: null,
    cierre_manual_at: null,
  };
  const { error } = await supabase.from("cuentas_por_pagar").update(despues as any).eq("id", cxp.id);
  if (error) return { ok: false, error: error.message };
  await logAudit("cuentas_por_pagar", "UPDATE", cxp.id, antes, despues);
  // Si tenía vínculos activos, que el saldo se recalcule desde ellos.
  await sincronizarCxpDesdeVinculos(cxp.id);
  return { ok: true };
}
