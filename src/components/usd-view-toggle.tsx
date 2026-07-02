import { useUsdView } from "@/lib/usd-view-context";
import { Button } from "@/components/ui/button";
import { DollarSign, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Botón para alternar entre USD Paralelo y USD BCV en las páginas de reportes.
 * Versión visible: chip primario con icono y etiqueta clara.
 */
export function UsdViewToggle({ className }: { className?: string }) {
  const { mode, toggle, label, shortLabel } = useUsdView();
  const isBcv = mode === "bcv";
  return (
    <Button
      type="button"
      size="sm"
      onClick={toggle}
      className={cn(
        "h-9 pl-3 pr-4 gap-2 rounded-full font-semibold shadow-sm transition-colors",
        "bg-primary text-primary-foreground hover:bg-primary/90",
        "border border-primary/20",
        className,
      )}
      title={`Cambiar a ${isBcv ? "USD Paralelo" : "USD BCV"}`}
    >
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-primary-foreground/20">
        <DollarSign className="h-3.5 w-3.5" />
      </span>
      <span className="text-sm">{label}</span>
      <ArrowRightLeft className="h-3.5 w-3.5 opacity-80" />
      <span className="hidden sm:inline text-xs opacity-90">({shortLabel})</span>
    </Button>
  );
}
