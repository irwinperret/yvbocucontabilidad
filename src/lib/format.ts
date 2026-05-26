export const fmtBs = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + " Bs";

export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : "$ " + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

export const fmtDate = (d: string | Date) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-VE", { year: "numeric", month: "2-digit", day: "2-digit" });
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const currentPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM
