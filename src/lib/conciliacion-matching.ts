import { dentroDeTolerancia } from "@/lib/cxp-saldo";

export type EstadoConciliacion = "pareado" | "parcial" | "posible" | "no_aplica" | "sin_pareo" | "pendiente_revision";

export const ESTADO_LABEL: Record<EstadoConciliacion, string> = {
  pareado: "Pareado",
  parcial: "Pareado parcial",
  posible: "Posible pareo",
  no_aplica: "Gasto Stand-Alone (sin factura)",
  sin_pareo: "Sin pareo (soporte pendiente)",
  pendiente_revision: "Pendiente de revisión",
};

/** Cuentas que por naturaleza no requieren una factura asociada */
const PREFIJOS_SIN_FACTURA = ["3.", "5.", "6.", "7."];
/** Cuentas puntuales sin factura (p. ej. Alquiler, gastos financieros, pasivos
 *  transitorios, activos transitorios, operaciones de cambio (98) y cuentas
 *  no contables (99)) */
const CUENTAS_SIN_FACTURA = new Set(["4.3", "4.8", "8.1", "8.3", "9.1", "9.3", "98", "99"]);
/** Cuentas que sí pueden llevar factura pese al prefijo (CapEx, pagos de CxP, anticipos) */
const EXCEPCIONES_CON_FACTURA = new Set(["5.6", "8.2", "9.2"]);

export function cuentaRequiereFactura(codigo?: string | null) {
  if (!codigo) return true;
  if (EXCEPCIONES_CON_FACTURA.has(codigo)) return true;
  if (CUENTAS_SIN_FACTURA.has(codigo)) return false;
  return !PREFIJOS_SIN_FACTURA.some((p) => codigo.startsWith(p));
}

/** Cuentas de compra/gasto: las únicas cuyas facturas pueden parear con un egreso bancario */
const PREFIJOS_FACTURA_COMPRA = ["2.", "4."];
export function esFacturaDeCompra(codigo?: string | null) {
  if (!codigo) return false;
  if (codigo === "5.6") return true;
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
  // BA (Banco de Venezuela/Banesco) guarda referencias con apóstrofe inicial.
  return (parts[2] ?? "").replace(/^['´`‘’]+/, "");
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

/**
 * ¿El memo bancario menciona (aprox.) al proveedor?
 *
 * Si el nombre del proveedor tiene VARIOS tokens significativos (ej.
 * "MANICERIA SAN JORGE" → "MANICERIA", "JORGE"), no basta con que aparezca
 * uno solo — de lo contrario, un nombre de persona común como "Jorge"
 * (en un pago de nómina) haría match falso con cualquier proveedor que
 * tenga esa palabra suelta en su razón social.
 */
export function proveedorSimilar(proveedor?: string | null, memo?: string | null) {
  const toks = tokensProveedor(proveedor);
  if (!toks.length) return false;
  const texto = normalizarProveedor(memo);
  if (!texto) return false;
  const coincidencias = toks.filter((t) => texto.includes(t)).length;
  return toks.length === 1 ? coincidencias >= 1 : coincidencias >= 2;
}

export type TerceroRef = { id: string; nombre: string };

/**
 * Adivina el proveedor a partir del concepto bancario (columna F del archivo
 * importado, guardada en las notas del movimiento). Devuelve el tercero con
 * mayor cantidad de tokens presentes en el memo.
 */
export function proveedorDeMemo(memo: string | null | undefined, terceros: TerceroRef[]): TerceroRef | null {
  const texto = normalizarProveedor(memo);
  if (!texto) return null;
  let mejor: TerceroRef | null = null;
  let mejorScore = 0;
  for (const t of terceros) {
    const toks = tokensProveedor(t.nombre);
    if (!toks.length) continue;
    let score = 0;
    let coincidencias = 0;
    for (const tok of toks) if (texto.includes(tok)) { score += tok.length; coincidencias++; }
    // Igual que proveedorSimilar: si el proveedor tiene varios tokens
    // significativos, una sola palabra suelta (ej. un nombre de persona
    // común que también aparece en la razón social) no basta.
    if (toks.length > 1 && coincidencias < 2) continue;
    if (score > mejorScore) { mejorScore = score; mejor = t; }
  }
  // exigir una coincidencia mínimamente significativa
  return mejorScore >= 5 ? mejor : null;
}

export type FacturaRef = {
  id: string;
  fecha: string;
  numero_factura: string | null;
  monto_bs: number;
  /** Deuda denominada en USD BCV; monto_bs es solo el valor histórico. */
  usd_bcv?: number | null;
  cuenta_codigo: string;
  proveedor?: string | null;
  tercero_id?: string | null;
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
  /** Números detectados en el memo que no se pudieron ubicar */
  faltantes?: string[];
};


export const diasEntre = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

const montoFacturaBs = (f: FacturaRef, tasaBcv?: number) =>
  Number(tasaBcv) > 0 && Number(f.usd_bcv) > 0
    ? +(Number(f.usd_bcv) * Number(tasaBcv)).toFixed(2)
    : Math.abs(Number(f.monto_bs) || 0);

const montoCoincide = (a: number, b: number) =>
  b > 0 && dentroDeTolerancia(Math.abs(a) - b, b);

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
  tasaBcv?: number,
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
        suma += montoFacturaBs(lista[i], tasaBcv);
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

const sumaBs = (fs: FacturaRef[], tasaBcv?: number) =>
  fs.reduce((s, f) => s + montoFacturaBs(f, tasaBcv), 0);

const res = (
  estado: EstadoConciliacion,
  facturas: FacturaRef[],
  motivo: string,
  faltantes: string[] = [],
  tasaBcv?: number,
): ResultadoPareo => ({
  estado,
  facturas,
  factura: facturas[0],
  total: sumaBs(facturas, tasaBcv),
  motivo,
  faltantes,
});

/**
 * Cobertura de un conjunto de facturas frente al monto del movimiento.
 * "completa" si suman el monto (±1%), "parcial" en cualquier otro caso.
 */
export function coberturaPareo(facturas: FacturaRef[], montoMov: number, tasaBcv?: number) {
  const total = sumaBs(facturas, tasaBcv);
  const monto = Math.abs(Number(montoMov) || 0);
  const completa = monto > 0 ? montoCoincide(total, monto) : facturas.length > 0;
  return { total, monto, completa, diferencia: monto - total };
}

/**
 * Busca una combinación de VARIOS movimientos bancarios (del mismo proveedor,
 * ya que ninguno cubre la factura por sí solo) cuya suma se acerque al saldo
 * pendiente de una factura — el caso típico de una factura grande pagada en
 * cuotas a través de varias transferencias.
 *
 * No es un modelo de IA: es una búsqueda combinatoria acotada (2 a 5
 * movimientos, máximo 12 candidatos), determinística y auditable, igual de
 * "inteligente" para este propósito pero instantánea y sin costo.
 */
export function sugerirCombinacionParaFactura(
  factura: { proveedor: string | null; pendienteBs: number },
  candidatos: { id: string; monto_bs: number; notas?: string | null }[],
  toleranciaBs = 5,
): string[] {
  const pend = Math.abs(Number(factura.pendienteBs) || 0);
  if (pend <= 0) return [];

  const relevantes = candidatos
    .filter((m) => proveedorSimilar(factura.proveedor, m.notas))
    .filter((m) => {
      const monto = Math.abs(Number(m.monto_bs) || 0);
      return monto > 0 && monto <= pend + toleranciaBs;
    })
    .slice(0, 12);

  if (relevantes.length < 2) return []; // 0 o 1 candidato ya lo cubre el pareo individual normal

  let mejor: number[] | null = null;
  let mejorDiff = Infinity;

  const buscar = (inicio: number, elegidos: number[], suma: number) => {
    if (elegidos.length >= 2) {
      const diff = Math.abs(suma - pend);
      if (diff <= toleranciaBs && diff < mejorDiff) {
        mejorDiff = diff;
        mejor = [...elegidos];
      }
    }
    if (elegidos.length >= 5 || suma > pend + toleranciaBs) return; // poda: tope de tamaño y de suma
    for (let i = inicio; i < relevantes.length; i++) {
      elegidos.push(i);
      buscar(i + 1, elegidos, suma + Math.abs(Number(relevantes[i].monto_bs) || 0));
      elegidos.pop();
    }
  };
  buscar(0, [], 0);

  return mejor ? (mejor as number[]).map((i) => relevantes[i].id) : [];
}

/** Números del memo que existen realmente como factura y los que no */
export function numerosMemoNoUbicados(
  memo: string | null | undefined,
  facturasPorNumero: Map<string, FacturaRef[]>,
): string[] {
  const out: string[] = [];
  for (const n of numerosEnMemo(memo)) {
    const k = normalizarFactura(n);
    if (!k || k.length < 3) continue;
    if (facturasPorNumero.has(k)) continue;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

export function parearMovimiento(
  mov: {
    fecha: string;
    notas?: string | null;
    monto_bs: number;
    cuenta_codigo: string;
    tasa_bcv?: number | null;
    tercero_id?: string | null;
  },
  facturasPorNumero: Map<string, FacturaRef[]>,
  facturas: FacturaRef[],
  /** Proveedor conocido/adivinado del movimiento (mejora la selección de candidatas) */
  proveedorMov?: { id?: string | null; nombre?: string | null } | null,
): ResultadoPareo {
  // (0) cuentas que por naturaleza no llevan factura: nunca se parean
  if (!cuentaRequiereFactura(mov.cuenta_codigo)) {
    return res("no_aplica", [], "La cuenta no requiere factura");
  }

  const montoMov = Math.abs(Number(mov.monto_bs) || 0);
  const tasaBcvMov = Number(mov.tasa_bcv) || 0;
  const memo = mov.notas ?? "";
  const provId = proveedorMov?.id ?? mov.tercero_id ?? null;
  const provNombre = proveedorMov?.nombre ?? null;

  /** ¿La factura pertenece al proveedor del movimiento? */
  const esDelProveedor = (f: FacturaRef) => {
    if (provId && f.tercero_id) return f.tercero_id === provId;
    if (provNombre) return proveedorSimilar(f.proveedor, provNombre) || proveedorSimilar(provNombre, f.proveedor ?? "");
    return proveedorSimilar(f.proveedor, memo);
  };

  const sufijo = provNombre ? ` · proveedor ${provNombre}` : "";

  // (a) números de factura hallados/expandidos en el memo
  const numeros = expandirNumerosMemo(memo, (k) => facturasPorNumero.has(k));
  const noUbicados = numerosMemoNoUbicados(memo, facturasPorNumero);
  if (numeros.length) {
    const grupo: FacturaRef[] = [];
    for (const num of numeros) {
      const candidatos = facturasPorNumero.get(num) ?? [];
      if (!candidatos.length) continue;
      const conProv = candidatos.find((f) => esDelProveedor(f));
      const conMonto = candidatos.find((f) => montoCoincide(montoFacturaBs(f, tasaBcvMov), montoMov));
      const elegida = conProv ?? conMonto ?? candidatos[0];
      if (!grupo.some((g) => g.id === elegida.id)) grupo.push(elegida);
    }
    if (grupo.length) {
      const { total, completa, diferencia } = coberturaPareo(grupo, montoMov, tasaBcvMov);
      const nums = grupo.map((g) => g.numero_factura).join(", ");
      if (completa) {
        return res(
          "pareado",
          grupo,
          grupo.length === 1
            ? `N° factura ${nums} hallado en el memo${sufijo}`
            : `${grupo.length} facturas del memo (${nums}) suman el monto del pago`,
          noUbicados,
          tasaBcvMov,
        );
      }
      // intentar subconjunto que sí cuadre exactamente
      const sub = buscarCombinacionPorMonto(grupo, montoMov, grupo.length, tasaBcvMov);
      if (sub && sub.length !== grupo.length) {
        return res("pareado", sub, `${sub.length} facturas del memo suman el monto del pago`, noUbicados, tasaBcvMov);
      }
      const detalleFaltan = noUbicados.length
        ? ` · ${noUbicados.length} número(s) del memo sin factura registrada (${noUbicados.join(", ")})`
        : "";
      return res(
        "parcial",
        grupo,
        `${grupo.length} factura(s) del memo (${nums}) cubren ${total.toFixed(2)} de ${montoMov.toFixed(2)} Bs; faltan ${diferencia.toFixed(2)} Bs${detalleFaltan}`,
        noUbicados,
        tasaBcvMov,
      );
    }
  }

  const numsMemo = numerosEnMemo(memo);
  const conProveedor = facturas.filter((f) => esDelProveedor(f));

  // (b) proveedor conocido + varias facturas que suman el monto
  if (conProveedor.length > 1 && montoMov > 0) {
    const cercanas = conProveedor
      .filter((f) => diasEntre(f.fecha, mov.fecha) <= 30)
      .sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha));
    const combo = buscarCombinacionPorMonto(cercanas, montoMov, 4, tasaBcvMov);
    if (combo && combo.length > 1) {
      return res("posible", combo, `${combo.length} facturas del proveedor suman el monto del pago${sufijo}`, noUbicados, tasaBcvMov);
    }
  }

  // (c) proveedor + número de factura parecido
  if (numsMemo.length) {
    const casi = conProveedor.find((f) => numsMemo.some((n) => numeroSimilar(f.numero_factura, n)));
    if (casi) return res("posible", [casi], `Proveedor y N° de factura ${casi.numero_factura} parecidos`, noUbicados, tasaBcvMov);
  }

  // (d) proveedor + monto igual
  const provMonto = conProveedor.find((f) => montoCoincide(montoFacturaBs(f, tasaBcvMov), montoMov));
  if (provMonto) return res("posible", [provMonto], `Proveedor y monto coinciden${sufijo}`, noUbicados, tasaBcvMov);

  // (e) monto + fecha cercana
  if (montoMov > 0) {
    const cerca = facturas.filter(
      (f) => montoCoincide(montoFacturaBs(f, tasaBcvMov), montoMov) && diasEntre(f.fecha, mov.fecha) <= 5,
    );
    if (cerca.length) {
      const f = cerca.sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha))[0];
      return res("posible", [f], "Monto y fecha cercanos", noUbicados, tasaBcvMov);
    }
  }

  // (f) proveedor + fecha cercana (señal débil)
  const provFecha = conProveedor
    .filter((f) => diasEntre(f.fecha, mov.fecha) <= 10)
    .sort((a, b) => diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha))[0];
  if (provFecha) return res("posible", [provFecha], `Proveedor y fecha cercanos (monto distinto)${sufijo}`, noUbicados, tasaBcvMov);

  return res("sin_pareo", [], "Sin factura identificada", noUbicados);

}


// ─────────────────────────────────────────────────────────────
// Recálculo de pareos cuando llegan facturas nuevas
// ─────────────────────────────────────────────────────────────

export type CambioPareo =
  | "nuevo_pareo"       // estaba sin pareo y ahora hay sugerencia
  | "parcial_completable" // pareo parcial que con facturas nuevas cuadra
  | "rechazo_obsoleto"  // se rechazó una sugerencia distinta a la actual
  | "sin_cambio";

export type EntradaRecalculo = {
  movId: string;
  montoBs: number;
  /** Resultado del pareo automático recalculado con las facturas actuales */
  auto: ResultadoPareo;
  /** Facturas ya confirmadas (vínculos guardados, no rechazados) */
  confirmadas: string[];
  /** ¿Existe un rechazo guardado para este movimiento? */
  rechazado: boolean;
  /** Facturas contra las que se rechazó (vacío en rechazos antiguos) */
  rechazadas: string[];
  /** ¿El pareo confirmado fue manual? (no se pisa nunca) */
  manual: boolean;
};

export type ResultadoRecalculo = {
  movId: string;
  cambio: CambioPareo;
  /** Facturas que quedarían vinculadas si se aplica el cambio */
  facturas: FacturaRef[];
  estado: "pareado" | "parcial";
  motivo: string;
};

const mismoConjunto = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * Clasifica cada movimiento según lo que cambiaría al reevaluar el pareo con
 * las facturas actuales. Función pura: no escribe nada, sirve de vista previa.
 */
export function recalcularPareos(entradas: EntradaRecalculo[]): ResultadoRecalculo[] {
  const out: ResultadoRecalculo[] = [];

  for (const e of entradas) {
    const sugeridas = e.auto.facturas ?? [];
    const idsSug = sugeridas.map((f) => f.id);

    // nunca se pisa una decisión manual — con factura confirmada, o sin ella
    // (ej. "Sin pareo (revisado)" o "Gasto Stand-Alone": el usuario ya
    // revisó este movimiento y decidió que no lleva factura, así que no
    // debe volver a aparecer como sugerencia de recálculo).
    if (e.manual) continue;

    if (e.confirmadas.length) {
      // ¿pareo parcial que ahora se puede completar?
      const cobActual = coberturaPareo(
        sugeridas.filter((f) => e.confirmadas.includes(f.id)),
        e.montoBs,
      );
      const yaCompleto = mismoConjunto(e.confirmadas, idsSug) && cobActual.completa;
      if (yaCompleto) continue;

      const union = new Map<string, FacturaRef>();
      for (const f of sugeridas) union.set(f.id, f);
      const faltanConfirmadas = e.confirmadas.filter((id) => !union.has(id));
      // solo se puede completar si la sugerencia contiene todo lo confirmado
      if (faltanConfirmadas.length) continue;

      const cobNueva = coberturaPareo(sugeridas, e.montoBs);
      if (sugeridas.length > e.confirmadas.length && cobNueva.completa) {
        out.push({
          movId: e.movId,
          cambio: "parcial_completable",
          facturas: sugeridas,
          estado: "pareado",
          motivo: `Se agregan ${sugeridas.length - e.confirmadas.length} factura(s) nueva(s) y el pago queda cubierto`,
        });
      }
      continue;
    }

    if (!sugeridas.length) continue;

    if (e.rechazado) {
      // el rechazo sigue vigente si la sugerencia es la misma que se rechazó
      if (e.rechazadas.length && mismoConjunto(e.rechazadas, idsSug)) continue;
      out.push({
        movId: e.movId,
        cambio: "rechazo_obsoleto",
        facturas: sugeridas,
        estado: e.auto.estado === "parcial" ? "parcial" : "pareado",
        motivo: e.rechazadas.length
          ? "Hay una sugerencia distinta a la que se rechazó"
          : "Aparecieron facturas nuevas después del rechazo",
      });
      continue;
    }

    if (e.auto.estado === "pareado" || e.auto.estado === "parcial") {
      out.push({
        movId: e.movId,
        cambio: "nuevo_pareo",
        facturas: sugeridas,
        estado: e.auto.estado === "parcial" ? "parcial" : "pareado",
        motivo: e.auto.motivo,
      });
    }
  }

  return out;
}
