export type EstadoConciliacion = "pareado" | "posible" | "no_aplica" | "sin_pareo";

export const ESTADO_LABEL: Record<EstadoConciliacion, string> = {
  pareado: "Pareado",
  posible: "Posible pareo",
  no_aplica: "No aplica",
  sin_pareo: "Sin pareo",
};

/** Cuentas que por naturaleza no requieren una factura asociada */
const PREFIJOS_SIN_FACTURA = ["3.", "7.", "10.", "11.", "12.", "13.", "14."];

export function cuentaRequiereFactura(codigo?: string | null) {
  if (!codigo) return true;
  return !PREFIJOS_SIN_FACTURA.some((p) => codigo.startsWith(p));
}

/** 'BANK:{banco}|{fecha}|{ref}|{monto}' -> banco */
export function bancoDeReferencia(referencia?: string | null) {
  if (!referencia || !referencia.startsWith("BANK:")) return "—";
  return referencia.slice(5).split("|")[0] || "—";
}

/** 'BANK:{banco}|{fecha}|{ref}|{monto}' -> ref bancaria */
export function refBancaria(referencia?: string | null) {
  if (!referencia || !referencia.startsWith("BANK:")) return "";
  const parts = referencia.slice(5).split("|");
  return parts[2] ?? "";
}

/** Extrae posibles números de factura del memo bancario */
export function numerosEnMemo(texto?: string | null): string[] {
  if (!texto) return [];
  const out = new Set<string>();
  const t = texto.toUpperCase();
  const rxFact = /FACT(?:URA)?\.?\s*[N°#:]*\s*(\d{3,})/g;
  let m: RegExpExecArray | null;
  while ((m = rxFact.exec(t))) out.add(m[1]);
  const rxSuelto = /\b(\d{4,})\b/g;
  while ((m = rxSuelto.exec(t))) out.add(m[1]);
  return [...out];
}

export function normalizarFactura(n?: string | null) {
  if (!n) return "";
  return String(n).replace(/^0+/, "").replace(/\D/g, "");
}

export type FacturaRef = {
  id: string;
  fecha: string;
  numero_factura: string | null;
  monto_bs: number;
  cuenta_codigo: string;
  proveedor?: string | null;
};

export type ResultadoPareo = {
  estado: EstadoConciliacion;
  factura?: FacturaRef;
  motivo: string;
};

const diasEntre = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

export function parearMovimiento(
  mov: { fecha: string; notas?: string | null; monto_bs: number; cuenta_codigo: string },
  facturasPorNumero: Map<string, FacturaRef[]>,
  facturas: FacturaRef[],
): ResultadoPareo {
  const montoMov = Math.abs(Number(mov.monto_bs) || 0);

  // (a) match por número de factura en el memo
  for (const num of numerosEnMemo(mov.notas)) {
    const candidatos = facturasPorNumero.get(normalizarFactura(num));
    if (!candidatos?.length) continue;
    const conMonto = candidatos.find(
      (f) => montoMov > 0 && Math.abs(Math.abs(f.monto_bs) - montoMov) / montoMov <= 0.01,
    );
    const f = conMonto ?? candidatos[0];
    return {
      estado: "pareado",
      factura: f,
      motivo: conMonto ? `N° factura ${f.numero_factura} y monto coinciden` : `N° factura ${f.numero_factura} hallado en el memo`,
    };
  }

  // (b) match por monto + fecha cercana
  if (montoMov > 0) {
    const cerca = facturas.filter(
      (f) =>
        Math.abs(Math.abs(f.monto_bs) - montoMov) / montoMov <= 0.01 &&
        diasEntre(f.fecha, mov.fecha) <= 5,
    );
    if (cerca.length) {
      const f = cerca.sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha))[0];
      return { estado: "posible", factura: f, motivo: "Monto y fecha cercanos" };
    }
  }

  // (c) cuentas que no requieren factura
  if (!cuentaRequiereFactura(mov.cuenta_codigo)) {
    return { estado: "no_aplica", motivo: "La cuenta no requiere factura" };
  }

  return { estado: "sin_pareo", motivo: "Sin factura identificada" };
}
