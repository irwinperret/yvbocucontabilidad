import { supabase } from "@/integrations/supabase/client";
import { logAudit, isPeriodClosed } from "@/lib/audit";

export type ImportTipo = "ventas" | "compras" | "movimientos" | "ajustes";

export const TIPO_LABEL: Record<string, string> = {
  ventas: "Importar ventas (Xetux)",
  compras: "Importar compras (Xetux)",
  movimientos: "Importar movimientos bancarios",
  ajustes: "Importar ajustes ventas",
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

  // Red de seguridad: filas creadas durante la ventana de la importación por
  // rutas auxiliares (pareos, gastos directos, IVA, diferenciales) que pudieran
  // haber quedado con otro created_by o insertadas después del primer barrido.
  await supabase
    .from("transacciones")
    .update({ import_batch_id: id } as any)
    .is("import_batch_id", null)
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
    (t) => t.cuenta_codigo === "9.2" && Number(t.monto_bs) < 0
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

  // Reversión atómica en el servidor: borra todo o no marca la carga como revertida.
  const { data, error } = await supabase.rpc("revertir_importacion" as any, { p_batch: plan.batch.id } as any);
  if (error) return { ok: false, error: error.message };

  await logAudit("importaciones", "DELETE", plan.batch.id, plan.batch as any, (data ?? null) as any);
  return { ok: true };
}

/** Borra definitivamente del historial todas las cargas revertidas y cualquier resto asociado. */
export async function purgarRevertidas(): Promise<{
  ok: boolean;
  error?: string;
  resumen?: { cargas: number; transacciones: number; cxp: number; cxc: number; propinas: number; conciliaciones: number };
}> {
  const { data, error } = await supabase.rpc("purgar_importaciones_revertidas" as any, {} as any);
  if (error) return { ok: false, error: error.message };
  return { ok: true, resumen: (data ?? undefined) as any };
}

// ─────────────────────────────────────────────────────────────
// Residuos: transacciones de origen importado que quedaron sin lote
// (importación interrumpida, o el lote se borró del historial).
// ─────────────────────────────────────────────────────────────

export type Residuo = {
  id: string;
  fecha: string;
  cuenta_codigo: string;
  monto_bs: number | null;
  monto_usd: number | null;
  referencia: string | null;
  notas: string | null;
  created_at: string;
  origen: "movimientos" | "compras" | "pareo";
};

function origenDeReferencia(ref: string | null): Residuo["origen"] | null {
  if (!ref) return null;
  if (ref.startsWith("BANK:")) return "movimientos";
  if (ref.startsWith("PAREO:")) return "pareo";
  if (ref === "xetux") return "compras";
  return null;
}

export const ORIGEN_LABEL: Record<Residuo["origen"], string> = {
  movimientos: "Movimiento bancario",
  compras: "Compra Xetux",
  pareo: "Pareo automático",
};

/** Lista transacciones de origen importado que no pertenecen a ninguna carga. */
export async function listarResiduos(): Promise<Residuo[]> {
  const cols = "id, fecha, cuenta_codigo, monto_bs, monto_usd, referencia, notas, created_at, standby";
  const base = () => supabase.from("transacciones").select(cols).is("import_batch_id", null);
  const [bank, pareo, xetux] = await Promise.all([
    base().like("referencia", "BANK:%"),
    base().like("referencia", "PAREO:%"),
    base().eq("referencia", "xetux"),
  ]);
  const error = bank.error ?? pareo.error ?? xetux.error;
  if (error) throw error;
  const data = [...(bank.data ?? []), ...(pareo.data ?? []), ...(xetux.data ?? [])].sort((a: any, b: any) =>
    a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0
  );
  return (data ?? [])
    .filter((t: any) => !t.standby)
    .map((t: any) => ({ ...t, origen: origenDeReferencia(t.referencia)! }))
    .filter((t: Residuo) => !!t.origen);
}

/** Borra residuos seleccionados con la misma lógica segura de la reversión. */
export async function purgarResiduos(ids: string[]): Promise<{
  ok: boolean;
  error?: string;
  resumen?: { transacciones: number; conciliaciones: number; cxp_restauradas: number; cxp: number };
}> {
  if (ids.length === 0) return { ok: true, resumen: { transacciones: 0, conciliaciones: 0, cxp_restauradas: 0, cxp: 0 } };
  const { data, error } = await supabase.rpc("purgar_transacciones_huerfanas" as any, { p_ids: ids } as any);
  if (error) return { ok: false, error: error.message };
  await logAudit("transacciones", "DELETE", null as any, { residuos: ids } as any, (data ?? null) as any);
  return { ok: true, resumen: (data ?? undefined) as any };
}
