import { supabase } from "@/integrations/supabase/client";
import { logAudit, isPeriodClosed } from "@/lib/audit";

export type ImportTipo = "ventas" | "compras" | "movimientos";

export const TIPO_LABEL: Record<string, string> = {
  ventas: "Importar ventas (Xetux)",
  compras: "Importar compras (Xetux)",
  movimientos: "Importar movimientos bancarios",
};

export type ImportBatch = {
  id: string;
  tipo: string;
  archivo_nombre: string;
  archivo_tamano: number | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  filas_leidas: number;
  filas_registradas: number;
  filas_omitidas: number;
  total_bs: number;
  total_usd: number;
  estado: string;
  created_by: string | null;
  created_at: string;
  reverted_at: string | null;
  reverted_by: string | null;
};

export type BatchHandle = {
  id: string;
  startedAt: string;
  userId: string;
};

/** Crea el registro de la carga. Devuelve null si falla (la importación sigue igual). */
export async function crearBatch(params: {
  tipo: ImportTipo;
  archivoNombre: string;
  archivoTamano?: number | null;
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  filasLeidas?: number;
  userId: string;
}): Promise<BatchHandle | null> {
  const startedAt = new Date(Date.now() - 2000).toISOString();
  const { data, error } = await supabase
    .from("importaciones" as any)
    .insert({
      tipo: params.tipo,
      archivo_nombre: params.archivoNombre || "(sin nombre)",
      archivo_tamano: params.archivoTamano ?? null,
      fecha_desde: params.fechaDesde ?? null,
      fecha_hasta: params.fechaHasta ?? null,
      filas_leidas: params.filasLeidas ?? 0,
      created_by: params.userId,
    } as any)
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: (data as any).id as string, startedAt, userId: params.userId };
}

/**
 * Etiqueta con el batch todas las filas creadas durante la importación
 * (transacciones, CxP, CxC y propinas), y cierra el registro con los totales.
 */
export async function cerrarBatch(
  handle: BatchHandle | null,
  totals: { filasRegistradas: number; filasOmitidas?: number; totalBs?: number; totalUsd?: number }
) {
  if (!handle) return;
  const { id, startedAt, userId } = handle;

  await supabase
    .from("transacciones")
    .update({ import_batch_id: id } as any)
    .is("import_batch_id", null)
    .eq("created_by", userId)
    .gte("created_at", startedAt);

  for (const tabla of ["cuentas_por_pagar", "cuentas_por_cobrar", "propinas"] as const) {
    await supabase
      .from(tabla)
      .update({ import_batch_id: id } as any)
      .is("import_batch_id", null)
      .gte("created_at", startedAt);
  }

  await supabase
    .from("importaciones" as any)
    .update({
      filas_registradas: totals.filasRegistradas,
      filas_omitidas: totals.filasOmitidas ?? 0,
      total_bs: totals.totalBs ?? 0,
      total_usd: totals.totalUsd ?? 0,
    } as any)
    .eq("id", id);
}

export type RevertPlan = {
  batch: ImportBatch;
  transacciones: { id: string; fecha: string; cuenta_codigo: string; monto_bs: number | null; monto_usd: number | null }[];
  cxpCreadas: number;
  cxcCreadas: number;
  propinas: number;
  cxpRestaurables: number;
  anticiposRevertidos: number;
  bloqueoMesCerrado: string | null;
};

export async function analizarReversion(batch: ImportBatch): Promise<RevertPlan> {
  const plan: RevertPlan = {
    batch,
    transacciones: [],
    cxpCreadas: 0,
    cxcCreadas: 0,
    propinas: 0,
    cxpRestaurables: 0,
    anticiposRevertidos: 0,
    bloqueoMesCerrado: null,
  };

  const { data: txs } = await supabase
    .from("transacciones")
    .select("id, fecha, cuenta_codigo, monto_bs, monto_usd")
    .eq("import_batch_id" as any, batch.id);
  plan.transacciones = (txs ?? []) as any;

  const counts = await Promise.all(
    (["cuentas_por_pagar", "cuentas_por_cobrar", "propinas"] as const).map((t) =>
      supabase.from(t).select("id", { count: "exact", head: true }).eq("import_batch_id" as any, batch.id)
    )
  );
  plan.cxpCreadas = counts[0]?.count ?? 0;
  plan.cxcCreadas = counts[1]?.count ?? 0;
  plan.propinas = counts[2]?.count ?? 0;

  const { count: restaurables } = await supabase
    .from("cuentas_por_pagar")
    .select("id", { count: "exact", head: true })
    .eq("revert_batch_id" as any, batch.id);
  plan.cxpRestaurables = restaurables ?? 0;

  plan.anticiposRevertidos = plan.transacciones.filter(
    (t) => t.cuenta_codigo === "14.2" && Number(t.monto_bs) < 0
  ).length;

  const fechas = Array.from(new Set(plan.transacciones.map((t) => t.fecha)));
  for (const f of fechas) {
    if (await isPeriodClosed(f)) {
      plan.bloqueoMesCerrado = f;
      break;
    }
  }

  return plan;
}

export async function ejecutarReversion(
  plan: RevertPlan,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  if (plan.batch.estado === "revertida") return { ok: false, error: "Esta carga ya fue revertida." };
  if (plan.bloqueoMesCerrado)
    return {
      ok: false,
      error: `Hay transacciones en un mes cerrado (${plan.bloqueoMesCerrado}). Reabre el mes primero.`,
    };

  const batchId = plan.batch.id;
  const txIds = plan.transacciones.map((t) => t.id);

  // 1) Restaurar CxP que esta carga marcó como pagadas/parciales
  const { data: cxpRestore } = await supabase
    .from("cuentas_por_pagar")
    .select("*")
    .eq("revert_batch_id" as any, batchId);
  for (const c of (cxpRestore ?? []) as any[]) {
    await supabase
      .from("cuentas_por_pagar")
      .update({
        estado: c.revert_estado_anterior ?? "pendiente",
        monto_pendiente_bs: c.revert_pendiente_bs_anterior ?? c.monto_bs,
        monto_pendiente_usd_bcv: c.revert_pendiente_usd_bcv_anterior ?? c.usd_bcv_factura,
        pagada_at: c.revert_pagada_at_anterior ?? null,
        revert_batch_id: null,
        revert_estado_anterior: null,
        revert_pendiente_bs_anterior: null,
        revert_pendiente_usd_bcv_anterior: null,
        revert_pagada_at_anterior: null,
      } as any)
      .eq("id", c.id);
    await logAudit("cuentas_por_pagar", "UPDATE", c.id, c, { estado: "restaurada por reversión" });
  }

  // 2) Revertir aplicaciones de anticipo hechas por esta carga
  for (const t of plan.transacciones.filter((x) => x.cuenta_codigo === "14.2" && Number(x.monto_bs) < 0)) {
    const { data: full } = await supabase
      .from("transacciones")
      .select("grupo_transaccion_id, monto_usd, tasa_bcv, monto_bs")
      .eq("id", t.id)
      .maybeSingle();
    const grupo = (full as any)?.grupo_transaccion_id;
    if (!grupo) continue;
    const usdBcv = Math.abs(
      Number((full as any)?.tasa_bcv) > 0
        ? Number((full as any)?.monto_bs) / Number((full as any)?.tasa_bcv)
        : Number((full as any)?.monto_usd) || 0
    );
    const { data: anticipos } = await supabase
      .from("transacciones")
      .select("id, anticipo_usd_bcv, anticipo_aplicado_usd_bcv")
      .eq("cuenta_codigo", "14.2")
      .eq("grupo_transaccion_id", grupo)
      .gt("monto_bs", 0);
    for (const a of (anticipos ?? []) as any[]) {
      const nuevoAplicado = Math.max(0, +(Number(a.anticipo_aplicado_usd_bcv ?? 0) - usdBcv).toFixed(2));
      const total = Number(a.anticipo_usd_bcv ?? 0);
      const estado =
        total > 0 && nuevoAplicado >= total - 0.005
          ? "aplicado"
          : nuevoAplicado > 0.005
            ? "parcialmente_aplicado"
            : "abierto";
      await supabase
        .from("transacciones")
        .update({
          anticipo_aplicado_usd_bcv: nuevoAplicado,
          anticipo_aplicado_usd: nuevoAplicado,
          anticipo_estado: estado,
        } as any)
        .eq("id", a.id);
    }
  }

  // 3) Borrar CxC y CxP creadas por la carga
  const { error: eCxc } = await supabase.from("cuentas_por_cobrar").delete().eq("import_batch_id" as any, batchId);
  if (eCxc) return { ok: false, error: `Error eliminando CxC: ${eCxc.message}` };
  const { error: eCxp } = await supabase.from("cuentas_por_pagar").delete().eq("import_batch_id" as any, batchId);
  if (eCxp) return { ok: false, error: `Error eliminando CxP: ${eCxp.message}` };

  // 4) Propinas
  const { error: eProp } = await supabase.from("propinas").delete().eq("import_batch_id" as any, batchId);
  if (eProp) return { ok: false, error: `Error eliminando propinas: ${eProp.message}` };

  // 5) Romper FK self-reference y borrar transacciones (en lotes)
  for (let i = 0; i < txIds.length; i += 200) {
    const chunk = txIds.slice(i, i + 200);
    await supabase.from("transacciones").update({ pareja_off_balance_id: null } as any).in("id", chunk);
    // Desligar CxC/CxP externas que apunten a estas transacciones
    await supabase.from("cuentas_por_cobrar").update({ transaccion_cobro_id: null } as any).in("transaccion_cobro_id", chunk);
    const { error } = await supabase.from("transacciones").delete().in("id", chunk);
    if (error) return { ok: false, error: `Error eliminando transacciones: ${error.message}` };
  }

  // 6) Marcar la carga como revertida
  const { error: eBatch } = await supabase
    .from("importaciones" as any)
    .update({ estado: "revertida", reverted_at: new Date().toISOString(), reverted_by: userId } as any)
    .eq("id", batchId);
  if (eBatch) return { ok: false, error: eBatch.message };

  await logAudit("importaciones", "DELETE", batchId, plan.batch as any, null);

  return { ok: true };
}
