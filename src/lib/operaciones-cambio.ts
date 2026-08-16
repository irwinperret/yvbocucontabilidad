/**
 * Operaciones de cambio (compra/venta de divisas).
 *
 * Se registran siempre en la cuenta 98 — Operaciones Cambio, que tiene
 * afecta_gyp = false y afecta_fc = false: no son ingresos ni gastos, solo
 * conversión de moneda. Cada operación son dos patas (salida y entrada) que
 * comparten grupo_transaccion_id y se anulan entre sí.
 */
export const CUENTA_CAMBIO = "98";

export type TipoCambio = "compra" | "venta";

export const TIPO_CAMBIO_LABEL: Record<TipoCambio, string> = {
  compra: "Compra USD",
  venta: "Venta USD",
};

/** Detecta si el concepto de un movimiento bancario es una operación de cambio. */
export const esCambio = (concepto: string): boolean => {
  const c = String(concepto ?? "").toUpperCase();
  return /COMPRA\s*(DE\s*)?D[OÓ]LAR|VENTA\s*(DE\s*)?D[OÓ]LAR|CAMBIO\s*DE\s*DIVISA|OPERACI[OÓ]N\s*CAMBIO|COMPRA\s*USD|VENTA\s*USD|DOLARIZA|CONVERSION/.test(
    c
  );
};

/** Tasa implícita de la operación, en Bs por USD. */
export const tasaImplicita = (montoBs: number, montoUsd: number) =>
  montoUsd > 0 ? +(montoBs / montoUsd).toFixed(4) : 0;

/** Tipo inferido a partir del detalle guardado en la transacción. */
export const tipoDesdeDetalle = (detalle: string | null | undefined): TipoCambio =>
  String(detalle ?? "").toLowerCase().includes("venta") ? "venta" : "compra";
