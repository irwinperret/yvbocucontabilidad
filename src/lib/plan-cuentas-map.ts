/**
 * Mapa oficial del plan de cuentas vigente (agosto 2026).
 *
 * El plan fue renumerado: los códigos antiguos (10.x financiamiento, 11.x
 * diferencial cambiario, 12.x impuestos, 13.x pasivos transitorios, 14.x
 * activos transitorios, 9.x servicios) ya no existen en `plan_de_cuentas`.
 * Cualquier transacción con un código inexistente es rechazada por la base de
 * datos, así que TODO el código debe usar estas constantes en vez de literales.
 */

export const CUENTA = {
  // Ingresos
  VENTA_YV: "1.1",
  VENTA_BOCU: "1.2",
  VENTA_CREDITO: "1.4",
  COBRO_CREDITO: "1.5",
  DESCUENTOS: "1.6",
  DEVOLUCIONES: "1.7",

  // COGS
  COMPRAS: "2.1",
  AJUSTE_COGS: "2.2",

  // Nómina / costos fijos
  SUELDOS: "3.1",
  PASIVOS_LABORALES: "3.2",
  SALARIOS_ADMIN: "3.3",
  PASIVOS_LABORALES_ADMIN: "3.4",
  TRANSPORTE_PERSONAL: "3.5",
  SUELDO_MONICA: "3.6",
  MERCADEO: "3.12",
  AGUA: "3.14",
  INTERNET: "3.15",
  TELEFONO: "3.16",
  SOFTWARE: "3.17",
  ELECTRICIDAD: "3.18",

  // Costos variables
  GASTOS_OFICINA: "4.1",
  OTROS_IMPREVISTOS: "4.2",
  ALQUILER: "4.3",
  OTROS_INSUMOS: "4.6",
  GASTOS_FINANCIEROS: "4.8",
  MANTENIMIENTO: "4.10",
  IMAE: "4.11",

  // Financiamiento
  PRESTAMO_RECIBIDO: "5.1",
  PAGO_CAPITAL: "5.2",
  INTERESES: "5.3",
  DIVIDENDOS: "5.4",
  AUMENTO_CAPITAL: "5.5",
  CAPEX: "5.6",
  DEPRECIACION: "5.7",

  // Otros
  GANANCIA_CAMBIARIA: "6.1",
  PERDIDA_CAMBIARIA: "6.2",
  OPERACIONES_CAMBIO: "98",
  POR_DETERMINAR: "99",

  // Impuestos
  PAGO_IVA_SENIAT: "7.1",
  ISLR: "7.2",
  IVA_DEBITO: "7.3",
  IVA_CREDITO: "7.4",

  // Pasivos transitorios
  PROPINAS_POR_PAGAR: "8.1",
  PAGO_CXP: "8.2",
  BONOS_10: "8.3",

  // Activos transitorios
  PRESTAMOS_PERSONAL: "9.1",
  ANTICIPO_PROVEEDOR: "9.2",
  ANTICIPO_NOMINA: "9.3",
} as const;

/** Equivalencias del plan viejo al vigente (referencia y migraciones puntuales). */
export const MAPA_CUENTAS_ANTERIOR: Record<string, string> = {
  "9.3": "3.14", "9.4": "3.15", "9.5": "3.16", "9.7": "3.18", "9.8": "4.10",
  "10.1": "5.1", "10.2": "5.2", "10.3": "5.3", "10.4": "5.4",
  "10.5": "5.5", "10.6": "5.6", "10.7": "5.7",
  "11.1": "6.1", "11.2": "6.2",
  "12.1": "4.11", "12.2": "7.1", "12.3": "7.2", "12.4": "7.3", "12.5": "7.4",
  "13.1": "8.1", "13.2": "8.2", "13.4": "8.3",
  "14.1": "9.1", "14.2": "9.2", "14.3": "9.3",
  "3.16": "3.3", "3.17": "3.4", "3.23": "3.5", "3.24": "3.6",
};
