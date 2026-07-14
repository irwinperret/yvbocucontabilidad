import { useUsdView } from "@/lib/usd-view-context";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Botón para alternar entre USD paralelo y USD BCV en las páginas de reportes.
 * Muestra el modo actual y el modo destino claramente, ya que son dos tasas distintas.
 */
export function UsdViewToggle({ className }: { className?: string }) {
  const { toggle, label, otherLabel } = useUsdView();
  return (
    <Button
      type="button"
      onClick={toggle}
      className={cn(
        "h-10 px-4 gap-2 rounded-full font-semibold shadow-sm transition-all",
        "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow",
        "border border-primary/20",
        className,
      )}
      title={`Cambiar a ${otherLabel}`}
    >
      <span className="text-sm">{label}</span>
      <ArrowRightLeft className="h-3.5 w-3.5 opacity-80" />
      <span className="text-sm opacity-70">{otherLabel}</span>
    </Button>
  );
}
