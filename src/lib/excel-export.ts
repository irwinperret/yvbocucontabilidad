import ExcelJS from "exceljs";
import { MESES } from "./account-helpers";

type Cuenta = { codigo: string; nombre: string; grupo: string };
type RowGyP = { mes: number; cuenta_codigo: string; base_usd: number };
type RowFC = { mes: number; cuenta_codigo: string; total_usd: number };

const USD_FMT = '"$"#,##0.00;[Red]("$"#,##0.00);"—"';
const PCT_FMT = "0.0%";

function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
}

function styleSection(cell: ExcelJS.Cell) {
  cell.font = { bold: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
}

function styleTotal(row: ExcelJS.Row, big?: boolean) {
  row.font = { bold: true, size: big ? 12 : 11 };
  row.border = { top: { style: "thin" } };
  if (big) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
}

// ============ G&P export ============
export function exportGyP(opts: {
  tab: "mes" | "ytd" | "comp";
  anio: number;
  mes?: number;
  hastaMes?: number;
  centro: string;
  incluirOff: boolean;
  rows: RowGyP[];
  cuentas: Cuenta[];
}) {
  const { tab, anio, mes, hastaMes, centro, incluirOff, rows, cuentas } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yvbocu Contabilidad";
  wb.created = new Date();

  if (tab === "comp") {
    buildGyPComparativo(wb, { anio, centro, incluirOff, rows, cuentas });
  } else {
    const filtro = tab === "mes" ? (r: RowGyP) => r.mes === mes : (r: RowGyP) => r.mes <= (hastaMes ?? 12);
    const label = tab === "mes" ? `Mes ${MESES[(mes ?? 1) - 1]}` : `YTD Ene-${MESES[(hastaMes ?? 1) - 1]}`;
    buildGyPSingle(wb, { titulo: `G&P · ${label} ${anio}`, centro, incluirOff, rows: rows.filter(filtro), cuentas });
  }

  wb.xlsx.writeBuffer().then((buf) => {
    const suffix = tab === "comp" ? "comparativo" : tab === "mes" ? `${MESES[(mes ?? 1) - 1]}` : `YTD-${MESES[(hastaMes ?? 1) - 1]}`;
    download(buf, `GyP_${anio}_${suffix}_${centro}.xlsx`);
  });
}

function buildGyPSingle(
  wb: ExcelJS.Workbook,
  { titulo, centro, incluirOff, rows, cuentas }: { titulo: string; centro: string; incluirOff: boolean; rows: RowGyP[]; cuentas: Cuenta[] }
) {
  const ws = wb.addWorksheet("G&P");
  ws.columns = [
    { header: "Código", width: 10 },
    { header: "Cuenta", width: 45 },
    { header: "Monto USD", width: 18 },
  ];

  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = titulo;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.addRow([`Centro: ${centro}`, "", incluirOff ? "Incluye off-balance" : "Solo on-balance"]);
  ws.addRow([]);
  styleHeader(ws.addRow(["Código", "Cuenta", "Monto USD"]));

  const sumAccount = (codigo: string) =>
    rows.filter((r) => r.cuenta_codigo === codigo).reduce((s, r) => s + Number(r.base_usd || 0), 0);

  const addSection = (titulo: string, predicate: (c: string) => boolean, negate: boolean): { totalCellRef: string } => {
    const sectionRow = ws.addRow([titulo, "", ""]);
    styleSection(sectionRow.getCell(1));
    styleSection(sectionRow.getCell(2));
    styleSection(sectionRow.getCell(3));

    const items = cuentas.filter((c) => predicate(c.codigo)).map((c) => ({ c, total: sumAccount(c.codigo) })).filter((x) => x.total !== 0);
    const firstRow = ws.rowCount + 1;
    items.forEach(({ c, total }) => {
      const r = ws.addRow([c.codigo, c.nombre, negate ? -total : total]);
      r.getCell(3).numFmt = USD_FMT;
    });
    const lastRow = ws.rowCount;
    const totalRow = ws.addRow(["", `TOTAL ${titulo.toUpperCase()}`, items.length ? { formula: `SUM(C${firstRow}:C${lastRow})` } : 0]);
    totalRow.getCell(3).numFmt = USD_FMT;
    styleTotal(totalRow);
    return { totalCellRef: `C${totalRow.number}` };
  };

  const ing = addSection("Ingresos", (c) => c.startsWith("1."), false);
  const cogs = addSection("COGS", (c) => c.startsWith("2."), true);

  // Margen bruto = ingresos + cogs (cogs ya está negativo)
  const mbRow = ws.addRow(["", "MARGEN BRUTO", { formula: `${ing.totalCellRef}+${cogs.totalCellRef}` }]);
  mbRow.getCell(3).numFmt = USD_FMT;
  styleTotal(mbRow, true);
  const mbRef = `C${mbRow.number}`;

  const mbPctRow = ws.addRow(["", "% Margen bruto", { formula: `IFERROR(${mbRef}/${ing.totalCellRef},0)` }]);
  mbPctRow.getCell(3).numFmt = PCT_FMT;

  const op = addSection("Gastos operativos", (c) => /^[3-9]\./.test(c), true);

  const utRow = ws.addRow(["", "UTILIDAD / PÉRDIDA NETA", { formula: `${mbRef}+${op.totalCellRef}` }]);
  utRow.getCell(3).numFmt = USD_FMT;
  styleTotal(utRow, true);
  const utRef = `C${utRow.number}`;

  const utPctRow = ws.addRow(["", "% Utilidad neta", { formula: `IFERROR(${utRef}/${ing.totalCellRef},0)` }]);
  utPctRow.getCell(3).numFmt = PCT_FMT;
}

function buildGyPComparativo(
  wb: ExcelJS.Workbook,
  { anio, centro, incluirOff, rows, cuentas }: { anio: number; centro: string; incluirOff: boolean; rows: RowGyP[]; cuentas: Cuenta[] }
) {
  const ws = wb.addWorksheet("G&P comparativo");
  const cuentasActivas = cuentas.filter((c) => rows.some((r) => r.cuenta_codigo === c.codigo));

  ws.mergeCells("A1:O1");
  ws.getCell("A1").value = `G&P comparativo mensual · ${anio} · ${centro} · ${incluirOff ? "incluye off-balance" : "on-balance"}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.addRow([]);

  const headers = ["Código", "Cuenta", ...MESES, "Año"];
  styleHeader(ws.addRow(headers));
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 40;
  for (let i = 3; i <= 15; i++) ws.getColumn(i).width = 12;

  const sumMes = (codigo: string, mes: number) =>
    rows.filter((r) => r.cuenta_codigo === codigo && r.mes === mes).reduce((s, r) => s + Number(r.base_usd || 0), 0);

  // Helper: insert account rows and remember row numbers per category
  const ingRows: number[] = [];
  const cogsRows: number[] = [];
  const opRows: number[] = [];

  cuentasActivas.forEach((c) => {
    const valores = MESES.map((_, i) => sumMes(c.codigo, i + 1));
    const r = ws.addRow([c.codigo, c.nombre, ...valores, null]);
    for (let i = 3; i <= 15; i++) r.getCell(i).numFmt = USD_FMT;
    // Año column = SUM(C:N)
    r.getCell(15).value = { formula: `SUM(C${r.number}:N${r.number})` };
    if (c.codigo.startsWith("1.")) ingRows.push(r.number);
    else if (c.codigo.startsWith("2.")) cogsRows.push(r.number);
    else opRows.push(r.number);
  });

  const totalRowFor = (label: string, accountRows: number[], color?: string) => {
    const r = ws.addRow([
      "",
      label,
      ...MESES.map((_, i) => {
        const col = String.fromCharCode("C".charCodeAt(0) + i);
        if (!accountRows.length) return 0;
        return { formula: accountRows.map((n) => `${col}${n}`).join("+") };
      }),
      { formula: `SUM(C${ws.rowCount + 1}:N${ws.rowCount + 1})` },
    ]);
    for (let i = 3; i <= 15; i++) r.getCell(i).numFmt = USD_FMT;
    styleTotal(r);
    if (color) r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    return r.number;
  };

  const ingTotal = totalRowFor("TOTAL INGRESOS", ingRows, "FFD1FAE5");
  const cogsTotal = totalRowFor("TOTAL COGS", cogsRows, "FFFEE2E2");

  // Margen bruto per month = ingresos - cogs
  const mbRow = ws.addRow([
    "",
    "MARGEN BRUTO",
    ...MESES.map((_, i) => {
      const col = String.fromCharCode("C".charCodeAt(0) + i);
      return { formula: `${col}${ingTotal}-${col}${cogsTotal}` };
    }),
    { formula: `SUM(C${ws.rowCount + 1}:N${ws.rowCount + 1})` },
  ]);
  for (let i = 3; i <= 15; i++) mbRow.getCell(i).numFmt = USD_FMT;
  styleTotal(mbRow, true);
  const mbRowN = mbRow.number;

  const opTotal = totalRowFor("TOTAL GASTOS OPERATIVOS", opRows, "FFFEE2E2");

  const utRow = ws.addRow([
    "",
    "UTILIDAD NETA",
    ...MESES.map((_, i) => {
      const col = String.fromCharCode("C".charCodeAt(0) + i);
      return { formula: `${col}${mbRowN}-${col}${opTotal}` };
    }),
    { formula: `SUM(C${ws.rowCount + 1}:N${ws.rowCount + 1})` },
  ]);
  for (let i = 3; i <= 15; i++) utRow.getCell(i).numFmt = USD_FMT;
  styleTotal(utRow, true);
}

// ============ FC export ============
export function exportFC(opts: {
  tab: "mes" | "ytd" | "comp";
  anio: number;
  mes?: number;
  hastaMes?: number;
  centro: string;
  incluirOff: boolean;
  rows: RowFC[];
  cuentas: Cuenta[];
}) {
  const { tab, anio, mes, hastaMes, centro, incluirOff, rows, cuentas } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yvbocu Contabilidad";
  wb.created = new Date();

  if (tab === "comp") {
    buildFCComparativo(wb, { anio, centro, incluirOff, rows, cuentas });
  } else {
    const filtro = tab === "mes" ? (r: RowFC) => r.mes === mes : (r: RowFC) => r.mes <= (hastaMes ?? 12);
    const label = tab === "mes" ? `Mes ${MESES[(mes ?? 1) - 1]}` : `YTD Ene-${MESES[(hastaMes ?? 1) - 1]}`;
    buildFCSingle(wb, { titulo: `Flujo de caja · ${label} ${anio}`, centro, incluirOff, rows: rows.filter(filtro), cuentas });
  }

  wb.xlsx.writeBuffer().then((buf) => {
    const suffix = tab === "comp" ? "comparativo" : tab === "mes" ? `${MESES[(mes ?? 1) - 1]}` : `YTD-${MESES[(hastaMes ?? 1) - 1]}`;
    download(buf, `FC_${anio}_${suffix}_${centro}.xlsx`);
  });
}

function buildFCSingle(
  wb: ExcelJS.Workbook,
  { titulo, centro, incluirOff, rows, cuentas }: { titulo: string; centro: string; incluirOff: boolean; rows: RowFC[]; cuentas: Cuenta[] }
) {
  const ws = wb.addWorksheet("Flujo de caja");
  ws.columns = [
    { header: "Código", width: 10 },
    { header: "Cuenta", width: 45 },
    { header: "Monto USD", width: 18 },
  ];

  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = titulo;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.addRow([`Centro: ${centro}`, "", incluirOff ? "Incluye off-balance" : "Solo on-balance"]);
  ws.addRow([]);
  styleHeader(ws.addRow(["Código", "Cuenta", "Monto USD"]));

  const sumAccount = (codigo: string) =>
    rows.filter((r) => r.cuenta_codigo === codigo).reduce((s, r) => s + Number(r.total_usd || 0), 0);

  const addSection = (titulo: string, predicate: (c: string) => boolean, negate: boolean): string => {
    const sectionRow = ws.addRow([titulo, "", ""]);
    styleSection(sectionRow.getCell(1));
    styleSection(sectionRow.getCell(2));
    styleSection(sectionRow.getCell(3));

    const items = cuentas.filter((c) => predicate(c.codigo)).map((c) => ({ c, total: sumAccount(c.codigo) })).filter((x) => x.total !== 0);
    const firstRow = ws.rowCount + 1;
    items.forEach(({ c, total }) => {
      const r = ws.addRow([c.codigo, c.nombre, negate ? -total : total]);
      r.getCell(3).numFmt = USD_FMT;
    });
    const lastRow = ws.rowCount;
    const totalRow = ws.addRow(["", `TOTAL ${titulo.toUpperCase()}`, items.length ? { formula: `SUM(C${firstRow}:C${lastRow})` } : 0]);
    totalRow.getCell(3).numFmt = USD_FMT;
    styleTotal(totalRow);
    return `C${totalRow.number}`;
  };

  const entOp = addSection("Operativas — Entradas", (c) => c.startsWith("1."), false);
  const salOp = addSection("Operativas — Salidas", (c) => /^[2-9]\./.test(c), true);

  const flujoOp = ws.addRow(["", "FLUJO OPERATIVO NETO", { formula: `${entOp}+${salOp}` }]);
  flujoOp.getCell(3).numFmt = USD_FMT;
  styleTotal(flujoOp, true);
  const flujoOpRef = `C${flujoOp.number}`;

  const entFin = addSection("Financiamiento — Entradas", (c) => ["10.1", "10.5"].includes(c), false);
  const salFin = addSection("Financiamiento — Salidas", (c) => ["10.2", "10.4", "10.6"].includes(c), true);

  const flujoFin = ws.addRow(["", "FLUJO FINANCIAMIENTO NETO", { formula: `${entFin}+${salFin}` }]);
  flujoFin.getCell(3).numFmt = USD_FMT;
  styleTotal(flujoFin, true);
  const flujoFinRef = `C${flujoFin.number}`;

  const neto = ws.addRow(["", "VARIACIÓN NETA DE CAJA", { formula: `${flujoOpRef}+${flujoFinRef}` }]);
  neto.getCell(3).numFmt = USD_FMT;
  styleTotal(neto, true);
}

function buildFCComparativo(
  wb: ExcelJS.Workbook,
  { anio, centro, incluirOff, rows, cuentas }: { anio: number; centro: string; incluirOff: boolean; rows: RowFC[]; cuentas: Cuenta[] }
) {
  const ws = wb.addWorksheet("FC comparativo");
  const cuentasActivas = cuentas.filter((c) => rows.some((r) => r.cuenta_codigo === c.codigo));

  ws.mergeCells("A1:O1");
  ws.getCell("A1").value = `Flujo de caja comparativo · ${anio} · ${centro} · ${incluirOff ? "incluye off-balance" : "on-balance"}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.addRow([]);

  styleHeader(ws.addRow(["Código", "Cuenta", ...MESES, "Total"]));
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 40;
  for (let i = 3; i <= 15; i++) ws.getColumn(i).width = 12;

  const sumMes = (codigo: string, mes: number) =>
    rows.filter((r) => r.cuenta_codigo === codigo && r.mes === mes).reduce((s, r) => s + Number(r.total_usd || 0), 0);

  const entRows: number[] = [];
  const salRows: number[] = [];

  cuentasActivas.forEach((c) => {
    const valores = MESES.map((_, i) => sumMes(c.codigo, i + 1));
    const r = ws.addRow([c.codigo, c.nombre, ...valores, null]);
    for (let i = 3; i <= 15; i++) r.getCell(i).numFmt = USD_FMT;
    r.getCell(15).value = { formula: `SUM(C${r.number}:N${r.number})` };
    if (c.codigo.startsWith("1.") || ["10.1", "10.5"].includes(c.codigo)) entRows.push(r.number);
    else salRows.push(r.number);
  });

  const totalRowFor = (label: string, accountRows: number[], color: string) => {
    const r = ws.addRow([
      "",
      label,
      ...MESES.map((_, i) => {
        const col = String.fromCharCode("C".charCodeAt(0) + i);
        if (!accountRows.length) return 0;
        return { formula: accountRows.map((n) => `${col}${n}`).join("+") };
      }),
      { formula: `SUM(C${ws.rowCount + 1}:N${ws.rowCount + 1})` },
    ]);
    for (let i = 3; i <= 15; i++) r.getCell(i).numFmt = USD_FMT;
    styleTotal(r);
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    return r.number;
  };

  const entN = totalRowFor("TOTAL ENTRADAS", entRows, "FFD1FAE5");
  const salN = totalRowFor("TOTAL SALIDAS", salRows, "FFFEE2E2");

  const neto = ws.addRow([
    "",
    "VARIACIÓN NETA DE CAJA",
    ...MESES.map((_, i) => {
      const col = String.fromCharCode("C".charCodeAt(0) + i);
      return { formula: `${col}${entN}-${col}${salN}` };
    }),
    { formula: `SUM(C${ws.rowCount + 1}:N${ws.rowCount + 1})` },
  ]);
  for (let i = 3; i <= 15; i++) neto.getCell(i).numFmt = USD_FMT;
  styleTotal(neto, true);
}
