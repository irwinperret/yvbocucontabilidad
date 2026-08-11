import ExcelJS from "exceljs";

export type ExcelCol = {
  header: string;
  key: string;
  width?: number;
  /** "bs" | "usd" | "rate" | "text" */
  fmt?: "bs" | "usd" | "rate" | "text";
};

const NUM_FMT: Record<string, string> = {
  bs: "#,##0.00",
  usd: '"$"#,##0.00',
  rate: "#,##0.0000",
};

/**
 * Exporta una tabla simple a Excel con el mismo estilo que usa la pantalla de
 * Transacciones (encabezado oscuro en negrita, anchos de columna, formatos numéricos).
 */
export async function exportTableToExcel(opts: {
  filename: string;
  sheetName: string;
  columns: ExcelCol[];
  rows: Record<string, any>[];
}) {
  const { filename, sheetName, columns, rows } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yvbocu Contabilidad";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };

  for (const row of rows) {
    const r = ws.addRow(row);
    for (const c of columns) {
      if (!c.fmt || c.fmt === "text") continue;
      const cell = r.getCell(c.key as any);
      if (typeof cell.value === "number") cell.numFmt = NUM_FMT[c.fmt];
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
