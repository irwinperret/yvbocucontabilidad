// Cuentas según el prompt (centro de costo + tipo → cuenta)
// Nota: "Administración" y "YV_Market" se eliminaron del UI; se asume Compartido.
export const CENTROS = ["YV", "Bocu", "Compartido"] as const;
export type Centro = (typeof CENTROS)[number];

/**
 * Compara dos códigos de cuenta ("3.1", "3.10", "7.1", etc.) en orden
 * numérico real (mayor.menor), no como texto ni por el campo `orden` de la
 * base de datos (que no siempre está bien curado para cuentas nuevas o
 * renombradas, y hace que terminen mal ubicadas en reportes y exports).
 */
export function compararCodigoCuenta(a: string | null | undefined, b: string | null | undefined): number {
  const partes = (c: string | null | undefined) =>
    String(c ?? "").trim().split(".").map((p) => Number(p) || 0);
  const [aMayor, aMenor = 0] = partes(a);
  const [bMayor, bMenor = 0] = partes(b);
  if (aMayor !== bMayor) return aMayor - bMayor;
  return aMenor - bMenor;
}

/** Ordena un arreglo de cuentas (o cualquier objeto con .codigo) por código numérico. */
export function ordenarPorCodigo<T extends { codigo: string }>(cuentas: T[]): T[] {
  return [...cuentas].sort((a, b) => compararCodigoCuenta(a.codigo, b.codigo));
}

export const METODOS = ["tarjeta", "transferencia", "pago_movil", "zelle", "efectivo_usd", "efectivo_bs", "pendiente"] as const;
export type Metodo = (typeof METODOS)[number];

export function cuentaVenta(centro: Centro, tipo: "contado" | "credito" | "cobro"): string {
  if (tipo === "credito") return "1.4";
  if (tipo === "cobro") return "1.5";
  if (centro === "YV") return "1.1";
  if (centro === "Bocu") return "1.2";
  return "1.1";
}

export function cuentaNomina(tipo: string, centro: Centro): string {
  // Tras la fusión de cuentas (ago-2026): sueldos, pasivos laborales y
  // liquidaciones ya no distinguen por centro a nivel de cuenta contable,
  // todo entra a una sola cuenta consolidada. El centro se sigue guardando
  // en el campo centro_costo de cada transacción.
  const map: Record<string, string> = {
    regular:      "3.1",   // Sueldos
    liquidacion:  "3.2",   // Pasivos laborales (incluye liquidaciones)
    pasivos:      "3.2",   // Pasivos laborales
    parafiscales: "3.2",   // Pasivos laborales
    // Bono 10%: ya no es gasto de nómina (3.5/3.10 retiradas). Es un pasivo
    // (13.4, estilo Propinas), igual para los tres centros.
    bono:         "8.3",
  };
  return map[tipo] ?? "3.1";
}


export const FINANCIAMIENTO = {
  prestamo_recibido: { codigo: "5.1", label: "Préstamo recibido", afecta: "FC" },
  pago_capital: { codigo: "5.2", label: "Cuota — Capital", afecta: "FC" },
  pago_intereses: { codigo: "5.3", label: "Cuota — Intereses", afecta: "G&P" },
  dividendos: { codigo: "5.4", label: "Pago de dividendos", afecta: "FC" },
  aumento_capital: { codigo: "5.5", label: "Aumento de capital social", afecta: "FC" },
  capex: { codigo: "5.6", label: "CapEx — Activo fijo", afecta: "FC" },
  depreciacion: { codigo: "5.7", label: "Depreciación mensual", afecta: "G&P" },
};

export const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export const CAPEX_CATEGORIAS = [
  "Remodelación/Obra Civil",
  "Equipos de Cocina",
  "Equipos de Sala",
  "Mobiliario",
  "Utilería",
  "Otros",
] as const;
export type CapexCategoria = (typeof CAPEX_CATEGORIAS)[number];
