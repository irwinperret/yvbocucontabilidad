// Shared helpers for parsing Xetux .xls / .xlsx reports.
import * as XLSX from "xlsx";

/** Convert a cell to number. Accepts numbers, "$31.74", "1.234,56", "(12.50)", etc. */
export function numFromCell(v: any): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()$\s]/g, "").replace(/^-/, "");
  // If it has both '.' and ',', assume '.' is thousands and ',' is decimal (es-VE).
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",") && !s.includes(".")) {
    // Lone comma → decimal separator
    s = s.replace(",", ".");
  }
  // Strip any other non-numeric leftovers except dot and digits
  s = s.replace(/[^0-9.]/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

const MESES_ES: Record<string, string> = {
  ene: "01", enero: "01", feb: "02", febrero: "02", mar: "03", marzo: "03",
  abr: "04", abril: "04", may: "05", mayo: "05", jun: "06", junio: "06",
  jul: "07", julio: "07", ago: "08", agosto: "08", sep: "09", sept: "09",
  septiembre: "09", set: "09", oct: "10", octubre: "10", nov: "11",
  noviembre: "11", dic: "12", diciembre: "12",
};

/** Parse common date formats from Xetux: Date objects, "18-may-2026 0:00:00", "2026-05-18", etc. */
export function parseDateCell(v: any): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\-\/\s]+([A-Za-zÁÉÍÓÚáéíóú\.]+)[\-\/\s]+(\d{2,4})/);
  if (m) {
    const dia = m[1].padStart(2, "0");
    const mesRaw = m[2].toLowerCase().replace(/\./g, "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const mes = MESES_ES[mesRaw];
    let anio = m[3];
    if (anio.length === 2) anio = "20" + anio;
    if (mes) return `${anio}-${mes}-${dia}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Read xls or xlsx file → 2D array of cell values (raw). First sheet only. */
export async function readSheetAOA(file: File): Promise<any[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: "" });
}
