/**
 * Clasificación automática de los pagos al personal que llegan por el reporte
 * de movimientos bancarios.
 *
 * Regla contable de fondo:
 * - Las propinas (13.1) y el bono 10% de servicio (13.4) YA se registraron como
 *   gasto/pasivo al importar las ventas de Xetux. El movimiento bancario sólo
 *   descarga el pasivo: se registra con signo negativo y NO genera gasto nuevo.
 * - La nómina, los parafiscales y los bonos propios sí son gasto nuevo.
 * - Un movimiento bancario = una transacción en una sola cuenta. El desglose
 *   fino (3.5, 3.10, 3.14, 3.20…) sólo existe en la nómina registrada a mano.
 */

export type TipoRegistro = "gasto" | "nomina" | "pasivo" | "sin_clasificar";

export type ClasificacionPersonal = {
  cuenta: string;
  tipo: TipoRegistro;
  nota?: string;
};

/** Cuentas de pasivo/activo transitorio: el movimiento descarga saldo, no crea gasto. */
export const CUENTAS_PASIVO_PAGO = new Set(["13.1", "13.2", "13.4", "14.1", "14.3"]);

/** Cuenta de pasivo por bonos 10% de servicio devengados en la importación de ventas. */
export const CUENTA_BONO_10 = "13.4";
/** Cuenta de pasivo por propinas devengadas en la importación de ventas. */
export const CUENTA_PROPINAS = "13.1";

const norm = (s: unknown) =>
  String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** ¿El movimiento pertenece al circuito de pagos al personal? */
export function esPagoPersonal(concepto: string, categoria?: string | null): boolean {
  const cat = norm(categoria).trim();
  if (cat === "MO") return true;
  const c = norm(concepto);
  return /NOMINA|SUELDO|SALARIO|PROPINA|\bPROP\b|BONO|LIQUID|PARAFISCAL|IVSS|FAOV|INCES|SEGURO\s*SOCIAL|CESTA\s*TICKET|ANTICIPO|ANTC|PRESTAMO/.test(
    c,
  );
}

/**
 * Devuelve la cuenta y el tipo de registro para un pago al personal.
 * Gana la primera regla que coincida.
 */
export function clasificarPagoPersonal(
  concepto: string,
  categoria?: string | null,
  centro?: string | null,
): ClasificacionPersonal | null {
  const c = norm(concepto);
  const cen = norm(centro);
  const esMO = norm(categoria).trim() === "MO";

  // 1. Parafiscales
  if (/IVSS|FAOV|INCES|PARAFISCAL|SEGURO\s*SOCIAL/.test(c)) {
    return { cuenta: "3.15", tipo: "nomina" };
  }

  // 2. Propinas → pago de pasivo
  if (/PROPINA|\bPROPS?\b/.test(c)) {
    return {
      cuenta: CUENTA_PROPINAS,
      tipo: "pasivo",
      nota: "Pago de pasivo — no crea gasto nuevo (propina ya devengada en ventas)",
    };
  }

  // 3. Bono 10% de servicio → pago de pasivo
  if (/BONO\s*10|10\s*%|BONO\s*SERV|SERV\s*10|SERVICIO\s*10/.test(c)) {
    return {
      cuenta: CUENTA_BONO_10,
      tipo: "pasivo",
      nota: "Bono 10% — ya devengado en la importación de ventas",
    };
  }

  // 4. Bono de alimentación
  if (/BONO\s*ALIM|B\.?\s*ALIM|CESTA\s*TICKET|ALIMENTACION/.test(c)) {
    return { cuenta: "3.20", tipo: "nomina" };
  }

  // 5. Liquidaciones (por centro / texto)
  if (/LIQUID|TERMINACION|PERIODO\s*PRUEB/.test(c)) {
    if (/ADMIN/.test(c)) return { cuenta: "3.18", tipo: "nomina" };
    if (/COCINA|CHEF|COCINERO/.test(c)) return { cuenta: "3.3", tipo: "nomina" };
    if (/BOCU/.test(c) || cen === "BOCU") return { cuenta: "3.7", tipo: "nomina" };
    return { cuenta: "3.12", tipo: "nomina" };
  }

  // 6. Préstamos y anticipos (activos transitorios)
  if (/PRESTAMO/.test(c)) {
    return { cuenta: "14.1", tipo: "pasivo", nota: "Préstamo al personal — activo transitorio" };
  }
  if (/ANTICIPO|\bANTC\b/.test(c)) {
    return { cuenta: "14.3", tipo: "pasivo", nota: "Anticipo al personal — activo transitorio" };
  }

  // 7. Nómina por área
  if (/COCINA|CHEF|COCINERO/.test(c)) return { cuenta: "3.1", tipo: "nomina" };
  if (/SALA\s*YV|NOMINA\s*YV|YV\s*SALA|\bYV\b/.test(c)) return { cuenta: "3.9", tipo: "nomina" };
  if (/SALA\s*BOCU|NOMINA\s*BOCU|BOCU\s*SALA|\bBOCU\b/.test(c)) return { cuenta: "3.4", tipo: "nomina" };
  if (/ADMIN/.test(c)) return { cuenta: "3.16", tipo: "nomina" };

  // 8. Por defecto, sólo si la categoría del reporte dice que es mano de obra
  if (esMO) return { cuenta: "3.4", tipo: "nomina" };

  return null;
}

/** Tipo de registro de una cuenta cualquiera (para la columna de la vista previa). */
export function tipoRegistroDeCuenta(codigo?: string | null): TipoRegistro {
  const c = String(codigo ?? "").trim();
  if (!c) return "sin_clasificar";
  if (CUENTAS_PASIVO_PAGO.has(c)) return "pasivo";
  if (c === "3" || c.startsWith("3.")) return "nomina";
  return "gasto";
}

export const TIPO_REGISTRO_LABEL: Record<TipoRegistro, string> = {
  gasto: "Gasto nuevo",
  nomina: "Nómina",
  pasivo: "Pago de pasivo",
  sin_clasificar: "Sin clasificar",
};

/** ¿El movimiento se registra con signo negativo (descarga de pasivo)? */
export function descargaPasivo(codigo?: string | null): boolean {
  const c = String(codigo ?? "").trim();
  return c === CUENTA_PROPINAS || c === CUENTA_BONO_10;
}
