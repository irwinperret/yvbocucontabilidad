// Reclasificación automática de compras de Xetux cuando se conciliano contra
// un movimiento bancario.
//
// Toda compra importada desde Xetux se registra siempre en la cuenta 2.1 —
// Compras de mercancía, sin distinguir el tipo real de gasto (uniformes,
// software, insumos, etc. quedan igual que mercancía). La cuenta que trae el
// movimiento bancario con el que se concilia esa factura es información más
// precisa (se llena a mano al preparar el archivo de movimientos, nunca es
// una adivinanza), así que cuando se aplica un pago de CxP se usa para
// corregir la cuenta de la compra original.
//
// El pago en sí sigue yendo siempre a 8.2 — Pago de CxP (ver CUENTA_PAGO_CXP
// en pareo-cxp.ts): eso no cambia, porque si se usara la cuenta del
// movimiento bancario para el pago, el gasto se contaría dos veces (una al
// registrar la factura y otra al pagarla). Lo único que se corrige es la
// cuenta de la transacción 2.1 original.

import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

/** Cuenta con la que Xetux registra siempre sus compras, sin distinguir el gasto real. */
export const CUENTA_COMPRA_XETUX = "2.1";

export type ResultadoReclasificacion =
  | { status: "reclasificada"; de: string; a: string }
  | { status: "conflicto"; actual: string; sugerida: string }
  | { status: "mes_cerrado"; periodo: string }
  | { status: "sin_cambio" };

/**
 * Reclasifica (si corresponde) la transacción de compra original hacia la
 * cuenta que trae el movimiento bancario con el que se está conciliando.
 *
 * Reglas (acordadas con el usuario):
 *  - Solo se toca una compra que todavía está en 2.1 — nunca se pisa una
 *    cuenta ya asignada deliberadamente a otra cosa.
 *  - Si la compra ya fue reclasificada antes a una cuenta DISTINTA de la que
 *    sugiere este movimiento, no se cambia: se reporta como "conflicto" (en
 *    teoría casi imposible, pero mejor avisar que corregir a ciegas).
 *  - Si el mes de la compra ya está cerrado, no se toca (reabrir el mes es
 *    una decisión manual aparte): se reporta como "mes_cerrado".
 *  - Si procede, se actualiza `transacciones.cuenta_codigo` y se registra en
 *    auditoría (antes/después), igual que cualquier otra edición manual.
 *
 * Se hace siempre automático, sin pedir confirmación — el llamador solo
 * necesita juntar los resultados y mostrar un resumen al final (ver
 * `resumenReclasificaciones`).
 */
export async function reclasificarCompraSegunPareo(args: {
  transaccionId: string | null | undefined;
  cuentaOriginal: string | null | undefined;
  cuentaSugerida: string | null | undefined;
  fecha: string;
  periodosCerrados: Set<string>;
}): Promise<ResultadoReclasificacion> {
  const { transaccionId, cuentaOriginal, cuentaSugerida, fecha, periodosCerrados } = args;
  if (!transaccionId) return { status: "sin_cambio" };

  const actual = String(cuentaOriginal ?? "").trim();
  const sugerida = String(cuentaSugerida ?? "").trim();

  if (actual !== CUENTA_COMPRA_XETUX) {
    // Ya no está en 2.1 -- o ya se reclasificó antes, o nunca pasó por acá.
    // Si la cuenta actual no coincide con lo que sugiere ESTE movimiento,
    // es un conflicto (dos movimientos distintos sugiriendo cuentas
    // distintas para la misma factura) y no se toca.
    if (sugerida && sugerida !== CUENTA_COMPRA_XETUX && actual !== sugerida) {
      return { status: "conflicto", actual, sugerida };
    }
    return { status: "sin_cambio" };
  }

  if (!sugerida || sugerida === CUENTA_COMPRA_XETUX) return { status: "sin_cambio" };

  const periodo = String(fecha ?? "").slice(0, 7);
  if (periodo && periodosCerrados.has(periodo)) {
    return { status: "mes_cerrado", periodo };
  }

  const { data: antes } = await supabase
    .from("transacciones")
    .select("*")
    .eq("id", transaccionId)
    .maybeSingle();

  const { data: actualizada, error } = await supabase
    .from("transacciones")
    .update({ cuenta_codigo: sugerida } as any)
    .eq("id", transaccionId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (actualizada) {
    await logAudit("transacciones", "UPDATE", transaccionId, antes ?? { cuenta_codigo: actual }, actualizada);
  }

  return { status: "reclasificada", de: actual, a: sugerida };
}

/** Resumen en una línea para un toast; null si no hay nada que mostrar. */
export function resumenReclasificaciones(resultados: ResultadoReclasificacion[]): string | null {
  const reclasificadas = resultados.filter((r) => r.status === "reclasificada").length;
  const mesesCerrados = resultados.filter((r) => r.status === "mes_cerrado").length;
  const conflictos = resultados.filter((r) => r.status === "conflicto").length;
  if (!reclasificadas && !mesesCerrados && !conflictos) return null;

  const partes: string[] = [];
  if (reclasificadas) {
    partes.push(`${reclasificadas} compra${reclasificadas === 1 ? "" : "s"} reclasificada${reclasificadas === 1 ? "" : "s"} desde 2.1`);
  }
  if (mesesCerrados) {
    partes.push(`${mesesCerrados} con mes cerrado -- reabre el mes para corregir`);
  }
  if (conflictos) {
    partes.push(`${conflictos} con cuentas en conflicto -- revisar a mano`);
  }
  return partes.join(" · ");
}
