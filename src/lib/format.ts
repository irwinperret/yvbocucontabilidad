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

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const currentPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM
