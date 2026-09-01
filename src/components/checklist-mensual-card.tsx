import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import {
  TIPOS_IMPORTACION,
  fetchImportacionesActivas,
  fetchPeriodosCerrados,
  periodoActual,
  tipoImportadoEnPeriodo,
  type TipoImportacion,
} from "@/lib/home-checklist";
import { HistorialImportacionesDialog } from "@/components/historial-importaciones-dialog";
import { InventarioFinalQuickEntry } from "@/components/inventario-final-quick-entry";

type Paso = { label: string; ruta: string; hecho: boolean; nota?: string };

/**
 * Durante los primeros 10 días del mes mostramos el checklist del mes anterior,
 * porque ese es el periodo que se está terminando de cerrar en esos días.
 * A partir del día 11 se muestra el checklist del mes corriente.
 */
function periodoChecklistInicio(): string {
  const hoy = new Date();
  if (hoy.getDate() <= 10) {
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    return `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, "0")}`;
  }
  return periodoActual();
}

export function ChecklistMensualCard() {
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const periodo = periodoChecklistInicio();

  const { data } = useQuery({
    queryKey: ["home-checklist-mes", periodo],
    staleTime: 60_000,
    queryFn: async () => {
      const [imports, cerrados] = await Promise.all([fetchImportacionesActivas(), fetchPeriodosCerrados()]);
      return { imports, cerrados };
    },
  });

  const pasos: Paso[] = data
    ? [
        ...TIPOS_IMPORTACION.map((t) => ({
          label: t.label,
          ruta: t.ruta,
          hecho: tipoImportadoEnPeriodo(data.imports, t.tipo as TipoImportacion, periodo),
        })),
        {
          label: "Cerrar el mes (COGS e Inventario)",
          ruta: "/registrar?tab=cierre",
          hecho: data.cerrados.has(periodo),
          nota: "Acuérdate de anotar el inventario final antes de cerrar",
        },
      ]
    : [];

  const siguienteIdx = pasos.findIndex((p) => !p.hecho);
  const [rutaCierre, searchCierre] = ["/registrar", { tab: "cierre" }];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> Checklist del mes — {periodo}
            <span className="text-[11px] font-normal text-muted-foreground">(cobertura mínima: día 22)</span>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setHistorialAbierto(true)}>
            Ver historial completo
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {!data ? (
            <p className="text-sm text-muted-foreground py-2">Cargando…</p>
          ) : (
            pasos.map((p, i) => {
              const esSiguiente = i === siguienteIdx;
              const contenido = (
                <div
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    esSiguiente
                      ? "border border-primary/40 bg-primary/5 font-medium"
                      : p.hecho
                      ? "text-muted-foreground"
                      : ""
                  }`}
                >
                  {p.hecho ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <Circle className={`h-4 w-4 shrink-0 ${esSiguiente ? "text-primary" : "text-muted-foreground/40"}`} />
                  )}
                  <span className="w-5 text-muted-foreground/60">{i + 1}.</span>
                  <span className="flex-1">
                    {p.label}
                    {p.nota && !p.hecho && (
                      <span className="block text-[11px] font-normal text-muted-foreground/80">{p.nota}</span>
                    )}
                  </span>
                  {esSiguiente && (
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-primary px-2 py-0.5 rounded-full border border-primary/40">
                      Siguiente
                    </span>
                  )}
                </div>
              );
              return p.label.startsWith("Cerrar el mes") ? (
                <div key={p.label}>
                  <Link to={rutaCierre} search={searchCierre as any} className="block">
                    {contenido}
                  </Link>
                  {!p.hecho && <InventarioFinalQuickEntry />}
                </div>
              ) : (
                <Link key={p.label} to={p.ruta as any} className="block">
                  {contenido}
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
      <HistorialImportacionesDialog open={historialAbierto} onClose={() => setHistorialAbierto(false)} />
    </>
  );
}
