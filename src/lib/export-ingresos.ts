import ExcelJS from "exceljs";
import { MESES } from "./account-helpers";
import { baseUsdFila, tipoIngresoFila, type RowIngresoRaw, type CuentaIngreso } from "./ingresos-detalle-calc";

// ExcelJS (versión instalada en este proyecto) todavía no tiene soporte
// estable para generar una Tabla Dinámica NATIVA de Excel: esa función solo
// existe como pre-release experimental desde hace ~2 años, con bugs
// conocidos (Excel pide "reparar" el archivo) y limitaciones serias (un solo
// campo de valores, sin filtros de página). No vale la pena depender de eso
// para un archivo contable real.
//
// En su lugar, este export da exactamente lo mismo en la práctica: una hoja
// "Datos" limpia y lista para pivotear (el usuario puede seleccionarla y
// hacer Insertar > Tabla dinámica en 2 clics si quiere jugar con los campos
// él mismo), más una hoja "Resumen por mes" ya armada con fórmulas SUMIFS
// (meses en columnas, por defecto) que se recalcula sola si se edita/agrega
// algo en Datos — así se puede "jugar" con los datos sin que se rompa nada.

const USD_FMT = '"$"#,##0.00;[Red]("$"#,##0.00);"—"';
const TASA_FMT = '#,##0.0000;[Red](#,##0.0000);"—"';

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

function styleTotal(row: ExcelJS.Row, big?: boolean) {
  row.font = { bold: true, size: big ? 12 : 11 };
  row.border = { top: { style: "thin" } };
  if (big) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
}

const DATOS_COLS = [
  "Fecha", "Año", "Mes", "Código", "Cuenta", "Centro de costo", "Tipo", "Modo",
  "Monto Bs", "Monto base Bs (sin IVA)", "Monto USD (registrado)",
  "Tasa BCV", "Tasa paralela", "Base USD · BCV", "Base USD · Paralelo",
  "Referencia", "Notas",
] as const;
// Letras de columna para las fórmulas del resumen (deben coincidir con el orden de arriba).
const COL = { mes: "C", tipo: "G", bcv: "N", paralelo: "O" };

export function exportIngresosDetalle(opts: { anio: number; rows: RowIngresoRaw[]; cuentas: CuentaIngreso[] }) {
  const { anio, rows, cuentas } = opts;
  const nombrePorCodigo = new Map(cuentas.map((c) => [c.codigo, c.nombre]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Yvbocu Contabilidad";
  wb.created = new Date();

  // ---------- Hoja 1: Datos ----------
  const wsDatos = wb.addWorksheet("Datos");
  wsDatos.mergeCells("A1:Q1");
  wsDatos.getCell("A1").value = `Ventas y ajustes de ingresos · ${anio} · base sin IVA`;
  wsDatos.getCell("A1").font = { bold: true, size: 14 };
  wsDatos.addRow([]);
  styleHeader(wsDatos.addRow([...DATOS_COLS]));

  const filas = [...rows].sort((a, b) => a.fecha.localeCompare(b.fecha));
  filas.forEach((r) => {
    const mes = Number(r.fecha.slice(5, 7));
    const row = wsDatos.addRow([
      r.fecha,
      Number(r.fecha.slice(0, 4)),
      mes,
      r.cuenta_codigo,
      nombrePorCodigo.get(r.cuenta_codigo) ?? r.cuenta_codigo,
      r.centro_costo ?? "",
      tipoIngresoFila(r),
      r.modo,
      Number(r.monto_bs) || 0,
      Number(r.monto_base_bs ?? r.monto_bs) || 0,
      Number(r.monto_usd) || 0,
      r.tasa_bcv ?? null,
      r.tasa_paralela ?? null,
      baseUsdFila(r, "bcv"),
      baseUsdFila(r, "paralela"),
      r.referencia ?? "",
      r.notas ?? "",
    ]);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    [9, 10, 11, 14, 15].forEach((c) => { row.getCell(c).numFmt = USD_FMT; });
    [12, 13].forEach((c) => { row.getCell(c).numFmt = TASA_FMT; });
  });

  wsDatos.columns = [
    { width: 12 }, { width: 8 }, { width: 6 }, { width: 10 }, { width: 32 }, { width: 14 },
    { width: 20 }, { width: 12 }, { width: 14 }, { width: 18 }, { width: 16 },
    { width: 12 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 40 },
  ];
  wsDatos.views = [{ state: "frozen", ySplit: 3 }];

  // ---------- Hoja 2: Resumen por mes ----------
  // Fórmulas SUMIFS sobre columnas completas de "Datos" — si se edita o se
  // agrega una fila ahí (un ajuste manual, una corrección), este resumen se
  // recalcula solo. Si en cambio se quiere una Tabla Dinámica de verdad
  // (arrastrar y soltar campos), basta seleccionar la hoja Datos en Excel y
  // usar Insertar > Tabla dinámica — con esta data ya limpia, Excel la
  // arma perfecto en 2 clics.
  const wsResumen = wb.addWorksheet("Resumen por mes");
  wsResumen.mergeCells("A1:N1");
  wsResumen.getCell("A1").value = `Resumen por mes · ${anio} · comparación BCV vs. paralelo`;
  wsResumen.getCell("A1").font = { bold: true, size: 14 };
  wsResumen.addRow([]);
  wsResumen.addRow([
    "Nota: estas celdas son fórmulas SUMIFS sobre la hoja Datos. Edita o agrega filas en Datos y este resumen se actualiza solo.",
  ]).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  wsResumen.addRow([]);

  const headers = ["Tipo", ...MESES, "Año"];
  const colLetra = (i: number) => String.fromCharCode("B".charCodeAt(0) + i); // B..M = meses, N = año

  const TIPOS: { label: string; filtro: string }[] = [
    { label: "Ventas comunes", filtro: "Ventas comunes" },
    { label: "Ajustes de venta lista", filtro: "Ajuste de venta lista" },
    { label: "Ingresos por IVA", filtro: "Ingresos por IVA" },
  ];

  const bloque = (titulo: string, colValor: string) => {
    const tituloRow = wsResumen.addRow([titulo]);
    tituloRow.font = { bold: true };
    tituloRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    styleHeader(wsResumen.addRow(headers));
    wsResumen.getColumn(1).width = 26;
    for (let i = 2; i <= 14; i++) wsResumen.getColumn(i).width = 12;

    const filaRows: number[] = [];
    TIPOS.forEach(({ label, filtro }) => {
      const r = wsResumen.addRow([
        label,
        ...MESES.map((_, i) => ({
          formula: `SUMIFS(Datos!$${colValor}:$${colValor},Datos!$${COL.tipo}:$${COL.tipo},"${filtro}",Datos!$${COL.mes}:$${COL.mes},${i + 1})`,
        })),
        null,
      ]);
      const rn = r.number;
      r.getCell(14).value = { formula: `SUM(B${rn}:M${rn})` };
      for (let i = 2; i <= 14; i++) r.getCell(i).numFmt = USD_FMT;
      filaRows.push(rn);
    });

    const totalRow = wsResumen.addRow([
      `Total ${titulo}`,
      ...MESES.map((_, i) => {
        const col = colLetra(i);
        return { formula: filaRows.map((rn) => `${col}${rn}`).join("+") };
      }),
      null,
    ]);
    totalRow.getCell(14).value = { formula: `SUM(B${totalRow.number}:M${totalRow.number})` };
    for (let i = 2; i <= 14; i++) totalRow.getCell(i).numFmt = USD_FMT;
    styleTotal(totalRow, true);
    wsResumen.addRow([]);
    return totalRow.number;
  };

  const totalBcvRow = bloque("USD BCV", COL.bcv);
  const totalParRow = bloque("USD Paralelo", COL.paralelo);

  const difRow = wsResumen.addRow([
    "Diferencia (Paralelo − BCV)",
    ...MESES.map((_, i) => {
      const col = colLetra(i);
      return { formula: `${col}${totalParRow}-${col}${totalBcvRow}` };
    }),
    { formula: `N${wsResumen.rowCount + 1}` },
  ]);
  difRow.getCell(14).value = { formula: `SUM(B${difRow.number}:M${difRow.number})` };
  for (let i = 2; i <= 14; i++) difRow.getCell(i).numFmt = USD_FMT;
  difRow.font = { italic: true };

  wb.xlsx.writeBuffer().then((buf) => download(buf, `Ingresos_y_ajustes_${anio}.xlsx`));
}
