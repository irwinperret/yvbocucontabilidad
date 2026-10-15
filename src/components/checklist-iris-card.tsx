// Checklist de Iris: un recorte de ChecklistMensualCard (en Inicio) a los 5
// pasos que son trabajo de ella, más un 6to paso (confirmar movimientos
// bancarios sin proveedor) que no es sí/no sino un contador que va bajando.
// Se marca solo a medida que cada cosa se carga en el sistema -- misma
// lógica de datos que el checklist de Inicio, solo que recortada y fijada
// siempre al mes pasado (ver mesPasado() en @/lib/iris-checklist).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ListChecks } from "lucide-react";
import {
  fetchImportacionesActivas,
  fetchInventarioFinalPeriodos,
  fetchVentaIvaPeriodos,
  fetchRetencionIslrPeriodos,
  tipoImportadoEnPeriodo,
} from "@/lib/home-checklist";
import { mesPasado, nombreMesPeriodo, sumarMeses, fetchMovimientosSinProveedorCount } from "@/lib/iris-checklist";

type Paso = { label: string; ruta: string; hecho: boolean };

export function ChecklistIrisCard() {
  // Por defecto el mes pasado (lo que Iris tiene que cerrar), pero se puede
  // navegar a otros meses para revisar el historial sin perder ese default.
  const [periodo, setPeriodo] = useState(mesPasado());
  const esMesPorDefecto = periodo === mesPasado();
  const puedeAvanzar = periodo < mesPasado();

  const { data } = useQuery({
    queryKey: ["iris-checklist-mes", periodo],
    staleTime: 60_000,
    queryFn: async () => {
      const [imports, inventarios, ventaIva, retencionIslr] = await Promise.all([
        fetchImportacionesActivas(),
        fetchInventarioFinalPeriodos(),
        fetchVentaIvaPeriodos(),
        fetchRetencionIslrPeriodos(),
      ]);
      return { imports, inventarios, ventaIva, retencionIslr };
    },
  });

  // Misma query key que usa IrisPage para su tarjeta "Movimientos bancarios
  // sin proveedor" -- comparten resultado, no se pide dos veces.
  const { data: sinProveedorCount } = useQuery({
    queryKey: ["iris-sin-proveedor-count"],
    queryFn: fetchMovimientosSinProveedorCount,
  });

  const pasos: Paso[] = data
    ? [
        {
          label: "Movimientos bancarios",
          ruta: "/importar-movimientos",
          hecho: tipoImportadoEnPeriodo(data.imports, "movimientos", periodo),
        },
        {
          label: "Ajustes de venta",
          ruta: "/importar-ajustes",
          hecho: tipoImportadoEnPeriodo(data.imports, "ajustes", periodo),
        },
        { label: "Inventario final", ruta: "/inventarios", hecho: data.inventarios.has(periodo) },
        { label: "Venta de IVA", ruta: "/venta-iva", hecho: data.ventaIva.has(periodo) },
        { label: "Retención de ISLR", ruta: "/retencion-islr", hecho: data.retencionIslr.has(periodo) },
      ]
    : [];

  const siguienteIdx = pasos.findIndex((p) => !p.hecho);
  const paso6Cargado = sinProveedorCount !== undefined;
  const paso6Hecho = sinProveedorCount === 0;
  const completados = pasos.filter((p) => p.hecho).length + (paso6Hecho ? 1 : 0);
  const total = pasos.length + 1;

  return (
    <Card className="border-[#534AB7]/30 bg-[#534AB7]/[0.04] shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-[#534AB7] flex items-center gap-2 m-0">
              <ListChecks className="h-4 w-4" /> Pendientes de Iris
            </p>
            <div className="flex items-center gap-0.5 mt-1">
              <button
                type="button"
                onClick={() => setPeriodo((p) => sumarMeses(p, -1))}
                className="rounded-md p-0.5 text-[#534AB7] hover:bg-[#534AB7]/10"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-lg font-extrabold text-[#534AB7] leading-none px-1">
                {nombreMesPeriodo(periodo)}
              </span>
              <button
                type="button"
                onClick={() => setPeriodo((p) => sumarMeses(p, 1))}
                disabled={!puedeAvanzar}
                className="rounded-md p-0.5 text-[#534AB7] hover:bg-[#534AB7]/10 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {!esMesPorDefecto && (
                <button
                  type="button"
                  onClick={() => setPeriodo(mesPasado())}
                  className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground hover:text-[#534AB7] ml-1.5"
                >
                  Volver a mes pasado
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Lo que falta enviar o revisar de ese mes para poder cerrarlo
            </p>
          </div>
          {data && paso6Cargado && total > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
              <span>
                {completados} de {total}
              </span>
              <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-green-600 rounded-full"
                  style={{ width: `${(completados / total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {!data ? (
          <p className="text-sm text-muted-foreground py-2">Cargando…</p>
        ) : (
          pasos.map((p, i) => {
            const esSiguiente = i === siguienteIdx;
            return (
              <Link key={p.label} to={p.ruta as any} className="block">
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
                  <span className="flex-1">{p.label}</span>
                  {esSiguiente && (
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-primary px-2 py-0.5 rounded-full border border-primary/40">
                      Siguiente
                    </span>
                  )}
                </div>
              </Link>
            );
          })
        )}

        <div className="flex items-center gap-2 px-1 pt-2 pb-0.5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70">
            También pendiente
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <Link to="/iris/movimientos-sin-proveedor" className="block">
          <div
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
              paso6Hecho ? "text-muted-foreground" : ""
            }`}
          >
            {paso6Hecho ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            )}
            <span className="w-5 text-muted-foreground/60">6.</span>
            <span className="flex-1">
              Confirmar movimientos bancarios
              <span className="block text-[11px] font-normal text-muted-foreground">
                Vincularlos a su factura o marcarlos como gasto directo (sin proveedor)
              </span>
            </span>
            {!paso6Hecho && (
              <span className="text-[11px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full whitespace-nowrap">
                {sinProveedorCount ?? "…"} pendientes
              </span>
            )}
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}
