import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type UsdViewMode = "paralela" | "bcv";

type Ctx = {
  mode: UsdViewMode;
  setMode: (m: UsdViewMode) => void;
  toggle: () => void;
  label: string; // "USD paralelo" | "USD BCV"
  otherLabel: string; // el opuesto al actual
  shortLabel: string; // "paralelo" | "BCV"
};

const UsdViewContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "usd-view-mode";

export function UsdViewProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<UsdViewMode>("paralela");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "bcv" || stored === "paralela") setModeState(stored);
  }, []);

  const setMode = (m: UsdViewMode) => {
    setModeState(m);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, m);
  };
  const toggle = () => setMode(mode === "paralela" ? "bcv" : "paralela");

  const label = mode === "bcv" ? "USD BCV" : "USD paralelo";
  const otherLabel = mode === "bcv" ? "USD paralelo" : "USD BCV";
  const shortLabel = mode === "bcv" ? "BCV" : "paralelo";

  return (
    <UsdViewContext.Provider value={{ mode, setMode, toggle, label, otherLabel, shortLabel }}>
      {children}
    </UsdViewContext.Provider>
  );
}

export function useUsdView() {
  const ctx = useContext(UsdViewContext);
  if (!ctx) throw new Error("useUsdView must be used inside UsdViewProvider");
  return ctx;
}

/** Nombre de la vista mensual según modo. */
export function mensualView(mode: UsdViewMode) {
  return mode === "bcv" ? "v_transacciones_mensual_bcv" : "v_transacciones_mensual";
}

/**
 * Calcula el USD visual para una transacción según el modo.
 * - paralela: monto_bs / tasa_paralela → fallback map por fecha → fallback monto_usd
 * - bcv:      monto_bs / tasa_bcv     → fallback map por fecha → null
 */
export function usdVisual(
  t: { monto_bs?: number | null; monto_usd?: number | null; tasa_bcv?: number | null; tasa_paralela?: number | null; fecha?: string },
  mode: UsdViewMode,
  maps?: { paralelaByFecha?: Record<string, number>; bcvByFecha?: Record<string, number> },
): number | null {
  const bs = Number(t.monto_bs) || 0;
  if (mode === "bcv") {
    const rate = Number(t.tasa_bcv) || 0;
    if (rate > 0) return bs / rate;
    const fb = maps?.bcvByFecha && t.fecha ? Number(maps.bcvByFecha[t.fecha] || 0) : 0;
    return fb > 0 ? bs / fb : null;
  }
  const rate = Number(t.tasa_paralela) || 0;
  if (rate > 0) return bs / rate;
  const fb = maps?.paralelaByFecha && t.fecha ? Number(maps.paralelaByFecha[t.fecha] || 0) : 0;
  if (fb > 0) return bs / fb;
  return Number(t.monto_usd) || 0;
}
