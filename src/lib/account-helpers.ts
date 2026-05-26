// Cuentas según el prompt (centro de costo + tipo → cuenta)
// Nota: "Administración" se eliminó del UI; se asume Compartido.
export const CENTROS = ["YV", "Bocu", "YV_Market", "Compartido"] as const;
export type Centro = (typeof CENTROS)[number];

export const METODOS = ["tarjeta", "transferencia", "pago_movil", "zelle", "efectivo_usd", "efectivo_bs", "pendiente"] as const;
export type Metodo = (typeof METODOS)[number];

export function cuentaVenta(centro: Centro, tipo: "contado" | "credito" | "cobro"): string {
  if (tipo === "credito") return "1.4";
  if (tipo === "cobro") return "1.5";
  if (centro === "YV") return "1.1";
  if (centro === "Bocu") return "1.2";
  if (centro === "YV_Market") return "1.3";
  return "1.1";
}

export function cuentaNomina(tipo: string, centro: Centro): string {
  // Compartido reutiliza los códigos que antes eran de Administración (3.1, 3.2, 3.3).
  const map: Record<string, Record<string, string>> = {
    regular:      { Bocu: "3.4", YV: "3.9",  Compartido: "3.1",  YV_Market: "3.14" },
    bono:         { Bocu: "3.5", YV: "3.10", Compartido: "3.14", YV_Market: "3.14" },
    liquidacion:  { Bocu: "3.7", YV: "3.12", Compartido: "3.3",  YV_Market: "3.14" },
    pasivos:      { Bocu: "3.6", YV: "3.11", Compartido: "3.2",  YV_Market: "3.14" },
    parafiscales: { Bocu: "3.15",YV: "3.15", Compartido: "3.15", YV_Market: "3.15" },
  };
  return map[tipo]?.[centro] ?? "3.14";
}


export const FINANCIAMIENTO = {
  prestamo_recibido: { codigo: "10.1", label: "Préstamo recibido", afecta: "FC" },
  pago_capital: { codigo: "10.2", label: "Cuota — Capital", afecta: "FC" },
  pago_intereses: { codigo: "10.3", label: "Cuota — Intereses", afecta: "G&P" },
  dividendos: { codigo: "10.4", label: "Pago de dividendos", afecta: "FC" },
  aumento_capital: { codigo: "10.5", label: "Aumento de capital social", afecta: "FC" },
  capex: { codigo: "10.6", label: "CapEx — Activo fijo", afecta: "FC" },
  depreciacion: { codigo: "10.7", label: "Depreciación mensual", afecta: "G&P" },
};

export const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
