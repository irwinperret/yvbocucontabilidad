/**
 * Saldos de cuentas por pagar denominados en USD BCV.
 *
 * Una factura de compra nace como una deuda en **USD BCV** (el proveedor
 * factura en dólares y el bolívar es solo la expresión de ese día). Por eso el
 * saldo en bolívares NO se congela a la tasa de la factura: se revalúa a la
 * tasa BCV del día en que se paga.
 *
 *   pendiente Bs (a la fecha X) = monto_pendiente_usd_bcv × tasa BCV de X
 */

/** Saldo pendiente en bolívares tal como quedó registrado (histórico). */
export function pendienteBsHistorico(c: any): number {
  return Number(c?.monto_pendiente_bs ?? c?.monto_bs ?? 0) || 0;
}

/** Saldo pendiente en USD BCV (deuda real). */
export function pendienteUsdBcv(c: any): number {
  if (c?.monto_pendiente_usd_bcv != null) return Number(c.monto_pendiente_usd_bcv) || 0;
  const base = Number(c?.usd_bcv_factura ?? c?.monto_usd ?? 0) || 0;
  const total = Number(c?.monto_bs) || 0;
  const ratio = total > 0 ? pendienteBsHistorico(c) / total : 1;
  return +(base * ratio).toFixed(2);
}

/** Tasa BCV con la que nació la factura (para calcular el diferencial). */
export function tasaBcvFactura(c: any): number {
  const t = Number(c?.tasa_bcv_factura) || 0;
  if (t > 0) return t;
  const bs = Number(c?.monto_bs) || 0;
  const usd = Number(c?.usd_bcv_factura ?? c?.monto_usd) || 0;
  return usd > 0 ? +(bs / usd).toFixed(6) : 0;
}

/** Saldo pendiente en bolívares revaluado a la tasa BCV indicada. */
export function pendienteBsAFecha(c: any, tasaBcv: number): number {
  const usd = pendienteUsdBcv(c);
  if (!(tasaBcv > 0) || !(usd > 0)) return pendienteBsHistorico(c);
  return +(usd * tasaBcv).toFixed(2);
}

/** Tolerancia para diferencias despreciables: 0,5 % o Bs 500 (lo que sea mayor). */
export const TOL_PCT = 0.005;
export const TOL_MIN_BS = 500;

export function toleranciaBs(base: number): number {
  return Math.max(TOL_MIN_BS, Math.abs(base) * TOL_PCT);
}

export function dentroDeTolerancia(diferencia: number, base: number): boolean {
  return Math.abs(diferencia) <= toleranciaBs(base);
}

/** Cuentas del plan usadas para registrar el diferencial cambiario (uso manual). */
export const CUENTA_DIF_PERDIDA = "7.2";  // Diferencial cambiario (pérdida)
export const CUENTA_DIF_GANANCIA = "11.1"; // Ganancia cambiaria por cobros

/**
 * Diferencial cambiario de un pago: lo que costó pagar la deuda en bolívares
 * frente a lo que valía cuando nació la factura.
 * > 0 → pérdida (la tasa subió) · < 0 → ganancia.
 *
 * Nota: es solo informativo. El pago de CxP ya NO genera un asiento en 7.2/11.1;
 * la variación de tasa queda absorbida en el monto realmente pagado.
 */
export function diferencialCambiario(opts: {
  usdBcvAplicado: number;
  tasaPago: number;
  tasaFactura: number;
}): number {
  const { usdBcvAplicado, tasaPago, tasaFactura } = opts;
  if (!(usdBcvAplicado > 0) || !(tasaPago > 0) || !(tasaFactura > 0)) return 0;
  return +(usdBcvAplicado * (tasaPago - tasaFactura)).toFixed(2);
}

