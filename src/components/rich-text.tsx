import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Underline } from "lucide-react";

// Formato de texto simple para notas/pendientes: **negrita**, *cursiva*,
// __subrayado__ (marcadores propios, no es Markdown estándar porque
// Markdown no trae subrayado). Se guarda como texto plano con esos
// marcadores y se interpreta solo al mostrarlo con <FormattedText>.
const TOKEN_RE = /\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*|__([\s\S]+?)__/g;

function parseInline(texto: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(texto))) {
    if (m.index > lastIndex) out.push(texto.slice(lastIndex, m.index));
    if (m[1] !== undefined) out.push(<b key={key++}>{m[1]}</b>);
    else if (m[2] !== undefined) out.push(<i key={key++}>{m[2]}</i>);
    else if (m[3] !== undefined) out.push(<u key={key++}>{m[3]}</u>);
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < texto.length) out.push(texto.slice(lastIndex));
  return out;
}

/** Muestra texto con **negrita**, *cursiva* y __subrayado__ ya interpretados. */
export function FormattedText({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return <>{parseInline(children)}</>;
}

/**
 * Barra de 3 botones (negrita / cursiva / subrayado) para un <Textarea>
 * controlado. Envuelve el texto seleccionado con el marcador correspondiente
 * (o inserta un placeholder si no hay selección) y deja la selección lista
 * para seguir escribiendo encima.
 */
export function RichTextToolbar({
  textareaRef,
  value,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
}) {
  const wrap = (marker: string, placeholder: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(`${value}${marker}${placeholder}${marker}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const seleccionado = value.slice(start, end) || placeholder;
    const nuevo = `${value.slice(0, start)}${marker}${seleccionado}${marker}${value.slice(end)}`;
    onChange(nuevo);
    requestAnimationFrame(() => {
      el.focus();
      const selStart = start + marker.length;
      el.setSelectionRange(selStart, selStart + seleccionado.length);
    });
  };

  return (
    <div className="flex gap-0.5">
      <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" title="Negrita" onClick={() => wrap("**", "negrita")}>
        <Bold className="h-3 w-3" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" title="Cursiva" onClick={() => wrap("*", "cursiva")}>
        <Italic className="h-3 w-3" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" title="Subrayado" onClick={() => wrap("__", "subrayado")}>
        <Underline className="h-3 w-3" />
      </Button>
    </div>
  );
}
