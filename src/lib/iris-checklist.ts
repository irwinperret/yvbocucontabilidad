// Datos para el checklist mensual de Iris (ver ChecklistIrisCard), un
// recorte de ChecklistMensualCard (que vive en Inicio) a solo los 5 pasos
// que son trabajo de Iris -- sin ventas/compras Xetux ni "cerrar el mes",
// que no son cosas que ella mande -- y siempre fijado al mes calendario
// anterior, no al mes actual: el trabajo de Iris cada mes es cerrar el mes
// que ya terminó.

import { supabase } from "@/integrations/supabase/client";

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Periodo (YYYY-MM) del mes calendario anterior al actual, siempre. */
export function mesPasado(): string {
  const hoy = new Date();
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" -> "Septiembre 2026". */
export function nombreMesPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const nombre = NOMBRES_MES[(mes - 1 + 12) % 12] ?? "";
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}

/** Suma (o resta, con delta negativo) meses a un periodo "YYYY-MM". */
export function sumarMeses(periodo: string, delta: number): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const d = new Date(anio, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Movimientos bancarios importados que todavía no se confirmaron como
 * vinculados a una factura (conciliación manual), ni como gasto directo
 * sin proveedor. Se extrae aquí (en vez de vivir solo dentro de IrisPage)
 * para que el checklist nuevo y la tarjeta "Movimientos bancarios sin
 * proveedor" de más abajo compartan una sola fuente de verdad -- y, como
 * usan la misma query key, React Query solo la pide una vez por carga de
 * página aunque las muestren dos componentes distintos.
 */
const ESTADOS_RESUELTOS = new Set(["pareado", "parcial", "gasto_directo", "no_contable"]);

export async function fetchMovimientosSinProveedorCount(): Promise<number> {
  const { fetchAllRows } = await import("@/lib/fetch-all");
  const movs = await fetchAllRows<any>(async (from, to) =>
    await supabase
      .from("transacciones")
      .select("id")
      .like("referencia", "BANK:%")
      .neq("standby", true)
      .is("tercero_id", null)
      .range(from, to),
  );
  if (!movs.length) return 0;
  const vinculos = await fetchAllRows<any>(async (from, to) =>
    await (supabase.from as any)("conciliacion_bancaria")
      .select("transaccion_bancaria_id, estado")
      .in("transaccion_bancaria_id", movs.map((m) => m.id))
      .range(from, to),
  );
  // "Resuelto" es por estado, no por origen: un vinculo "pareado"/"parcial"
  // (automatico o manual) ya tiene factura, y "gasto_directo"/"no_contable"
  // son decisiones finales marcadas a mano. "pendiente_revision" y
  // "sin_pareo" NO cuentan como resueltos aunque se hayan guardado como
  // origen "manual" -- son justo lo que todavia le falta confirmar a Iris,
  // y antes se escondian de esta lista por error.
  const yaConfirmados = new Set(
    vinculos
      .filter((v: any) => ESTADOS_RESUELTOS.has(v.estado))
      .map((v: any) => v.transaccion_bancaria_id),
  );
  return movs.filter((m) => !yaConfirmados.has(m.id)).length;
}
