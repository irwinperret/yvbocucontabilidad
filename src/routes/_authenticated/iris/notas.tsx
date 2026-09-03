import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, StickyNote, Plus, Check, Pencil, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";

/** Reordena moviendo el elemento en `from` a la posición `to`, sin mutar el arreglo original. */
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copia = arr.slice();
  const [item] = copia.splice(from, 1);
  copia.splice(to, 0, item);
  return copia;
}

export const Route = createFileRoute("/_authenticated/iris/notas")({
  component: NotasPage,
  head: () => ({
    meta: [
      { title: "Pendientes / Notas | Iris | Yvbocu Contabilidad" },
    ],
  }),
});

function NotasPage() {
  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link to="/iris"><ArrowLeft className="h-4 w-4 mr-1" />Iris</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Pendientes / Notas</h1>
      </div>

      <PendientesCard />
    </div>
  );
}

type Pendiente = {
  id: string;
  texto: string;
  estado: "pendiente" | "resuelta";
  created_at: string;
  created_by: string | null;
  resuelta_at: string | null;
  orden: number | null;
  seguimiento: string | null;
  seguimiento_updated_at: string | null;
  seguimiento_by: string | null;
};

/** Fila arrastrable de una nota abierta — soltarla sobre otra reordena la lista (prioridad). */
function NotaDraggable({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `nota:${id}` });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `nota:${id}` });
  return (
    <div
      ref={setDropRef}
      className={`flex items-start gap-1.5 py-2 ${isDragging ? "opacity-50" : ""} ${isOver ? "bg-muted/50 rounded-md" : ""}`}
    >
      <span
        ref={setDragRef}
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing pt-1 shrink-0 text-muted-foreground"
        title="Arrastrar para cambiar la prioridad"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 min-w-0 space-y-2">{children}</div>
    </div>
  );
}

/** Bloque de "Seguimiento" de una nota — cualquiera del equipo puede leerlo y editarlo. */
function SeguimientoBlock({
  p,
  editandoId,
  valor,
  guardando,
  onIniciar,
  onCambiar,
  onGuardar,
  onCancelar,
}: {
  p: Pendiente;
  editandoId: string | null;
  valor: string;
  guardando: boolean;
  onIniciar: (p: Pendiente) => void;
  onCambiar: (v: string) => void;
  onGuardar: (id: string) => void;
  onCancelar: () => void;
}) {
  const enEdicion = editandoId === p.id;

  if (enEdicion) {
    return (
      <div className="pl-2.5 border-l-2 border-muted space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Seguimiento</p>
        <Textarea
          value={valor}
          onChange={(e) => onCambiar(e.target.value)}
          placeholder="Avance, contexto o cómo se resolvió…"
          className="min-h-[50px] text-sm resize-y"
          autoFocus
        />
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => onGuardar(p.id)} disabled={guardando}>
            {guardando ? "…" : "Guardar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pl-2.5 border-l-2 border-muted">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Seguimiento</p>
          {p.seguimiento ? (
            <p className="text-sm whitespace-pre-wrap">{p.seguimiento}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">Sin seguimiento aún</p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onIniciar(p)}
          title="Editar seguimiento"
          className="shrink-0"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function PendientesCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [resolviendoId, setResolviendoId] = useState<string | null>(null);
  const [verResueltas, setVerResueltas] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [editandoSeguimientoId, setEditandoSeguimientoId] = useState<string | null>(null);
  const [seguimientoTexto, setSeguimientoTexto] = useState("");
  const [guardandoSeguimiento, setGuardandoSeguimiento] = useState(false);

  const { data: pendientes, isLoading } = useQuery({
    queryKey: ["iris-pendientes"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("iris_pendientes")
        .select("id, texto, estado, created_at, created_by, resuelta_at, orden, seguimiento, seguimiento_updated_at, seguimiento_by")
        .order("orden", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Pendiente[];
    },
  });

  const abiertas = (pendientes ?? []).filter((p) => p.estado === "pendiente");
  const resueltas = (pendientes ?? []).filter((p) => p.estado === "resuelta");

  /** Arrastrar una nota abierta sobre otra la reordena — el nuevo orden se guarda de una vez. */
  const onDragEndNota = async (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || active === over) return;
    if (!active.startsWith("nota:") || !over.startsWith("nota:")) return;
    const fromIndex = abiertas.findIndex((p) => `nota:${p.id}` === active);
    const toIndex = abiertas.findIndex((p) => `nota:${p.id}` === over);
    if (fromIndex === -1 || toIndex === -1) return;
    const reordenadas = arrayMove(abiertas, fromIndex, toIndex);
    qc.setQueryData(["iris-pendientes"], (old: Pendiente[] | undefined) =>
      old ? [...reordenadas, ...old.filter((p) => p.estado !== "pendiente")] : old,
    );
    try {
      await Promise.all(
        reordenadas.map((p, i) => (supabase.from as any)("iris_pendientes").update({ orden: i }).eq("id", p.id)),
      );
    } catch {
      toast.error("No se pudo guardar el nuevo orden");
    } finally {
      qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
    }
  };

  const agregar = async () => {
    const t = texto.trim();
    if (!t || !user) return;
    setGuardando(true);
    const ordenes = abiertas.map((p) => p.orden ?? 0);
    const nuevoOrden = ordenes.length ? Math.min(...ordenes) - 1 : 0;
    const { error } = await (supabase.from as any)("iris_pendientes").insert({
      texto: t,
      estado: "pendiente",
      created_by: user.id,
      orden: nuevoOrden,
    });
    setGuardando(false);
    if (error) return toast.error(error.message || "No se pudo guardar la nota");
    setTexto("");
    toast.success("Nota agregada");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
    qc.invalidateQueries({ queryKey: ["iris-pendientes-abiertas-count"] });
  };

  const resolver = async (id: string) => {
    setResolviendoId(id);
    const { error } = await (supabase.from as any)("iris_pendientes")
      .update({ estado: "resuelta", resuelta_at: new Date().toISOString(), resuelta_by: user?.id ?? null })
      .eq("id", id);
    setResolviendoId(null);
    if (error) return toast.error(error.message || "No se pudo marcar como resuelta");
    toast.success("Marcada como resuelta");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
    qc.invalidateQueries({ queryKey: ["iris-pendientes-abiertas-count"] });
  };

  // Editar y borrar la nota están limitados (por RLS en la base) al autor
  // de la nota — cada quien solo puede tocar lo que escribió. Marcar como
  // resuelta sigue abierto a cualquiera del equipo, como ya era. El
  // "Seguimiento" es distinto: cualquiera del equipo puede escribirlo o
  // editarlo, porque su propósito es que varias personas vayan aportando ahí.
  const iniciarEdicion = (p: Pendiente) => {
    setEditandoId(p.id);
    setEditTexto(p.texto);
  };

  const cancelarEdicion = () => {
    setEditandoId(null);
    setEditTexto("");
  };

  const guardarEdicion = async (id: string) => {
    const t = editTexto.trim();
    if (!t) return toast.error("El texto no puede quedar vacío");
    setGuardandoEdit(true);
    const { error } = await (supabase.from as any)("iris_pendientes").update({ texto: t }).eq("id", id);
    setGuardandoEdit(false);
    if (error) return toast.error(error.message || "No se pudo editar la nota");
    toast.success("Nota editada");
    cancelarEdicion();
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
  };

  const borrar = async (id: string) => {
    if (!confirm("¿Borrar esta nota? No se puede deshacer.")) return;
    setBorrandoId(id);
    const { error } = await (supabase.from as any)("iris_pendientes").delete().eq("id", id);
    setBorrandoId(null);
    if (error) return toast.error(error.message || "No se pudo borrar la nota");
    toast.success("Nota borrada");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
    qc.invalidateQueries({ queryKey: ["iris-pendientes-abiertas-count"] });
  };

  const iniciarSeguimiento = (p: Pendiente) => {
    setEditandoSeguimientoId(p.id);
    setSeguimientoTexto(p.seguimiento ?? "");
  };

  const cancelarSeguimiento = () => {
    setEditandoSeguimientoId(null);
    setSeguimientoTexto("");
  };

  const guardarSeguimiento = async (id: string) => {
    setGuardandoSeguimiento(true);
    const { error } = await (supabase.from as any)("iris_pendientes")
      .update({
        seguimiento: seguimientoTexto.trim() || null,
        seguimiento_updated_at: new Date().toISOString(),
        seguimiento_by: user?.id ?? null,
      })
      .eq("id", id);
    setGuardandoSeguimiento(false);
    if (error) return toast.error(error.message || "No se pudo guardar el seguimiento");
    toast.success("Seguimiento guardado");
    cancelarSeguimiento();
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          Pendientes / Notas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Anotar algo para dar seguimiento…"
            className="min-h-[60px] resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) agregar();
            }}
          />
          <Button onClick={agregar} disabled={guardando || !texto.trim()} className="self-end">
            <Plus className="h-4 w-4 mr-1" />
            Agregar
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : abiertas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay pendientes abiertos.</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEndNota}>
            <div className="divide-y">
              {abiertas.map((p) => {
                const esAutor = !!user && p.created_by === user.id;
                const enEdicion = editandoId === p.id;
                return (
                  <NotaDraggable key={p.id} id={p.id}>
                    <div className="flex items-start justify-between gap-3">
                      {enEdicion ? (
                        <div className="flex-1 space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">Nota</p>
                          <Textarea
                            value={editTexto}
                            onChange={(e) => setEditTexto(e.target.value)}
                            className="min-h-[50px] text-sm resize-y"
                            autoFocus
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => guardarEdicion(p.id)} disabled={guardandoEdit || !editTexto.trim()}>
                              {guardandoEdit ? "…" : "Guardar"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelarEdicion} disabled={guardandoEdit}>
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Nota</p>
                          <p className="text-sm">{p.texto}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(p.created_at)}</p>
                        </div>
                      )}
                      {!enEdicion && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {esAutor && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => iniciarEdicion(p)} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => borrar(p.id)}
                                disabled={borrandoId === p.id}
                                title="Borrar"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="outline" onClick={() => resolver(p.id)} disabled={resolviendoId === p.id}>
                            <Check className="h-3.5 w-3.5 mr-1" />
                            {resolviendoId === p.id ? "…" : "Resuelta"}
                          </Button>
                        </div>
                      )}
                    </div>
                    <SeguimientoBlock
                      p={p}
                      editandoId={editandoSeguimientoId}
                      valor={seguimientoTexto}
                      guardando={guardandoSeguimiento}
                      onIniciar={iniciarSeguimiento}
                      onCambiar={setSeguimientoTexto}
                      onGuardar={guardarSeguimiento}
                      onCancelar={cancelarSeguimiento}
                    />
                  </NotaDraggable>
                );
              })}
            </div>
          </DndContext>
        )}

        {resueltas.length > 0 && (
          <div className="pt-2 border-t">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setVerResueltas((v) => !v)}
            >
              {verResueltas ? "Ocultar" : "Ver"} resueltas ({resueltas.length})
            </button>
            {verResueltas && (
              <div className="divide-y mt-2">
                {resueltas.map((p) => {
                  const esAutor = !!user && p.created_by === user.id;
                  const enEdicion = editandoId === p.id;
                  return (
                    <div key={p.id} className="py-2 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        {enEdicion ? (
                          <div className="flex-1 space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">Nota</p>
                            <Textarea
                              value={editTexto}
                              onChange={(e) => setEditTexto(e.target.value)}
                              className="min-h-[50px] text-sm resize-y"
                              autoFocus
                            />
                            <div className="flex gap-1.5">
                              <Button size="sm" onClick={() => guardarEdicion(p.id)} disabled={guardandoEdit || !editTexto.trim()}>
                                {guardandoEdit ? "…" : "Guardar"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelarEdicion} disabled={guardandoEdit}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Nota</p>
                            <p className="text-sm text-muted-foreground line-through">{p.texto}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Resuelta {p.resuelta_at ? fmtDate(p.resuelta_at) : ""}
                            </p>
                          </div>
                        )}
                        {!enEdicion && esAutor && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button size="sm" variant="ghost" onClick={() => iniciarEdicion(p)} title="Editar">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => borrar(p.id)}
                              disabled={borrandoId === p.id}
                              title="Borrar"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <SeguimientoBlock
                        p={p}
                        editandoId={editandoSeguimientoId}
                        valor={seguimientoTexto}
                        guardando={guardandoSeguimiento}
                        onIniciar={iniciarSeguimiento}
                        onCambiar={setSeguimientoTexto}
                        onGuardar={guardarSeguimiento}
                        onCancelar={cancelarSeguimiento}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
