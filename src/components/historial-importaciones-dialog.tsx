import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X } from "lucide-react";
import {
  TIPOS_IMPORTACION,
  fetchImportacionesActivas,
  fetchPeriodosCerrados,
  fetchInventarioFinalPeriodos,
  fetchVentaIvaPeriodos,
  fetchRetencionIslrPeriodos,
  periodosParaHistorial,
  tipoImportadoEnPeriodo,
  type TipoImportacion,
} from "@/lib/home-checklist";

function celda(ok: boolean) {
  return ok ? (
    <Check className="h-4 w-4 text-green-600 mx-auto" />
  ) : (
    <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
  );
}

// Columnas extra del historial que no vienen de la tabla `importaciones`
// (son entradas manuales mensuales): Inventario, Venta de IVA, Retención
// ISLR. Cada una se resuelve contra el Set de períodos que ya tiene algo
// cargado, que se trae junto con las importaciones.
const COLUMNAS_MANUALES = [
  { key: "inventario" as const, label: "Inventario" },
  { key: "ventaIva" as const, label: "Venta de IVA" },
  { key: "retencionIslr" as const, label: "Retención ISLR" },
];

export function HistorialImportacionesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["historial-importaciones"],
    enabled: open,
    queryFn: async () => {
      const [imports, cerrados, inventario, ventaIva, retencionIslr] = await Promise.all([
        fetchImportacionesActivas(),
        fetchPeriodosCerrados(),
        fetchInventarioFinalPeriodos(),
        fetchVentaIvaPeriodos(),
        fetchRetencionIslrPeriodos(),
      ]);
      return {
        imports,
        cerrados,
        inventario,
        ventaIva,
        retencionIslr,
        periodos: periodosParaHistorial(imports, cerrados, inventario, ventaIva, retencionIslr),
      };
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Historial de entradas y cierres por mes</DialogTitle>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
        ) : data.periodos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Todavía no hay ninguna entrada registrada.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-2">Mes</th>
                  {TIPOS_IMPORTACION.map((t) => (
                    <th key={t.tipo} className="py-2 px-2 text-center font-medium">
                      {t.label.replace("Importar ", "")}
                    </th>
                  ))}
                  {COLUMNAS_MANUALES.map((c) => (
                    <th key={c.key} className="py-2 px-2 text-center font-medium">{c.label}</th>
                  ))}
                  <th className="py-2 px-2 text-center font-medium">Cierre</th>
                </tr>
              </thead>
              <tbody>
                {data.periodos.map((periodo) => (
                  <tr key={periodo} className="border-b last:border-0">
                    <td className="py-2 pr-2 mono">{periodo}</td>
                    {TIPOS_IMPORTACION.map((t) => (
                      <td key={t.tipo} className="py-2 px-2 text-center">
                        {celda(tipoImportadoEnPeriodo(data.imports, t.tipo as TipoImportacion, periodo))}
                      </td>
                    ))}
                    {COLUMNAS_MANUALES.map((c) => (
                      <td key={c.key} className="py-2 px-2 text-center">
                        {celda(data[c.key].has(periodo))}
                      </td>
                    ))}
                    <td className="py-2 px-2 text-center">{celda(data.cerrados.has(periodo))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
