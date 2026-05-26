import { useMode } from "@/lib/mode-context";
import { cn } from "@/lib/utils";

export function ModeToggle() {
  const { mode, setMode } = useMode();
  return (
    <div className="inline-flex items-center rounded-md border bg-card p-0.5 text-xs font-medium">
      <button
        onClick={() => setMode("registro")}
        className={cn(
          "px-3 py-1.5 rounded-sm transition-colors",
          mode === "registro" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Registro
      </button>
      <button
        onClick={() => setMode("analisis")}
        className={cn(
          "px-3 py-1.5 rounded-sm transition-colors",
          mode === "analisis" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Análisis
      </button>
    </div>
  );
}
