import { AlertTriangle } from "lucide-react";

/**
 * Aviso uniforme para cuando una query de solo lectura falla. Antes estas
 * pantallas no tenían ningún indicio visual de error -- si la consulta
 * fallaba, la pantalla simplemente se veía vacía o en cero, indistinguible
 * de "no hay datos en este período".
 */
export function QueryErrorBanner({ show, label = "los datos de esta pantalla" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div className="text-xs bg-red-50 text-red-700 border border-red-300 rounded px-2 py-1.5 flex items-center gap-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      No se pudieron cargar {label}. Intenta recargar la página; si el problema sigue, avísale a quien administra el sistema.
    </div>
  );
}
