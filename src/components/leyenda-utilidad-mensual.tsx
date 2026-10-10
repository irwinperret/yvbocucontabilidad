import { Fragment } from "react";

export type ItemLeyendaUtilidadMensual = { key: string; label: string; color: string; linea?: boolean };

/**
 * Leyenda propia (no la de Recharts) para el gráfico de "Utilidad mensual
 * por categorías": agrupa Ingresos + Utilidad neta en una columna y los
 * egresos en otra, en vez de dejar que Recharts las mezcle en una sola fila
 * que hace wrap según el ancho disponible. Se usa igual en pantalla
 * (resumen-ejecutivo-mensual.tsx) y en el PDF (reporte-mensual-imprimir.tsx)
 * para que ambos se vean idénticos.
 *
 * Los nombres acá son cortos a propósito -- el nombre completo de cada
 * serie (ej. "Ingresos off-balance (ajuste)") sigue disponible en el
 * tooltip al pasar el mouse sobre el gráfico; esta leyenda no necesita
 * repetirlo.
 */
export function LeyendaUtilidadMensual({
  ingresos,
  egresos,
  textClassName = "text-xs text-muted-foreground",
  swatchSize = "h-2.5 w-2.5",
  gapClassName = "gap-6",
}: {
  ingresos: ItemLeyendaUtilidadMensual[];
  egresos: ItemLeyendaUtilidadMensual[];
  textClassName?: string;
  swatchSize?: string;
  gapClassName?: string;
}) {
  const Item = ({ it }: { it: ItemLeyendaUtilidadMensual }) => (
    <div className="flex items-center gap-1.5">
      {it.linea ? (
        <span className="inline-block w-3 border-t-2" style={{ borderColor: it.color }} />
      ) : (
        <span className={`inline-block rounded-sm ${swatchSize}`} style={{ backgroundColor: it.color }} />
      )}
      <span className={textClassName}>{it.label}</span>
    </div>
  );
  return (
    <div className={`flex ${gapClassName} justify-center flex-wrap`}>
      <div className="flex flex-col gap-1">
        {ingresos.map((it) => (
          <Fragment key={it.key}><Item it={it} /></Fragment>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {egresos.map((it) => (
          <Fragment key={it.key}><Item it={it} /></Fragment>
        ))}
      </div>
    </div>
  );
}

const LABEL_CORTO: Record<string, string> = {
  "Costos Variables (operativos)": "Costos Variables",
};

/** Construye los dos grupos (ingresos/egresos) de la leyenda a partir de los
 * mismos datos que ya se usan para dibujar las barras del gráfico. */
export function construirLeyendaUtilidadMensual(
  categoriasConDatos: readonly string[],
  serie: any[],
  colorIngresos: { convencional: string; offBalance: string; iva: string },
  colorCat: Record<string, string>,
) {
  const hayIngresos = categoriasConDatos.includes("Ingresos");
  const hayOffBalance = hayIngresos && serie.some((s) => Math.abs(s.ingresosOffBalance) > 0.009);
  const hayIva = hayIngresos && serie.some((s) => Math.abs(s.ingresosIva) > 0.009);

  const ingresos: ItemLeyendaUtilidadMensual[] = [];
  if (hayIngresos) {
    ingresos.push({ key: "ingresosConvencional", label: "Ingresos", color: colorIngresos.convencional });
    if (hayOffBalance) ingresos.push({ key: "ingresosOffBalance", label: "Ingresos off-balance", color: colorIngresos.offBalance });
    if (hayIva) ingresos.push({ key: "ingresosIva", label: "Ingresos IVA", color: colorIngresos.iva });
  }
  ingresos.push({ key: "utilidad", label: "Utilidad neta", color: "#111827", linea: true });

  const egresos: ItemLeyendaUtilidadMensual[] = categoriasConDatos
    .filter((c) => c !== "Ingresos")
    .map((c) => ({ key: c, label: LABEL_CORTO[c] ?? c, color: colorCat[c] }));

  return { ingresos, egresos };
}
