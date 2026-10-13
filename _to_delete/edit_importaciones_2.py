import sys

path = "src/routes/_authenticated/importaciones.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences, expected 1", file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)

# 1. imports
old_import = '''  type ResultadoBackfillProveedores,
} from "@/lib/backfill-proveedores-2-1";'''
new_import = '''  type ResultadoBackfillProveedores,
} from "@/lib/backfill-proveedores-2-1";
import {
  fetchCambiosAuditoria,
  revertirCambioAuditoria,
  resumenRevertirCambios,
  type CambioAuditoria,
  type ResultadoRevertirCambio,
} from "@/lib/revertir-auditoria";
import { fetchPeriodosCerrados } from "@/lib/home-checklist";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";'''
src = apply_once(src, old_import, new_import, "import")

# 2. state hooks
old_state = '''  const [backfillResult, setBackfillResult] = useState<ResultadoBackfillProveedores | null>(null);'''
new_state = '''  const [backfillResult, setBackfillResult] = useState<ResultadoBackfillProveedores | null>(null);

  const [histDesde, setHistDesde] = useState("");
  const [histHasta, setHistHasta] = useState("");
  const [cambios, setCambios] = useState<CambioAuditoria[]>([]);
  const [buscandoCambios, setBuscandoCambios] = useState(false);
  const [seleccionCambios, setSeleccionCambios] = useState<Set<string>>(new Set());
  const [confirmRevertirOpen, setConfirmRevertirOpen] = useState(false);
  const [revirtiendoCambios, setRevirtiendoCambios] = useState(false);
  const [resultadoRevertir, setResultadoRevertir] = useState<ResultadoRevertirCambio[] | null>(null);'''
src = apply_once(src, old_state, new_state, "state hooks")

# 3. handlers (after confirmarBackfill, before return()
old_handlers_tail = '''    } finally {
      setBackfilling(false);
    }
  };

  return ('''
new_handlers_tail = '''    } finally {
      setBackfilling(false);
    }
  };

  const toLocalInputValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const buscarCambios = async (desdeIso: string, hastaIso: string) => {
    setBuscandoCambios(true);
    try {
      const res = await fetchCambiosAuditoria({ desde: desdeIso, hasta: hastaIso });
      setCambios(res);
      setSeleccionCambios(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo buscar el historial de cambios");
    } finally {
      setBuscandoCambios(false);
    }
  };

  const aplicarVentanaRapida = (minutos: number) => {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - minutos * 60000);
    setHistDesde(toLocalInputValue(desde));
    setHistHasta(toLocalInputValue(hasta));
    buscarCambios(desde.toISOString(), hasta.toISOString());
  };

  const buscarConFormulario = () => {
    if (!histDesde || !histHasta) return toast.error("Completa ambas fechas");
    const desde = new Date(histDesde);
    const hasta = new Date(histHasta);
    if (desde > hasta) return toast.error("La fecha \\"desde\\" no puede ser posterior a \\"hasta\\"");
    buscarCambios(desde.toISOString(), hasta.toISOString());
  };

  const toggleSeleccionCambio = (id: string, v: boolean) => {
    setSeleccionCambios((s) => {
      const next = new Set(s);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const confirmarRevertirCambios = async () => {
    setRevirtiendoCambios(true);
    try {
      const periodosCerrados = await fetchPeriodosCerrados();
      const seleccionados = cambios.filter((c) => seleccionCambios.has(c.id));
      const resultados: ResultadoRevertirCambio[] = [];
      for (const c of seleccionados) {
        resultados.push(await revertirCambioAuditoria(c, periodosCerrados));
      }
      setResultadoRevertir(resultados);
      toast.success(resumenRevertirCambios(resultados));
      qc.invalidateQueries();
      if (histDesde && histHasta) {
        buscarCambios(new Date(histDesde).toISOString(), new Date(histHasta).toISOString());
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo deshacer los cambios seleccionados");
    } finally {
      setRevirtiendoCambios(false);
    }
  };

  return ('''
src = apply_once(src, old_handlers_tail, new_handlers_tail, "handlers")

# 4. new Card, inserted right before the Residuos card (after the backfill card's closing)
old_card_anchor = '''      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Residuos de importaciones</CardTitle>'''
new_card_anchor = '''      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deshacer cambios recientes (auditoría)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Busca los cambios registrados en una ventana de tiempo -- útil justo después de correr un
              backfill o script que haya salido mal -- y deshace los que quieras. Solo se restauran los
              campos que cambiaron, y nunca si ya fueron modificados otra vez después.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Desde</label>
                <Input
                  type="datetime-local"
                  value={histDesde}
                  onChange={(e) => setHistDesde(e.target.value)}
                  className="w-56"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Hasta</label>
                <Input
                  type="datetime-local"
                  value={histHasta}
                  onChange={(e) => setHistHasta(e.target.value)}
                  className="w-56"
                />
              </div>
              <Button size="sm" onClick={buscarConFormulario} disabled={buscandoCambios}>
                {buscandoCambios ? "Buscando…" : "Buscar"}
              </Button>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => aplicarVentanaRapida(15)}>
                  Últimos 15 min
                </Button>
                <Button size="sm" variant="outline" onClick={() => aplicarVentanaRapida(60)}>
                  Última hora
                </Button>
                <Button size="sm" variant="outline" onClick={() => aplicarVentanaRapida(60 * 24)}>
                  Últimas 24h
                </Button>
              </div>
            </div>

            {cambios.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{cambios.length} cambio(s) encontrados.</p>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={seleccionCambios.size === 0}
                    onClick={() => {
                      setResultadoRevertir(null);
                      setConfirmRevertirOpen(true);
                    }}
                  >
                    Deshacer seleccionados ({seleccionCambios.size})
                  </Button>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tabla</TableHead>
                        <TableHead>Acción</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Qué cambió</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cambios.map((c) => {
                        const soportado = c.accion === "UPDATE" && !!c.registro_id && c.diffs.length > 0;
                        return (
                          <TableRow key={c.id}>
                            <TableCell>
                              <Checkbox
                                checked={seleccionCambios.has(c.id)}
                                disabled={!soportado}
                                onCheckedChange={(v) => toggleSeleccionCambio(c.id, Boolean(v))}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{fmtFecha(c.created_at)}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{c.tabla}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{c.accion}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {emailById.get(c.user_id ?? "") ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {soportado ? (
                                c.diffs.map((d) => (
                                  <div key={d.campo}>
                                    <span className="font-medium">{d.campo}</span>: {JSON.stringify(d.antes)} →{" "}
                                    {JSON.stringify(d.despues)}
                                  </div>
                                ))
                              ) : (
                                <span className="text-muted-foreground">
                                  {c.accion === "UPDATE" ? "sin campos detectables" : `${c.accion} -- no soportado aquí`}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            {!buscandoCambios && cambios.length === 0 && histDesde && histHasta && (
              <p className="text-sm text-muted-foreground">Sin cambios en esa ventana.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Residuos de importaciones</CardTitle>'''
src = apply_once(src, old_card_anchor, new_card_anchor, "new card")

# 5. new AlertDialog at the very end
old_tail = '''      </AlertDialog>
    </div>
  );
}'''
new_tail = '''      </AlertDialog>

      <AlertDialog
        open={confirmRevertirOpen}
        onOpenChange={(o) => {
          if (revirtiendoCambios) return;
          setConfirmRevertirOpen(o);
          if (!o) setResultadoRevertir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deshacer cambios seleccionados</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {!resultadoRevertir ? (
                  <>
                    <p>
                      Se restaurará el valor anterior de estos campos, solo si no fueron tocados otra vez
                      después:
                    </p>
                    <ul className="list-disc pl-5 max-h-48 overflow-y-auto">
                      {cambios
                        .filter((c) => seleccionCambios.has(c.id))
                        .map((c) => (
                          <li key={c.id}>
                            {c.tabla} · {fmtFecha(c.created_at)}
                            {c.diffs
                              .map((d) => ` · ${d.campo}: ${JSON.stringify(d.despues)} → ${JSON.stringify(d.antes)}`)
                              .join("")}
                          </li>
                        ))}
                    </ul>
                    <p className="text-muted-foreground">
                      Esta acción no se puede deshacer por sí misma, pero queda registrada en auditoría.
                    </p>
                  </>
                ) : (
                  <p>{resumenRevertirCambios(resultadoRevertir)}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {!resultadoRevertir ? (
              <>
                <AlertDialogCancel disabled={revirtiendoCambios}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={revirtiendoCambios}
                  onClick={(e) => {
                    e.preventDefault();
                    confirmarRevertirCambios();
                  }}
                >
                  {revirtiendoCambios ? "Deshaciendo…" : "Sí, deshacer"}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmRevertirOpen(false);
                  setResultadoRevertir(null);
                }}
              >
                Cerrar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}'''
src = apply_once(src, old_tail, new_tail, "tail dialog")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("ALL EDITS APPLIED")
