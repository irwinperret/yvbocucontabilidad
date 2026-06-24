import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function UsdRateBadge({ className = "" }: { className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary cursor-help select-none ${className}`}
          >
            <Info className="h-3 w-3" />
            Montos en USD (tasa paralela)
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          Todos los montos en USD de esta vista se calculan a la tasa paralela del día de la transacción.
          La tasa BCV se conserva únicamente como referencia fiscal.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
