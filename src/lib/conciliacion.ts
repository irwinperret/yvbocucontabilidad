// Utilidades de conciliación bancaria.

/** Prefijo con el que se marcan las transacciones importadas sin factura en Xetux. */
export const SIN_FACTURA_PREFIX = "SIN FACTURA XETUX";

/**
 * Huella única de un movimiento bancario, usada en `transacciones.referencia`
 * para evitar importar dos veces el mismo movimiento.
 * Formato: BANK:<BANCO>|<FECHA>|<REF>|<MONTO>
 */
export function huellaBancaria(args: {
  banco: string;
  fecha: string;
  referencia: string;
  monto: number;
}): string {
  const banco = String(args.banco ?? "").trim().toUpperCase();
  const ref = String(args.referencia ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const monto = Math.abs(Number(args.monto) || 0).toFixed(2);
  return `BANK:${banco}|${args.fecha}|${ref || "SINREF"}|${monto}`;
}

/** ¿La transacción proviene de una importación bancaria sin factura? */
export function esSinFactura(detalle?: string | null): boolean {
  return String(detalle ?? "").startsWith(SIN_FACTURA_PREFIX);
}
