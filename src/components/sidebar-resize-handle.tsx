import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "sidebar-width-px";
const DEFAULT_WIDTH = 256; // 16rem, mismo valor por defecto que SIDEBAR_WIDTH en sidebar.tsx
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;

function clamp(v: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v));
}

/** Ancho del sidebar persistido en localStorage, ajustable arrastrando SidebarResizeHandle. */
export function useSidebarWidth() {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved ? clamp(saved) : DEFAULT_WIDTH;
  });

  const setAndPersist = useCallback((w: number) => {
    const clamped = clamp(w);
    setWidth(clamped);
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }, []);

  return { width, setWidth: setAndPersist };
}

/**
 * Línea delgada y arrastrable justo al borde derecho del sidebar. Se coloca
 * como hermano de <AppSidebar />, dentro del mismo contenedor flex.
 */
export function SidebarResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      onResize(startWidth.current + (e.clientX - startX.current));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => onResize(256)}
      title="Arrastra para ajustar el ancho del menú (doble clic para restablecer)"
      className="hidden md:block w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
    />
  );
}
