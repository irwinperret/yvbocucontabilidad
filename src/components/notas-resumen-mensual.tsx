import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormattedText, RichTextToolbar } from "@/components/rich-text";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, Check, X, StickyNote } from "lucide-react";

type Nota = {
  id: string;
  periodo: string;
  texto: string;
  orden: number;
  created_at: string;
};

function FilaNota({
  nota, onGuardar, onBorrar,
}: {
  nota: Nota;
  onGuardar: (id: string, texto: string) => Promise<void>;
  onBorrar: (id: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(nota.texto);
  const [guardando, setGuardando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const guardar = async () => {
    const t = texto.trim();
    if (!t) { toast.error("El punto no puede quedar vacío"); return; }
    setGuardando(true);
    try {
      await onGuardar(nota.id, t);
      setEditando(false);
    } finally {
      setGuardando(false);
    }
  };

  if (editando) {
    return (
      <div className="rounded-md border bg-background p-2 space-y-1.5">
        <RichTextToolbar textareaRef={ref} value={texto} onChange={setTexto} />
        <Textarea
          ref={ref}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="min-h-[60px] resize-y text-sm"
          autoFocus
        />
        <div className="flex justify-end gap-1.5">
          <Button
            type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs"
            onClick={() => { setTexto(nota.texto); setEditando(false); }}
            disabled={guardando}
          >
            <X className="h-3 w-3 mr-1" /> Cancelar
          </Button>
          <Button type="button" size="sm" className="h-6 px-2 text-xs" onClick={guardar} disabled={guardando}>
            <Check className="h-3 w-3 mr-1" /> Guardar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-muted/40">
      <span className="text-muted-foreground mt-1 text-[10px]">●</span>
      <p className="flex-1 text-sm leading-relaxed whitespace-pre-wrap">
        <FormattedText>{nota.texto}</FormattedText>
      </p>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditando(true)} title="Editar">
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => onBorrar(nota.id)} title="Borrar">
          <Trash2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Puntos de texto manuales, específicos de cada mes/año, para complementar
 * el "Análisis del mes" cuando el texto automático no alcanza. Mismo patrón
 * de formato y componentes que las notas de Iris (ver rich-text.tsx):
 * **negrita**, *cursiva*, __subrayado__ como marcadores de texto plano, no HTML.
 */
export function NotasResumenMensual({ periodo }: { periodo: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const nuevaRef = useRef<HTMLTextAreaElement>(null);
  const [textoNuevo, setTextoNuevo] = useState("");
  const [agregando, setAgregando] = useState(false);

  const { data: notas, isLoading } = useQuery({
    queryKey: ["resumen-mensual-notas", periodo],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("resumen_mensual_notas")
        .select("id, periodo, texto, orden, created_at")
        .eq("periodo", periodo)
        .order("orden", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Nota[];
    },
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ["resumen-mensual-notas", periodo] });

  const agregarPunto = async () => {
    const t = textoNuevo.trim();
    if (!t) return;
    const siguienteOrden = (notas ?? []).reduce((max, n) => Math.max(max, n.orden), 0) + 1;
    setAgregando(true);
    const { error } = await (supabase.from as any)("resumen_mensual_notas").insert({
      periodo, texto: t, orden: siguienteOrden, created_by: user?.id ?? null,
    });
    setAgregando(false);
    if (error) { toast.error(error.message || "No se pudo guardar el punto"); return; }
    setTextoNuevo("");
    refrescar();
  };

  const guardarPunto = async (id: string, texto: string) => {
    const { error } = await (supabase.from as any)("resumen_mensual_notas")
      .update({ texto, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message || "No se pudo guardar"); return; }
    refrescar();
  };

  const borrarPunto = async (id: string) => {
    if (!confirm("¿Borrar este punto? No se puede deshacer.")) return;
    const { error } = await (supabase.from as any)("resumen_mensual_notas").delete().eq("id", id);
    if (error) { toast.error(error.message || "No se pudo borrar"); return; }
    refrescar();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          Puntos adicionales
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}
        {!isLoading && (notas ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground mb-2">Sin puntos agregados para este mes todavía.</p>
        )}
        {(notas ?? []).map((n) => (
          <FilaNota key={n.id} nota={n} onGuardar={guardarPunto} onBorrar={borrarPunto} />
        ))}

        <div className="rounded-md border bg-muted/20 p-2 space-y-1.5 mt-3">
          <RichTextToolbar textareaRef={nuevaRef} value={textoNuevo} onChange={setTextoNuevo} />
          <Textarea
            ref={nuevaRef}
            value={textoNuevo}
            onChange={(e) => setTextoNuevo(e.target.value)}
            placeholder="Agregar un punto para complementar el análisis…"
            className="min-h-[60px] resize-y text-sm bg-background"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) agregarPunto(); }}
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" className="h-7 text-xs" onClick={agregarPunto} disabled={agregando || !textoNuevo.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Agregar punto
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
