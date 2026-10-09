import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import type { Centro } from "@/lib/account-helpers";

/**
 * "Retención ISLR" (7mo input mensual): NO es un depósito bancario. El monto
 * que se importa mensualmente en "movimientos bancarios" bajo fees
 * bancarios (cuenta 4.8) viene inflado -- incluye la parte que el banco
 * retuvo por ISLR. Una vez al mes se reclasifica esa parte: se le resta a
 * 4.8 (gasto financiero, afecta G&P y FC porque 4.8 ya se suma genérico en
 * "costosVariables" en flujo-caja.ts) y se le suma a 9.5 (activo
 * transitorio, afecta_gyp=false -- solo FC, vía la línea retencionIslr que
 * ya resta su total en calcularLineasFC()).
 *
 * Se registran como DOS transacciones atadas por `grupo_transaccion_id`
 * (mismo patrón que bono-propina-combinado.ts): una negativa en 4.8, una
 * positiva en 9.5, por el mismo monto. Ninguna de las dos lleva
 * `cuenta_bancaria_id`: no hay movimiento real de banco en este ajuste (el
 * dinero ya se movió cuando se importaron los movimientos originales), así
 * que dejarlo sin cuenta bancaria evita que Saldos Bancarios (que solo
 * cuenta filas con cuenta_bancaria_id) lo tome como una salida real de caja.
 *
 * Reemplaza al formulario viejo "Retención de ISLR" en Registrar, que
 * insertaba un solo registro aislado en 9.5 con cuenta bancaria, como si el
 * banco hubiera depositado esa plata directo -- eso sí distorsionaba Saldos
 * Bancarios y nunca corregía el 4.8 inflado.
 */
export const CUENTA_GASTOS_FINANCIEROS = "4.8";
export const CUENTA_RETENCION_ISLR = "9.5";
export const DETALLE_RECLASIFICACION_ISLR =
  "Reclasificación ISLR (banco): de Gastos financieros (4.8) a Retención ISLR (9.5)";

export type ReclasificacionIslr = {
  /** `grupo_transaccion_id` que ata las dos patas. Null = registro legacy sin pareja (ver `legacy`). */
  grupoId: string | null;
  fecha: string;
  montoUsd: number;
  montoBs: number;
  tasaBcv: number;
  tasaParalela: number | null;
  centro: string;
  notas: string | null;
  id95: string;
  id48: string | null;
  /** true = registro hecho con el formulario viejo: está solo en 9.5, con cuenta bancaria, sin pata en 4.8. */
  legacy: boolean;
  cuentaBancariaIdLegacy: string | null;
};

export function periodoDeFecha(fecha: string): string {
  return fecha.slice(0, 7);
}

function periodoABounds(periodo: string): { desde: string; hasta: string } {
  const [y, m] = periodo.split("-").map(Number);
  const desde = `${periodo}-01`;
  const hasta = new Date(y, m, 0).toISOString().slice(0, 10);
  return { desde, hasta };
}

/** Todas las reclasificaciones (y legacy sueltos) en 9.5, más reciente primero. */
export async function listarReclasificacionesIslr(): Promise<ReclasificacionIslr[]> {
  const { data: filas95, error } = await supabase
    .from("transacciones")
    .select("id, fecha, monto_usd, monto_bs, tasa_bcv, tasa_paralela, centro_costo, notas, grupo_transaccion_id, cuenta_bancaria_id")
    .eq("cuenta_codigo", CUENTA_RETENCION_ISLR)
    .order("fecha", { ascending: false });
  if (error) throw error;

  const grupoIds = (filas95 ?? []).map((f: any) => f.grupo_transaccion_id).filter(Boolean);
  let legsPorGrupo = new Map<string, any>();
  if (grupoIds.length > 0) {
    const { data: filas48 } = await supabase
      .from("transacciones")
      .select("id, grupo_transaccion_id")
      .eq("cuenta_codigo", CUENTA_GASTOS_FINANCIEROS)
      .in("grupo_transaccion_id", grupoIds);
    (filas48 ?? []).forEach((f: any) => legsPorGrupo.set(f.grupo_transaccion_id, f));
  }

  return (filas95 ?? []).map((f: any) => {
    const leg48 = f.grupo_transaccion_id ? legsPorGrupo.get(f.grupo_transaccion_id) : null;
    return {
      grupoId: f.grupo_transaccion_id ?? null,
      fecha: f.fecha,
      montoUsd: Number(f.monto_usd) || 0,
      montoBs: Number(f.monto_bs) || 0,
      tasaBcv: Number(f.tasa_bcv) || 0,
      tasaParalela: f.tasa_paralela != null ? Number(f.tasa_paralela) : null,
      centro: f.centro_costo,
      notas: f.notas,
      id95: f.id,
      id48: leg48?.id ?? null,
      legacy: !f.grupo_transaccion_id || !leg48,
      cuentaBancariaIdLegacy: f.cuenta_bancaria_id ?? null,
    } as ReclasificacionIslr;
  });
}

/** La reclasificación (completa, con sus dos patas) de un período dado, si existe. */
export async function fetchReclasificacionDelPeriodo(periodo: string): Promise<ReclasificacionIslr | null> {
  const { desde, hasta } = periodoABounds(periodo);
  const todas = await listarReclasificacionesIslr();
  return (
    todas.find((r) => !r.legacy && r.fecha >= desde && r.fecha <= hasta) ?? null
  );
}

/**
 * Crea una reclasificación nueva (dos patas atadas) o actualiza una
 * existente (pasando su `grupoId`), manteniendo siempre signos opuestos por
 * el mismo monto.
 */
export async function guardarReclasificacionIslr(args: {
  grupoId?: string | null;
  ids?: { id95: string; id48: string } | null;
  fecha: string;
  montoUsd: number;
  tasaBcv: number;
  tasaParalela?: number | null;
  centro?: Centro;
  notas?: string | null;
  userId: string;
}): Promise<void> {
  const { grupoId, ids, fecha, montoUsd, tasaBcv, tasaParalela = null, centro = "Compartido", notas = null, userId } = args;
  const montoBs = +(montoUsd * tasaBcv).toFixed(2);

  if (grupoId && ids) {
    const [{ data: antes95 }, { data: antes48 }] = await Promise.all([
      supabase.from("transacciones").select("*").eq("id", ids.id95).single(),
      supabase.from("transacciones").select("*").eq("id", ids.id48).single(),
    ]);
    const patch95 = {
      fecha, centro_costo: centro as any, monto_usd: +montoUsd.toFixed(2), monto_bs: montoBs,
      monto_base_bs: montoBs, tasa_bcv: tasaBcv, tasa_paralela: tasaParalela, notas,
    };
    const patch48 = {
      fecha, centro_costo: centro as any, monto_usd: -(+montoUsd.toFixed(2)), monto_bs: -montoBs,
      monto_base_bs: -montoBs, tasa_bcv: tasaBcv, tasa_paralela: tasaParalela, notas,
    };
    const [{ data: tx95, error: e95 }, { data: tx48, error: e48 }] = await Promise.all([
      supabase.from("transacciones").update(patch95 as any).eq("id", ids.id95).select().single(),
      supabase.from("transacciones").update(patch48 as any).eq("id", ids.id48).select().single(),
    ]);
    if (e95) throw e95;
    if (e48) throw e48;
    if (tx95) await logAudit("transacciones", "UPDATE", ids.id95, antes95, tx95);
    if (tx48) await logAudit("transacciones", "UPDATE", ids.id48, antes48, tx48);
    return;
  }

  const nuevoGrupoId = crypto.randomUUID();
  const base = {
    fecha, centro_costo: centro as any, iva_bs: 0, iva_aplica: false, tipo_iva: null,
    tasa_bcv: tasaBcv, tasa_paralela: tasaParalela, metodo_pago: null, cuenta_bancaria_id: null,
    detalle: DETALLE_RECLASIFICACION_ISLR, notas, modo: "on_balance" as any,
    grupo_transaccion_id: nuevoGrupoId, created_by: userId,
  };
  const payloads = [
    { ...base, cuenta_codigo: CUENTA_RETENCION_ISLR, monto_usd: +montoUsd.toFixed(2), monto_bs: montoBs, monto_base_bs: montoBs },
    { ...base, cuenta_codigo: CUENTA_GASTOS_FINANCIEROS, monto_usd: -(+montoUsd.toFixed(2)), monto_bs: -montoBs, monto_base_bs: -montoBs },
  ];
  const { data: legs, error } = await supabase.from("transacciones").insert(payloads as any).select();
  if (error) throw error;
  for (const tx of legs ?? []) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);
}

/** Borra las dos patas de una reclasificación (o el registro legacy suelto, si solo tiene una). */
export async function borrarReclasificacionIslr(r: ReclasificacionIslr): Promise<void> {
  const ids = [r.id95, r.id48].filter(Boolean) as string[];
  for (const id of ids) {
    const { data: antes } = await supabase.from("transacciones").select("*").eq("id", id).single();
    const { error } = await supabase.from("transacciones").delete().eq("id", id);
    if (error) throw error;
    if (antes) await logAudit("transacciones", "DELETE", id, antes, null);
  }
}

/**
 * Migra un registro legacy (solo en 9.5, con cuenta bancaria, sin pareja en
 * 4.8) al modelo nuevo: le quita la cuenta bancaria, le pone un
 * grupo_transaccion_id, y le crea la pata que falta en 4.8 por el mismo
 * monto que ya tenía anotado.
 */
export async function migrarLegacyAReclasificacion(r: ReclasificacionIslr, userId: string): Promise<void> {
  if (!r.legacy || r.id48) throw new Error("Este registro no es un legacy suelto");
  const nuevoGrupoId = crypto.randomUUID();
  const { data: antes95 } = await supabase.from("transacciones").select("*").eq("id", r.id95).single();
  const { data: tx95, error: e95 } = await supabase
    .from("transacciones")
    .update({ cuenta_bancaria_id: null, grupo_transaccion_id: nuevoGrupoId, detalle: DETALLE_RECLASIFICACION_ISLR } as any)
    .eq("id", r.id95)
    .select()
    .single();
  if (e95) throw e95;
  if (tx95) await logAudit("transacciones", "UPDATE", r.id95, antes95, tx95);

  const payload48 = {
    fecha: r.fecha, centro_costo: r.centro as any, iva_bs: 0, iva_aplica: false, tipo_iva: null,
    tasa_bcv: r.tasaBcv, tasa_paralela: r.tasaParalela, metodo_pago: null, cuenta_bancaria_id: null,
    detalle: DETALLE_RECLASIFICACION_ISLR, notas: r.notas, modo: "on_balance" as any,
    grupo_transaccion_id: nuevoGrupoId, created_by: userId,
    cuenta_codigo: CUENTA_GASTOS_FINANCIEROS, monto_usd: -r.montoUsd, monto_bs: -r.montoBs, monto_base_bs: -r.montoBs,
  };
  const { data: tx48, error: e48 } = await supabase.from("transacciones").insert(payload48 as any).select().single();
  if (e48) throw e48;
  if (tx48) await logAudit("transacciones", "INSERT", (tx48 as any).id, null, tx48);
}
