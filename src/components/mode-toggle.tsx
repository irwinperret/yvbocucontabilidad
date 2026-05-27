import { useNavigate } from "@tanstack/react-router";
import { useMode } from "@/lib/mode-context";
import { cn } from "@/lib/utils";

export function ModeToggle() {
  const { mode, setMode } = useMode();
  const navigate = useNavigate();

  const handleClick = (m: "registro" | "analisis") => {
    setMode(m);
    navigate({ to: m === "registro" ? "/inicio" : "/dashboard" });
  };

  return (
    <div className="inline-flex items-center rounded-lg border-2 bg-card p-1 text-sm font-semibold shadow-sm">
      <button
        onClick={() => handleClick("registro")}
        className={cn(
          "px-5 py-2 rounded-md transition-all",
          mode === "registro" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Registro
      </button>
      <button
        onClick={() => handleClick("analisis")}
        className={cn(
          "px-5 py-2 rounded-md transition-all",
          mode === "analisis" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Análisis
      </button>
    </div>
  );
}
