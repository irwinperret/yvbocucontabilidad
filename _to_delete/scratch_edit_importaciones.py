import re, sys

path = "src/routes/_authenticated/importaciones.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences, expected 1", file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)

# 1. import
old_import = '''  type ImportBatch,
  type RevertPlan,
} from "@/lib/import-batches";'''
new_import = '''  type ImportBatch,
  type RevertPlan,
} from "@/lib/import-batches";
import {
  MAPEO_PROVEEDORES_2_1,
  backfillReclasificacionProveedores2_1,
  resumenBackfillProveedores,
  type ResultadoBackfillProveedores,
} from "@/lib/backfill-proveedores-2-1";'''
src = apply_once(src, old_import, new_import, "import")

# 2. state hooks
old_state = '''  const [purgeTarget, setPurgeTarget] = useState<ImportBatch | null>(null);
  const [purgingOne, setPurgingOne] = useState(false);'''
new_state = '''  const [purgeTarget, setPurgeTarget] = useState<ImportBatch | null>(null);
  const [purgingOne, setPurgingOne] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<ResultadoBackfillProveedores | null>(null);'''
src = apply_once(src, old_state, new_state, "state hooks")

# 3. handler
old_handler_tail = '''    setResiduosOpen(false);
    qc.invalidateQueries();
  };



  return ('''
new_handler_tail = '''    setResiduosOpen(false);
    qc.invalidateQueries();
  };

  const confirmarBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await backfillReclasificacionProveedores2_1();
      setBackfillResult(res);
      toast.success(resumenBackfillProveedores(res));
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo ejecutar la reclasificación");
    } finally {
      setBackfilling(false);
    }
  };

  return ('''
src = apply_once(src, old_handler_tail, new_handler_tail, "handler")

# 4. new Card before Residuos card
old_card_anchor = '''        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Residuos de importaciones</CardTitle>'''
new_card_anchor = '''        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Reclasificación histórica · compras en 2.1</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Corrige retroactivamente la cuenta de las compras de Xetux que quedaron en 2.1 -- Compras de
                  mercancía, para 5 proveedores ya confirmados, sin tocar los demás ni los meses cerrados.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBackfillResult(null);
                  setBackfillOpen(true);
                }}
              >
                Reclasificar proveedores
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Residuos de importaciones</CardTitle>'''
src = apply_once(src, old_card_anchor, new_card_anchor, "new card")

# 5. new AlertDialog before closing </div></main-return>
old_tail = '''          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}'''
new_tail = '''          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={backfillOpen}
        onOpenChange={(o) => {
          if (backfilling) return;
          setBackfillOpen(o);
          if (!o) setBackfillResult(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reclasificación histórica de proveedores (2.1)</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {!backfillResult ? (
                  <>
                    <p>
                      Se buscarán todas las compras de estos proveedores que sigan en 2.1 -- Compras de
                      mercancía (en cualquier mes) y se reclasificarán a:
                    </p>
                    <ul className="list-disc pl-5">
                      {MAPEO_PROVEEDORES_2_1.map((m) => (
                        <li key={m.razonSocial}>
                          {m.razonSocial} → {m.cuenta} ({m.cuentaLabel})
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">
                      Se respetan los meses ya cerrados (se reportan, no se tocan) y cada cambio queda
                      registrado en auditoría, igual que cualquier otra edición.
                    </p>
                  </>
                ) : (
                  <>
                    <p>{resumenBackfillProveedores(backfillResult)}</p>
                    {backfillResult.items.length > 0 && (
                      <ul className="list-disc pl-5 max-h-48 overflow-y-auto">
                        {backfillResult.items.map((it) => (
                          <li key={it.transaccionId}>
                            {it.proveedor} · {it.fecha} · {it.resultado.status}
                            {it.resultado.status === "reclasificada" ? ` (${it.resultado.de} → ${it.resultado.a})` : ""}
                            {it.resultado.status === "mes_cerrado" ? ` (${it.resultado.periodo})` : ""}
                            {it.resultado.status === "conflicto" ? ` (actual ${it.resultado.actual}, sugerida ${it.resultado.sugerida})` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {!backfillResult ? (
              <>
                <AlertDialogCancel disabled={backfilling}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={backfilling}
                  onClick={(e) => {
                    e.preventDefault();
                    confirmarBackfill();
                  }}
                >
                  {backfilling ? "Reclasificando…" : "Sí, reclasificar"}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setBackfillOpen(false);
                  setBackfillResult(null);
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
