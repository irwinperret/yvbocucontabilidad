import { useEffect, useMemo, useState } from "react";

export type ExcelCell = { r: number; c: number };

export function useExcelCellSelection(values: number[][]) {
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<ExcelCell | null>(null);
  const [selEnd, setSelEnd] = useState<ExcelCell | null>(null);

  const isSelected = (r: number, c: number) => {
    if (!selStart || !selEnd) return false;
    const r0 = Math.min(selStart.r, selEnd.r), r1 = Math.max(selStart.r, selEnd.r);
    const c0 = Math.min(selStart.c, selEnd.c), c1 = Math.max(selStart.c, selEnd.c);
    return r >= r0 && r <= r1 && c >= c0 && c <= c1;
  };

  const startSelection = (r: number, c: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setSelecting(true);
    setSelStart({ r, c });
    setSelEnd({ r, c });
  };

  const overSelection = (r: number, c: number) => () => {
    if (selecting) setSelEnd({ r, c });
  };

  useEffect(() => {
    const stop = () => setSelecting(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const selection = useMemo(() => {
    if (!selStart || !selEnd) return { suma: 0, count: 0, average: 0 };
    let suma = 0, count = 0;
    values.forEach((row, r) => row.forEach((v, c) => {
      if (isSelected(r, c)) {
        suma += Number(v) || 0;
        count++;
      }
    }));
    return { suma, count, average: count ? suma / count : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStart, selEnd, values]);

  // Rango de columnas de la selección actual (null si no hay selección) --
  // sirve para que quien use el hook sepa si la selección cae entera dentro
  // de UNA sola columna (por ejemplo, para decidir si formatear la suma
  // como "%" o como "$" cuando distintas columnas representan unidades
  // distintas, como en G&P: columna 0 = USD, columna 1 = %).
  const colRange = selStart && selEnd
    ? { c0: Math.min(selStart.c, selEnd.c), c1: Math.max(selStart.c, selEnd.c) }
    : null;

  return { isSelected, startSelection, overSelection, selection, colRange };
}
