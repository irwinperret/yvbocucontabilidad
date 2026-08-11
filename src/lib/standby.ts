import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

/** Devuelve los ids de las transacciones del mismo grupo (excluyendo las ya dadas). */
export async function idsDelGrupo(grupoId: string | null | undefined, excluirIds: string[] = []) {
  if (!grupoId) return [] as string[];
  const { data } = await supabase
    .from("transacciones")
    .select("id")
    .eq("grupo_transaccion_id", grupoId);
  return (data ?? [])
    .map((r: any) => r.id as string)
    .filter((id) => !excluirIds.includes(id));
}

/** Cuenta cuántas transacciones relacionadas (mismo grupo) tienen las transacciones dadas. */
export async function contarRelacionadas(rows: any[]) {
  const grupos = Array.from(
    new Set(rows.map((r) => r.grupo_transaccion_id).filter(Boolean) as string[])
  );
  if (!grupos.length) return { relacionadasIds: [] as string[], count: 0 };
  const ids = rows.map((r) => r.id);
  const { data } = await supabase
    .from("transacciones")
    .select("id")
    .in("grupo_transaccion_id", grupos);
  const relacionadasIds = (data ?? []).map((r: any) => r.id as string).filter((id) => !ids.includes(id));
  return { relacionadasIds, count: relacionadasIds.length };
}

export async function ponerEnStandby(ids: string[]) {
  if (!ids.length) return { ok: true as const };
  const { error } = await supabase
    .from("transacciones")
    .update({ standby: true, standby_at: new Date().toISOString() } as any)
    .in("id", ids);
  if (error) return { ok: false as const, error: error.message };
  for (const id of ids) await logAudit("transacciones", "UPDATE", id, null, { standby: true });
  return { ok: true as const };
}

export async function restaurarDeStandby(ids: string[]) {
  if (!ids.length) return { ok: true as const };
  const { error } = await supabase
    .from("transacciones")
    .update({ standby: false, standby_at: null } as any)
    .in("id", ids);
  if (error) return { ok: false as const, error: error.message };
  for (const id of ids) await logAudit("transacciones", "UPDATE", id, null, { standby: false });
  return { ok: true as const };
}
