import ExcelJS from "exceljs";

export type TasaExportRow = {
  fecha: string;
  tasa: number | null;
  tasaParalela?: number | null;
  bcv?: number | null;
  diferencial?: number | null;
  estado?: string;
};

const USD_FMT = '"Bs"#,##0.0000;[Red]("Bs"#,##0.0000);"—"';

function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportTasasToExcel(opts: {
  titulo: string;
  filename: string;
  rows: TasaExportRow[];
  incluyeParalela?: boolean;
}) {
  const { titulo, filename, rows, incluyeParalela } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yvbocu Contabilidad";
  wb.created = new Date();
  const ws = wb.addWorksheet("Tasas");

  const headers = ["Fecha", "Tasa BCV (Bs/USD)"];
  if (incluyeParalela) {
    headers.push("Tasa paralela (Bs/USD)", "Diferencial", "Diferencial %");
  }

  ws.mergeCells("A1:" + String.fromCharCode(64 + headers.length) + "1");
  ws.getCell("A1").value = titulo;
  ws.getCell("A1").font = { bold: true, size: 14 };

  ws.addRow([]);

  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };

  rows.forEach((r) => {
    const cells: (string | number | null)[] = [r.fecha, r.tasa];
    if (incluyeParalela) {
      cells.push(r.tasaParalela ?? null, r.diferencial ?? null, r.diferencial != null && r.bcv ? (r.diferencial / r.bcv) : null);
    }
    const row = ws.addRow(cells);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    for (let i = 2; i <= cells.length; i++) {
      row.getCell(i).numFmt = USD_FMT;
    }
    if (incluyeParalela) {
      row.getCell(5).numFmt = "0.0%";
    }
  });

  ws.columns = headers.map((h) => ({ width: 20 }));

  wb.xlsx.writeBuffer().then((buf) => download(buf, filename));
}
