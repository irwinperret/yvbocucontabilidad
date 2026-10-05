export const fmtBs = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + " Bs";

export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : "$ " + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

const MESES_ABR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/**
 * Formato único de fecha para toda la app: dd/mmm/yyyy (ej. "13/Sep/2026").
 *
 * Antes había dos formatos distintos conviviendo -- fmtDate en dd/mm/yyyy
 * numérico para casi toda la app, y fmtDateMDY en mmm/dd/yyyy solo para
 * Transacciones y Movimientos bancarios -- lo que se veía inconsistente al
 * navegar entre pantallas. Ahora ambas funciones producen el mismo formato
 * (fmtDateMDY se deja como alias de fmtDate para no tener que tocar cada
 * import existente en el resto del código).
 *
 * Si `d` es un string sin hora ("YYYY-MM-DD"), se le agrega "T00:00:00"
 * SIN sufijo de zona horaria antes de pasarlo a Date() -- asi el navegador
 * lo interpreta como medianoche LOCAL en vez de UTC, evitando que el dia 1
 * de cada mes se corra al mes anterior en husos horarios detras de UTC
 * (como Venezuela).
 */
export const fmtDate = (d: string | Date) => {
  const dt = typeof d === "string" ? new Date(d.includes("T") ? d : `${d}T00:00:00`) : d;
  if (isNaN(dt.getTime())) return "—";
  const dia = String(dt.getDate()).padStart(2, "0");
  const mes = MESES_ABR[dt.getMonth()];
  return `${dia}/${mes}/${dt.getFullYear()}`;
};

/** Alias de fmtDate -- ver comentario arriba. Se mantiene el nombre para no
 * tener que actualizar los imports existentes en Transacciones y
 * Movimientos bancarios. */
export const fmtDateMDY = fmtDate;

/**
 * Convierte un string de fecha ("YYYY-MM-DD", con o sin hora) a un objeto
 * Date en medianoche LOCAL (mismo truco que fmtDate) -- para que los
 * exportadores de Excel escriban una celda de fecha REAL (serial numérico +
 * numFmt) en vez de texto. Devuelve null si no hay fecha o no es válida,
 * para que el llamador decida qué poner en la celda (ej. dejarla en blanco).
 */
export function parseFechaLocal(d: string | Date | null | undefined): Date | null {
  if (d == null || d === "") return null;
  const dt = typeof d === "string" ? new Date(d.includes("T") ? d : `${d}T00:00:00`) : d;
  return isNaN(dt.getTime()) ? null : dt;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const currentPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM
