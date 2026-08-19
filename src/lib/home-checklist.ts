import { supabase } from "@/integrations/supabase/client";

/** Tipos de importación que existen hoy en la tabla `importaciones`. */
export type TipoImportacion = "ventas" | "compras" | "movimientos" | "ajustes";

export const TIPOS_IMPORTACION: { tipo: TipoImportacion; label: string; ruta: string }[] = [
  { tipo: "ventas", label: "Importar ventas Xetux", ruta: "/importar-ventas" },
  { tipo: "compras", label: "Importar compras Xetux", ruta: "/importar-compras" },
  { tipo: "movimientos", label: "Importar movimientos bancarios", ruta: "/importar-movimientos" },
  { tipo: "ajustes", label: "Importar ajustes", ruta: "/importar-ajustes" },
];

export type ImportacionRow = {
  tipo: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  created_at: string;
};

/** Periodo actual en formato YYYY-MM. */
export function periodoActual(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

/** Primer y último día (YYYY-MM-DD) de un periodo YYYY-MM. */
export function rangoDePeriodo(periodo: string): { primero: string; ultimo: string } {
  const [y, m] = periodo.split("-").map(Number);
  const primero = `${periodo}-01`;
  const ultimo = new Date(y, m, 0).toISOString().slice(0, 10);
  return { primero, ultimo };
}

/** ¿Este tipo de reporte se importó (import no revertido) para este periodo? */
export function tipoImportadoEnPeriodo(imports: ImportacionRow[], tipo: TipoImportacion, periodo: string): boolean {
  const { primero, ultimo } = rangoDePeriodo(periodo);
  return imports.some(
    (imp) =>
      imp.tipo === tipo &&
      imp.fecha_desde != null &&
      imp.fecha_hasta != null &&
      imp.fecha_desde <= ultimo &&
      imp.fecha_hasta >= primero,
  );
}

/** Trae todas las importaciones no revertidas (para el checklist y el historial). */
export async function fetchImportacionesActivas(): Promise<ImportacionRow[]> {
  const { data } = await (supabase.from as any)("importaciones")
    .select("tipo, fecha_desde, fecha_hasta, created_at")
    .is("reverted_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as ImportacionRow[];
}

/** Trae todos los periodos ya cerrados (cierres_de_mes). */
export async function fetchPeriodosCerrados(): Promise<Set<string>> {
  const { data } = await supabase.from("cierres_de_mes").select("periodo");
  return new Set((data ?? []).map((r: any) => r.periodo as string));
}

/**
 * Construye la lista de periodos a mostrar en el historial: la unión de
 * todos los meses tocados por alguna importación o cierre, más reciente
 * primero, limitado a los últimos 24 para no crecer sin límite.
 */
export function periodosParaHistorial(imports: ImportacionRow[], cerrados: Set<string>): string[] {
  const set = new Set<string>();
  for (const p of cerrados) set.add(p);
  for (const imp of imports) {
    if (!imp.fecha_desde || !imp.fecha_hasta) continue;
    let [y, m] = imp.fecha_desde.split("-").map(Number);
    const [yEnd, mEnd] = imp.fecha_hasta.split("-").map(Number);
    while (y < yEnd || (y === yEnd && m <= mEnd)) {
      set.add(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  return [...set].sort().reverse().slice(0, 24);
}
