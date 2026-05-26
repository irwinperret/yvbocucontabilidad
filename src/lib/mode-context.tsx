import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type AppMode = "registro" | "analisis";

const Ctx = createContext<{ mode: AppMode; setMode: (m: AppMode) => void }>({
  mode: "registro",
  setMode: () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>("registro");

  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("app-mode")) as AppMode | null;
    if (stored === "registro" || stored === "analisis") setModeState(stored);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("mode-analisis", mode === "analisis");
    document.documentElement.classList.toggle("mode-registro", mode === "registro");
  }, [mode]);

  const setMode = (m: AppMode) => {
    setModeState(m);
    if (typeof window !== "undefined") localStorage.setItem("app-mode", m);
  };

  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}

export const useMode = () => useContext(Ctx);
