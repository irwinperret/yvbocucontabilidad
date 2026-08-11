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
  /** Primera factura del grupo (compatibilidad) */
  factura?: FacturaRef;
  /** Grupo completo de facturas sugeridas */
  facturas: FacturaRef[];
  /** Suma en Bs del grupo sugerido */
  total: number;
  motivo: string;
};

const diasEntre = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

const montoCoincide = (a: number, b: number) => b > 0 && Math.abs(Math.abs(a) - b) / b <= 0.01;

/** Tokens numéricos del memo, en orden de aparición */
function tokensNumericos(texto?: string | null): string[] {
  if (!texto) return [];
  return (texto.toUpperCase().match(/\d{2,}/g) ?? []).map((t) => t);
}

/**
 * Expande memos del tipo "F241714 1860 61 77": el primer número largo es la base
 * y los siguientes, más cortos, reemplazan los últimos dígitos de la base.
 * Solo devuelve candidatos que existan realmente en el índice de facturas.
 */
export function expandirNumerosMemo(
  memo: string | null | undefined,
  existe: (numeroNormalizado: string) => boolean,
): string[] {
  const out: string[] = [];
  const push = (n: string) => {
    const k = normalizarFactura(n);
    if (!k || !existe(k)) return false;
    if (!out.includes(k)) out.push(k);
    return true;
  };

  const tokens = tokensNumericos(memo);
  let base = "";
  for (const tok of tokens) {
    const t = tok.replace(/\D/g, "");
    if (!t) continue;

    if (t.length >= 5) {
      push(t);
      base = t; // el último número largo pasa a ser la base
      continue;
    }

    // token corto: primero intentar completarlo con la base (memos tipo "241714 1860 61 77")
    let resuelto = false;
    if (base && t.length < base.length) {
      const cand = base.slice(0, base.length - t.length) + t;
      if (push(cand)) {
        base = cand; // la base avanza al último número resuelto
        resuelto = true;
      }
    }
    if (!resuelto) push(t);
  }
  return out;
}


/** Busca un subconjunto (hasta `max` facturas) cuya suma coincida con el monto */
export function buscarCombinacionPorMonto(
  candidatas: FacturaRef[],
  monto: number,
  max = 4,
): FacturaRef[] | null {
  if (monto <= 0 || candidatas.length === 0) return null;
  const lista = candidatas.slice(0, 14);
  const n = lista.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let count = 0;
    let suma = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        count++;
        if (count > max) break;
        suma += Math.abs(lista[i].monto_bs);
      }
    }
    if (count === 0 || count > max) continue;
    if (montoCoincide(suma, monto)) {
      const sel: FacturaRef[] = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) sel.push(lista[i]);
      return sel;
    }
  }
  return null;
}

const sumaBs = (fs: FacturaRef[]) => fs.reduce((s, f) => s + Math.abs(Number(f.monto_bs) || 0), 0);

const res = (
  estado: EstadoConciliacion,
  facturas: FacturaRef[],
  motivo: string,
): ResultadoPareo => ({
  estado,
  facturas,
  factura: facturas[0],
  total: sumaBs(facturas),
  motivo,
});

export function parearMovimiento(
  mov: { fecha: string; notas?: string | null; monto_bs: number; cuenta_codigo: string },
  facturasPorNumero: Map<string, FacturaRef[]>,
  facturas: FacturaRef[],
): ResultadoPareo {
  // (0) cuentas que por naturaleza no llevan factura: nunca se parean
  if (!cuentaRequiereFactura(mov.cuenta_codigo)) {
    return res("no_aplica", [], "La cuenta no requiere factura");
  }

  const montoMov = Math.abs(Number(mov.monto_bs) || 0);
  const memo = mov.notas ?? "";

  // (a) números de factura hallados/expandidos en el memo
  const numeros = expandirNumerosMemo(memo, (k) => facturasPorNumero.has(k));
  if (numeros.length) {
    const grupo: FacturaRef[] = [];
    for (const num of numeros) {
      const candidatos = facturasPorNumero.get(num) ?? [];
      if (!candidatos.length) continue;
      const conProv = candidatos.find((f) => proveedorSimilar(f.proveedor, memo));
      const conMonto = candidatos.find((f) => montoCoincide(f.monto_bs, montoMov));
      const elegida = conProv ?? conMonto ?? candidatos[0];
      if (!grupo.some((g) => g.id === elegida.id)) grupo.push(elegida);
    }
    if (grupo.length) {
      const total = sumaBs(grupo);
      const nums = grupo.map((g) => g.numero_factura).join(", ");
      if (grupo.length === 1) {
        return res("pareado", grupo, `N° factura ${nums} hallado en el memo`);
      }
      if (montoCoincide(total, montoMov)) {
        return res("pareado", grupo, `${grupo.length} facturas del memo (${nums}) suman el monto del pago`);
      }
      // intentar subconjunto que sí cuadre
      const sub = buscarCombinacionPorMonto(grupo, montoMov, grupo.length);
      if (sub && sub.length !== grupo.length) {
        return res(
          "pareado",
          sub,
          `${sub.length} facturas del memo suman el monto del pago`,
        );
      }
      const dif = total - montoMov;
      return res(
        "posible",
        grupo,
        `${grupo.length} facturas del memo (${nums}); diferencia de ${dif.toFixed(2)} Bs`,
      );
    }
  }

  const numsMemo = numerosEnMemo(memo);
  const conProveedor = facturas.filter((f) => proveedorSimilar(f.proveedor, memo));

  // (b) proveedor parecido + varias facturas que suman el monto
  if (conProveedor.length > 1 && montoMov > 0) {
    const cercanas = conProveedor
      .filter((f) => diasEntre(f.fecha, mov.fecha) <= 30)
      .sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha));
    const combo = buscarCombinacionPorMonto(cercanas, montoMov, 4);
    if (combo && combo.length > 1) {
      return res(
        "posible",
        combo,
        `${combo.length} facturas del proveedor suman el monto del pago`,
      );
    }
  }

  // (c) proveedor parecido + número de factura parecido
  if (numsMemo.length) {
    const casi = conProveedor.find((f) => numsMemo.some((n) => numeroSimilar(f.numero_factura, n)));
    if (casi) return res("posible", [casi], `Proveedor y N° de factura ${casi.numero_factura} parecidos`);
  }

  // (d) proveedor parecido + monto igual
  const provMonto = conProveedor.find((f) => montoCoincide(f.monto_bs, montoMov));
  if (provMonto) return res("posible", [provMonto], "Proveedor y monto coinciden");

  // (e) monto + fecha cercana
  if (montoMov > 0) {
    const cerca = facturas.filter(
      (f) => montoCoincide(f.monto_bs, montoMov) && diasEntre(f.fecha, mov.fecha) <= 5,
    );
    if (cerca.length) {
      const f = cerca.sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha))[0];
      return res("posible", [f], "Monto y fecha cercanos");
    }
  }

  // (f) proveedor parecido + fecha cercana (señal débil)
  const provFecha = conProveedor
    .filter((f) => diasEntre(f.fecha, mov.fecha) <= 10)
    .sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha))[0];
  if (provFecha) return res("posible", [provFecha], "Proveedor y fecha cercanos (monto distinto)");

  return res("sin_pareo", [], "Sin factura identificada");
}

