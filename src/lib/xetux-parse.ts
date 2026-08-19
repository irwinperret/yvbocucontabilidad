// Shared helpers for parsing Xetux .xls / .xlsx reports.
import * as XLSX from "xlsx";

/** Convert a cell to number. Accepts numbers, "$31.74", "1.234,56" (es-VE),
 * "1,234.56" (en-US), "(12.50)", etc. Xetux mixes both formats depending on
 * the column and how large the amount is, so instead of assuming one fixed
 * locale, whichever separator (. or ,) appears LAST in the string is treated
 * as the true decimal point, and the other (if present) as a thousands
 * separator. This avoids a bug where "1,047.11" was misread as 1.04711
 * (1000x too small) because the old code always assumed '.' meant thousands. */
export function numFromCell(v: any): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()$\s]/g, "").replace(/^-/, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      // Comma comes last → comma is decimal, dots are thousands (es-VE: "1.234,56")
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Dot comes last → dot is decimal, commas are thousands (en-US: "1,234.56")
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",") && !s.includes(".")) {
    // Lone comma → decimal separator (e.g. "37,95")
    s = s.replace(",", ".");
  } else if (s.includes(".") && !s.includes(",")) {
    // Lone dot(s): only treat as thousands separators if it matches a pure
    // grouping pattern (groups of exactly 3 digits, e.g. "1.234" or
    // "12.345.678"). Otherwise a single dot with 1-2 digits after it is a
    // normal decimal point (e.g. "37.95").
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, "");
    }
  }
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

/**
 * Read xls/xlsx → 2D array, picking the sheet (and header row) that best matches
 * the required column keywords. Falls back to the first sheet.
 * The returned array starts at the detected header row.
 */
export async function readSheetAOASmart(
  file: File,
  required: string[][],
): Promise<any[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const matches = (row: any[]) => {
    const cells = row.map((c) => String(c ?? "").toLowerCase().trim());
    return required.every((alts) =>
      alts.some((a) => cells.some((c) => c.includes(a.toLowerCase()))),
    );
  };
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: "" });
    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
      if (matches(aoa[i] ?? [])) return aoa.slice(i);
    }
  }
  const ws0 = wb.Sheets[wb.SheetNames[0]];
  if (!ws0) return [];
  return XLSX.utils.sheet_to_json<any[]>(ws0, { header: 1, raw: true, defval: "" });
}
