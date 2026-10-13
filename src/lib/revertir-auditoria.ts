// Deshacer cambios recientes usando el historial de auditoría que ya se
// registra en cada edición del sistema (ver logAudit en @/lib/audit).
//
// Pensado especificamente para el caso de "un script/backfill mio salio
// mal": se filtra la auditoría por una ventana de tiempo (ej. los minutos
// que duro ese backfill) y se puede deshacer todo ese grupo de un golpe.
//
// Reglas de seguridad:
//  - Solo se deshacen cambios de accion UPDATE. INSERT/DELETE no se tocan
//    aqui porque recrear o borrar una fila puede dejar huerfanos otros
//    registros derivados (CxP, conciliaciones, etc.) -- esos se muestran en
//    la lista pero marcados como no soportados.
//  - Se restauran SOLO los campos que ese cambio puntual modifico, nunca la
//    fila completa -- para no pisar una edicion manual posterior sobre otro
//    campo de la misma fila.
//  - Si alguno de esos campos ya fue modificado OTRA VEZ despues de este
//    cambio (su valor actual ya no coincide con "datos_despues"), no se
//    toca nada de esa fila: se reporta como conflicto en vez de corregir a
//    ciegas.
//  - Si el mes de la fila ya esta cerrado, tampoco se toca: se reporta como
//    mes_cerrado (reabrir el mes es una decision manual aparte).
//  - Cada reversion queda registrada en auditoría igual que cualquier otra
//    edición (antes/después), asi el propio "deshacer" tambien es trazable.

import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

export type CampoDiff = { campo: string; antes: any; despues: any };

export type CambioAuditoria = {
  id: string;
  tabla: string;
  accion: string;
  registro_id: string | null;
  user_id: string | null;
  created_at: string;
  datos_antes: any;
  datos_despues: any;
  diffs: CampoDiff[];
};

const CAMPOS_IGNORADOS = new Set(["id", "created_at", "updated_at"]);

function diffCampos(antes: any, despues: any): CampoDiff[] {
  const a = antes && typeof antes === "object" ? antes : {};
  const d = despues && typeof despues === "object" ? despues : {};
  const campos = new Set([...Object.keys(a), ...Object.keys(d)]);
  const out: CampoDiff[] = [];
  for (const campo of campos) {
    if (CAMPOS_IGNORADOS.has(campo)) continue;
    const va = a[campo] ?? null;
    const vd = d[campo] ?? null;
    if (JSON.stringify(va) !== JSON.stringify(vd)) {
      out.push({ campo, antes: va, despues: vd });
    }
  }
  return out;
}

/** Trae los cambios de auditoría dentro de una ventana de tiempo (ISO). */
export async function fetchCambiosAuditoria(args: {
  desde: string;
  hasta: string;
  tabla?: string;
}): Promise<CambioAuditoria[]> {
  let q = supabase
    .from("auditoria")
    .select("*")
    .gte("created_at", args.desde)
    .lte("created_at", args.hasta)
    .order("created_at", { ascending: false })
    .limit(500);
  if (args.tabla) q = q.eq("tabla", args.tabla);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    tabla: row.tabla,
    accion: row.accion,
    registro_id: row.registro_id,
    user_id: row.user_id,
    created_at: row.created_at,
    datos_antes: row.datos_antes,
    datos_despues: row.datos_despues,
    diffs: diffCampos(row.datos_antes, row.datos_despues),
  }));
}

export type ResultadoRevertirCambio =
  | { status: "revertido"; campos: CampoDiff[] }
  | { status: "ya_cambio_despues"; campo: string }
  | { status: "mes_cerrado"; periodo: string }
  | { status: "no_soportado" }
  | { status: "fila_no_existe" };

export async function revertirCambioAuditoria(
  cambio: CambioAuditoria,
  periodosCerrados: Set<string>,
): Promise<ResultadoRevertirCambio> {
  if (cambio.accion !== "UPDATE" || !cambio.registro_id || cambio.diffs.length === 0) {
    return { status: "no_soportado" };
  }

  const { data: actual } = await supabase
    .from(cambio.tabla as any)
    .select("*")
    .eq("id", cambio.registro_id)
    .maybeSingle();
  if (!actual) return { status: "fila_no_existe" };

  const fecha = (actual as any).fecha as string | undefined;
  const periodo = fecha ? String(fecha).slice(0, 7) : null;
  if (periodo && periodosCerrados.has(periodo)) {
    return { status: "mes_cerrado", periodo };
  }

  for (const { campo, despues } of cambio.diffs) {
    const valorActual = (actual as any)[campo] ?? null;
    if (JSON.stringify(valorActual) !== JSON.stringify(despues)) {
      return { status: "ya_cambio_despues", campo };
    }
  }

  const updateObj: Record<string, any> = {};
  for (const { campo, antes } of cambio.diffs) updateObj[campo] = antes;

  const { data: actualizada, error } = await supabase
    .from(cambio.tabla as any)
    .update(updateObj as any)
    .eq("id", cambio.registro_id)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (actualizada) {
    await logAudit(cambio.tabla, "UPDATE", cambio.registro_id, actual, actualizada);
  }

  return { status: "revertido", campos: cambio.diffs };
}

export function resumenRevertirCambios(resultados: ResultadoRevertirCambio[]): string {
  const revertidos = resultados.filter((r) => r.status === "revertido").length;
  const conflictos = resultados.filter((r) => r.status === "ya_cambio_despues").length;
  const cerrados = resultados.filter((r) => r.status === "mes_cerrado").length;
  const noSoportados = resultados.filter((r) => r.status === "no_soportado").length;
  const sinFila = resultados.filter((r) => r.status === "fila_no_existe").length;

  const partes: string[] = [];
  partes.push(`${revertidos} cambio${revertidos === 1 ? "" : "s"} revertido${revertidos === 1 ? "" : "s"}`);
  if (conflictos) partes.push(`${conflictos} con cambios posteriores -- no se tocaron`);
  if (cerrados) partes.push(`${cerrados} con mes cerrado -- reabre el mes`);
  if (noSoportados) partes.push(`${noSoportados} no soportados (INSERT/DELETE)`);
  if (sinFila) partes.push(`${sinFila} con la fila ya borrada`);
  return partes.join(" · ");
}
