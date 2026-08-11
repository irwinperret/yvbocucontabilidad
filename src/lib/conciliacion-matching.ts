export type EstadoConciliacion = "pareado" | "posible" | "no_aplica" | "sin_pareo";

export const ESTADO_LABEL: Record<EstadoConciliacion, string> = {
  pareado: "Pareado",
  posible: "Posible pareo",
  no_aplica: "No aplica",
  sin_pareo: "Sin pareo",
};

/** Cuentas que por naturaleza no requieren una factura asociada */
const PREFIJOS_SIN_FACTURA = ["3.", "7.", "10.", "11.", "12.", "13.", "14."];
/** Cuentas puntuales sin factura (p. ej. Condo + Alquiler) */
const CUENTAS_SIN_FACTURA = new Set(["4.10"]);
/** 10.6 CapEx sí puede tener factura */
const EXCEPCIONES_CON_FACTURA = new Set(["10.6"]);

export function cuentaRequiereFactura(codigo?: string | null) {
  if (!codigo) return true;
  if (EXCEPCIONES_CON_FACTURA.has(codigo)) return true;
  if (CUENTAS_SIN_FACTURA.has(codigo)) return false;
  return !PREFIJOS_SIN_FACTURA.some((p) => codigo.startsWith(p));
}

/** Cuentas de compra/gasto: las únicas cuyas facturas pueden parear con un egreso bancario */
const PREFIJOS_FACTURA_COMPRA = ["2.", "4.", "5.", "6.", "8.", "9."];
export function esFacturaDeCompra(codigo?: string | null) {
  if (!codigo) return false;
  if (EXCEPCIONES_CON_FACTURA.has(codigo)) return true;
  if (CUENTAS_SIN_FACTURA.has(codigo)) return false;
  return PREFIJOS_FACTURA_COMPRA.some((p) => codigo.startsWith(p));
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

/** Dos números de factura "parecidos": mismo valor con ceros/prefijos, o difieren en 1 dígito */
export function numeroSimilar(a?: string | null, b?: string | null) {
  const x = normalizarFactura(a);
  const y = normalizarFactura(b);
  if (!x || !y || x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  if (x.endsWith(y) || y.endsWith(x)) return Math.abs(x.length - y.length) <= 2;
  if (x.length === y.length) {
    let diff = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
    return diff === 1;
  }
  return false;
}

const SUFIJOS = new Set([
  "CA", "SA", "SRL", "RL", "COMPANIA", "COMPANIA ANONIMA", "ANONIMA", "FIRMA",
  "RIF", "J", "V", "E", "G", "DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "C",
  "INVERSIONES", "DISTRIBUIDORA", "COMERCIALIZADORA", "GRUPO", "SERVICIOS",
]);

export function normalizarProveedor(n?: string | null) {
  if (!n) return "";
  return n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensProveedor(n?: string | null) {
  return normalizarProveedor(n)
    .split(" ")
    .filter((t) => t.length >= 4 && !SUFIJOS.has(t) && !/^\d+$/.test(t));
}

/** ¿El memo bancario menciona (aprox.) al proveedor? */
export function proveedorSimilar(proveedor?: string | null, memo?: string | null) {
  const toks = tokensProveedor(proveedor);
  if (!toks.length) return false;
  const texto = normalizarProveedor(memo);
  if (!texto) return false;
  return toks.some((t) => texto.includes(t));
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

const montoCoincide = (a: number, b: number) => b > 0 && Math.abs(Math.abs(a) - b) / b <= 0.01;

export function parearMovimiento(
  mov: { fecha: string; notas?: string | null; monto_bs: number; cuenta_codigo: string },
  facturasPorNumero: Map<string, FacturaRef[]>,
  facturas: FacturaRef[],
): ResultadoPareo {
  // (0) cuentas que por naturaleza no llevan factura: nunca se parean
  if (!cuentaRequiereFactura(mov.cuenta_codigo)) {
    return { estado: "no_aplica", motivo: "La cuenta no requiere factura" };
  }

  const montoMov = Math.abs(Number(mov.monto_bs) || 0);
  const memo = mov.notas ?? "";

  // (a) match por número de factura exacto hallado en el memo
  for (const num of numerosEnMemo(memo)) {
    const candidatos = facturasPorNumero.get(normalizarFactura(num));
    if (!candidatos?.length) continue;
    const conProveedor = candidatos.find((f) => proveedorSimilar(f.proveedor, memo));
    if (conProveedor) {
      return {
        estado: "pareado",
        factura: conProveedor,
        motivo: `Proveedor y N° de factura ${conProveedor.numero_factura} coinciden`,
      };
    }
    const conMonto = candidatos.find((f) => montoCoincide(f.monto_bs, montoMov));
    const f = conMonto ?? candidatos[0];
    return {
      estado: "pareado",
      factura: f,
      motivo: conMonto
        ? `N° factura ${f.numero_factura} y monto coinciden`
        : `N° factura ${f.numero_factura} hallado en el memo`,
    };
  }

  const numsMemo = numerosEnMemo(memo);
  const conProveedor = facturas.filter((f) => proveedorSimilar(f.proveedor, memo));

  // (b) proveedor parecido + número de factura parecido
  if (numsMemo.length) {
    const casi = conProveedor.find((f) => numsMemo.some((n) => numeroSimilar(f.numero_factura, n)));
    if (casi) {
      return { estado: "posible", factura: casi, motivo: `Proveedor y N° de factura ${casi.numero_factura} parecidos` };
    }
  }

  // (c) proveedor parecido + monto igual
  const provMonto = conProveedor.find((f) => montoCoincide(f.monto_bs, montoMov));
  if (provMonto) {
    return { estado: "posible", factura: provMonto, motivo: "Proveedor y monto coinciden" };
  }

  // (d) monto + fecha cercana
  if (montoMov > 0) {
    const cerca = facturas.filter(
      (f) => montoCoincide(f.monto_bs, montoMov) && diasEntre(f.fecha, mov.fecha) <= 5,
    );
    if (cerca.length) {
      const f = cerca.sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha))[0];
      return { estado: "posible", factura: f, motivo: "Monto y fecha cercanos" };
    }
  }

  // (e) proveedor parecido + fecha cercana (señal débil)
  const provFecha = conProveedor
    .filter((f) => diasEntre(f.fecha, mov.fecha) <= 10)
    .sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha))[0];
  if (provFecha) {
    return { estado: "posible", factura: provFecha, motivo: "Proveedor y fecha cercanos (monto distinto)" };
  }

  return { estado: "sin_pareo", motivo: "Sin factura identificada" };
}
