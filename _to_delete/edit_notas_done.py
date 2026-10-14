import sys

path = "src/routes/_authenticated/iris/notas.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences, expected 1", file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)

# 1. import icon
old_import = '''import { ArrowLeft, StickyNote, Plus, Check, Pencil, Trash2, GripVertical } from "lucide-react";'''
new_import = '''import { ArrowLeft, StickyNote, Plus, Check, Pencil, Trash2, GripVertical, Undo2 } from "lucide-react";'''
src = apply_once(src, old_import, new_import, "import")

# 2. state hook
old_state = '''  const [resolviendoId, setResolviendoId] = useState<string | null>(null);'''
new_state = '''  const [resolviendoId, setResolviendoId] = useState<string | null>(null);
  const [reabriendoId, setReabriendoId] = useState<string | null>(null);'''
src = apply_once(src, old_state, new_state, "state hook")

# 3. reabrir function, right after resolver()
old_resolver_tail = '''    if (error) return toast.error(error.message || "No se pudo marcar como resuelta");
    toast.success("Marcada como resuelta");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
    qc.invalidateQueries({ queryKey: ["iris-pendientes-abiertas-count"] });
  };'''
new_resolver_tail = '''    if (error) return toast.error(error.message || "No se pudo marcar como resuelta");
    toast.success("Marcada como resuelta");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
    qc.invalidateQueries({ queryKey: ["iris-pendientes-abiertas-count"] });
  };

  /** Inverso de resolver(): vuelve una nota resuelta a pendiente, por si se marcó por error. */
  const reabrir = async (id: string) => {
    setReabriendoId(id);
    const { error } = await (supabase.from as any)("iris_pendientes")
      .update({ estado: "pendiente", resuelta_at: null, resuelta_by: null })
      .eq("id", id);
    setReabriendoId(null);
    if (error) return toast.error(error.message || "No se pudo reabrir la nota");
    toast.success("Nota reabierta");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
    qc.invalidateQueries({ queryKey: ["iris-pendientes-abiertas-count"] });
  };'''
src = apply_once(src, old_resolver_tail, new_resolver_tail, "reabrir function")

# 4. button in the resueltas list (not gated by esAutor, same convention as "resolver" above)
old_resueltas_buttons = '''                        {!enEdicion && esAutor && (
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
                        )}'''
new_resueltas_buttons = '''                        {!enEdicion && (
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
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reabrir(p.id)}
                              disabled={reabriendoId === p.id}
                              title="Volver a marcar como pendiente"
                            >
                              <Undo2 className="h-3.5 w-3.5 mr-1" />
                              {reabriendoId === p.id ? "…" : "Reabrir"}
                            </Button>
                          </div>
                        )}'''
src = apply_once(src, old_resueltas_buttons, new_resueltas_buttons, "resueltas buttons")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("ALL EDITS APPLIED")
