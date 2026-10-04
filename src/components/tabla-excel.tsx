import { useEffect, useMemo, useState } from "react";
import { fmtUsd } from "@/lib/format";

/** Tabla "tipo Excel": selección por clic-y-arrastre + suma/promedio en una
 * barra inferior. Mismo patrón que la tabla "Comparativo mensual" de
 * Ganancias y Pérdidas (gyp.tsx) — compartido entre Ingresos en Detalle y
 * Egresos en Detalle. */
export type FilaExcel = { label: string; valores: number[]; extra?: string[]; bold?: boolean };

export function TablaExcel({ columnas, filas, extraCols }: { columnas: string[]; filas: FilaExcel[]; extraCols?: string[] }) {
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ r: number; c: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ r: number; c: number } | null>(null);

  const enRango = (r: number, c: number) => {
    if (!selStart || !selEnd) return false;
    const r0 = Math.min(selStart.r, selEnd.r), r1 = Math.max(selStart.r, selEnd.r);
    const c0 = Math.min(selStart.c, selEnd.c), c1 = Math.max(selStart.c, selEnd.c);
    return r >= r0 && r <= r1 && c >= c0 && c <= c1;
  };
  const startSel = (r: number, c: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setSelecting(true);
    setSelStart({ r, c });
    setSelEnd({ r, c });
  };
  const overSel = (r: number, c: number) => () => { if (selecting) setSelEnd({ r, c }); };

  useEffect(() => {
    const stop = () => setSelecting(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const seleccion = useMemo(() => {
    if (!selStart || !selEnd) return { suma: 0, count: 0 };
    let suma = 0, count = 0;
    filas.forEach((f, r) => f.valores.forEach((v, c) => { if (enRango(r, c)) { suma += v; count++; } }));
    return { suma, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStart, selEnd, filas]);

  return (
    <div className="select-none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-2 sticky left-0 bg-background z-10 text-xs uppercase text-muted-foreground whitespace-nowrap">Tipo</th>
              {columnas.map((c) => (
                <th key={c} className="text-right py-2 px-2 text-xs uppercase text-muted-foreground whitespace-nowrap">{c}</th>
              ))}
              {(extraCols ?? []).map((c) => (
                <th key={c} className="text-right py-2 px-2 text-xs uppercase text-muted-foreground whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, r) => (
              <tr key={f.label} className={f.bold ? "border-t-2" : "border-b last:border-0"}>
                <td className={`py-1.5 px-2 sticky left-0 bg-background z-10 whitespace-nowrap ${f.bold ? "font-bold" : ""}`}>{f.label}</td>
                {f.valores.map((v, c) => (
                  <td
                    key={c}
                    onMouseDown={startSel(r, c)}
                    onMouseEnter={overSel(r, c)}
                    className={`py-1.5 px-2 text-right mono cursor-cell ${f.bold ? "font-bold text-green-600" : ""} ${enRango(r, c) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                  >
                    {fmtUsd(v)}
                  </td>
                ))}
                {(f.extra ?? []).map((txt, i) => (
                  <td key={i} className="py-1.5 px-2 text-right text-xs text-muted-foreground whitespace-nowrap">{txt}</td>
                ))}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr><td className="py-3 px-2 text-muted-foreground" colSpan={columnas.length + (extraCols?.length ?? 0) + 1}>Sin movimientos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {seleccion.count > 0 && (
        <div className="sticky bottom-0 z-20 flex justify-end">
          <div className="bg-foreground text-background text-xs rounded-md shadow-lg px-4 py-2 mt-2 flex items-center gap-4 mono">
            <span>Celdas: <b>{seleccion.count}</b></span>
            <span>Promedio: <b>{fmtUsd(seleccion.suma / seleccion.count)}</b></span>
            <span>Suma: <b>{fmtUsd(seleccion.suma)}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
