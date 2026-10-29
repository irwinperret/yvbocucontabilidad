import { createContext, useContext, useEffect, useState, ReactNode } from "react";

// El modo oscuro ya estaba completo del lado del CSS (toda la paleta ".dark"
// vive en styles.css vía @custom-variant dark) y varias pantallas ya tenían
// clases dark: escritas, pero no existía forma de prenderlo -- nada le
// agregaba la clase "dark" al <html>. Este provider es esa pieza que
// faltaba, siguiendo el mismo patrón que ya usa ModeProvider (mode-context.tsx).

export type Theme = "light" | "dark";

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void; toggleTheme: () => void }>({
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("app-theme")) as Theme | null;
    if (stored === "light" || stored === "dark") {
      setThemeState(stored);
    } else if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setThemeState("dark");
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    if (typeof window !== "undefined") localStorage.setItem("app-theme", t);
  };

  return (
    <Ctx.Provider value={{ theme, setTheme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark") }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
