import { useUsdView } from "@/lib/usd-view-context";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Botón para alternar entre USD Paralelo y USD BCV en las páginas de reportes.
 */
export function UsdViewToggle({ className }: { className?: string }) {
  const { mode, toggle, label } = useUsdView();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={toggle}
      className={cn("gap-2", className)}
      title={`Cambiar a ${mode === "bcv" ? "USD Paralelo" : "USD BCV"}`}
    >
      <ArrowLeftRight className="h-3.5 w-3.5" />
      <span className="text-xs">Ver: <strong>{label}</strong></span>
    </Button>
  );
}
