import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X } from "lucide-react";
import {
  TIPOS_IMPORTACION,
  fetchImportacionesActivas,
  fetchPeriodosCerrados,
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

export function HistorialImportacionesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["historial-importaciones"],
    enabled: open,
    queryFn: async () => {
      const [imports, cerrados] = await Promise.all([fetchImportacionesActivas(), fetchPeriodosCerrados()]);
      return { imports, cerrados, periodos: periodosParaHistorial(imports, cerrados) };
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historial de importaciones y cierres por mes</DialogTitle>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
        ) : data.periodos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Todavía no hay ninguna importación registrada.</p>
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
