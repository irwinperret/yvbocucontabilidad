export const fmtBs = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + " Bs";

export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : "$ " + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

export const fmtDate = (d: string | Date) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-VE", { year: "numeric", month: "2-digit", day: "2-digit" });
};

const MESES_ABR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/**
 * Formato mmm/dd/yyyy (Ene/Feb/.../Dic) -- usado en Transacciones y
 * Movimientos bancarios (tabla principal y ventana de edicion), a pedido
 * explicito del usuario para esas dos pantallas. El resto de la app sigue
 * usando fmtDate (dd/mm/yyyy).
 *
 * Si `d` es un string sin hora ("YYYY-MM-DD"), se le agrega "T00:00:00"
 * SIN sufijo de zona horaria antes de pasarlo a Date() -- asi el navegador
 * lo interpreta como medianoche LOCAL en vez de UTC, evitando que el dia 1
 * de cada mes se corra al mes anterior en husos horarios detras de UTC
 * (como Venezuela).
 */
export const fmtDateMDY = (d: string | Date) => {
  const dt = typeof d === "string" ? new Date(d.includes("T") ? d : `${d}T00:00:00`) : d;
  if (isNaN(dt.getTime())) return "—";
  const mes = MESES_ABR[dt.getMonth()];
  const dia = String(dt.getDate()).padStart(2, "0");
  return `${mes}/${dia}/${dt.getFullYear()}`;
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const currentPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM
