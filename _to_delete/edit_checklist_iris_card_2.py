import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

path = "mnt/yvbocucontabilidad/src/components/checklist-iris-card.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# 1. Imports: useState, ChevronLeft/ChevronRight, sumarMeses.
old = '''import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import {
  fetchImportacionesActivas,
  fetchInventarioFinalPeriodos,
  fetchVentaIvaPeriodos,
  fetchRetencionIslrPeriodos,
  tipoImportadoEnPeriodo,
} from "@/lib/home-checklist";
import { mesPasado, nombreMesPeriodo, fetchMovimientosSinProveedorCount } from "@/lib/iris-checklist";'''

new = '''import { useState } from "react";
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
import { mesPasado, nombreMesPeriodo, sumarMeses, fetchMovimientosSinProveedorCount } from "@/lib/iris-checklist";'''

src = apply_once(src, old, new, "imports")

# 2. periodo pasa a ser estado, por defecto mes pasado, pero se puede cambiar.
old2 = '''export function ChecklistIrisCard() {
  const periodo = mesPasado();'''
new2 = '''export function ChecklistIrisCard() {
  // Por defecto el mes pasado (lo que Iris tiene que cerrar), pero se puede
  // navegar a otros meses para revisar el historial sin perder ese default.
  const [periodo, setPeriodo] = useState(mesPasado());
  const esMesPorDefecto = periodo === mesPasado();
  const puedeAvanzar = periodo < mesPasado();'''
src = apply_once(src, old2, new2, "periodo state")

# 3. Header: el mes ahora se destaca en su propia fila, con flechas para
#    cambiarlo, en vez de ir pegado al titulo en texto chico.
old3 = '''          <div>
            <p className="text-base font-bold text-[#534AB7] flex items-center gap-2 m-0">
              <ListChecks className="h-4 w-4" /> Pendientes de Iris — {nombreMesPeriodo(periodo)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Lo que falta enviar o revisar del mes pasado para poder cerrarlo
            </p>
          </div>'''

new3 = '''          <div>
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
          </div>'''

src = apply_once(src, old3, new3, "header month switcher")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
