import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import {
  analizarBorradoTransaccion,
  ejecutarBorradoTransaccion,
  type DeletePlan,
} from "@/lib/eliminar-transaccion";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

type Props = {
  open: boolean;
  transaccion: any | null;
  onClose: () => void;
  onDeleted: () => void;
};

export function EliminarTransaccionDialog({ open, transaccion, onClose, onDeleted }: Props) {
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open || !transaccion) {
      setPlan(null);
      return;
    }
    setLoading(true);
    analizarBorradoTransaccion(transaccion)
      .then(setPlan)
      .catch((e) => toast.error(e.message ?? "Error analizando relaciones"))
      .finally(() => setLoading(false));
  }, [open, transaccion]);

  const ejecutar = async () => {
    if (!plan) return;
    setRunning(true);
    const res = await ejecutarBorradoTransaccion(plan);
    setRunning(false);
    if (!res.ok) {
      toast.error(res.error ?? "No se pudo eliminar");
      return;
    }
    const extras: string[] = [];
    if (plan.cxc.length) extras.push(`${plan.cxc.length} CxC`);
    if (plan.cxp.length) extras.push(`${plan.cxp.length} CxP`);
    if (plan.propinasCount) extras.push(`${plan.propinasCount} propina(s)`);
    toast.success(
      `${plan.transacciones.length} transacción(es) eliminada(s)${extras.length ? " + " + extras.join(", ") : ""}`,
    );
    onDeleted();
    onClose();
  };

  const bloqueado = !!(plan?.bloqueoMesCerrado || plan?.bloqueoAnticipoAplicado);

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar transacción y registros vinculados</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Analizando relaciones…
                </div>
              )}
              {plan && (
                <>
                  {plan.bloqueoMesCerrado && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive flex gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        Hay transacciones en un mes cerrado ({fmtDate(plan.bloqueoMesCerrado)}). Reabre el período en
                        Registrar → COGS antes de eliminar.
                      </div>
                    </div>
                  )}
                  {plan.bloqueoAnticipoAplicado && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive flex gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>{plan.bloqueoAnticipoAplicado}</div>
                    </div>
                  )}

                  {(plan.cxc.length > 0 || plan.cxp.length > 0) && (
                    <div className="rounded-md border bg-muted/40 p-3 text-foreground">
                      {plan.cxc.map((c) => (
                        <div key={c.id}>
                          Vinculada a una <b>cuenta por cobrar</b> de <b>{c.cliente}</b> por{" "}
                          <b>{fmtUsd(c.monto_usd)}</b> ({c.rol === "venta" ? "venta original" : "cobro"}).
                        </div>
                      ))}
                      {plan.cxp.map((c) => (
                        <div key={c.id}>
                          Vinculada a una <b>cuenta por pagar</b> de <b>{c.proveedor}</b> por{" "}
                          <b>{fmtUsd(c.monto_usd)}</b>.
                        </div>
                      ))}
                      <div className="mt-1 text-xs text-muted-foreground">
                        Se eliminarán también la(s) CxC/CxP relacionadas y, si existe, la transacción contraparte.
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="font-medium text-foreground mb-1">
                      Transacciones que se eliminarán ({plan.transacciones.length}):
                    </div>
                    <ul className="space-y-1 max-h-48 overflow-auto rounded border p-2 bg-background">
                      {plan.transacciones.map((tx) => (
                        <li key={tx.id} className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="shrink-0">{tx.cuenta_codigo}</Badge>
                            <span className="text-muted-foreground shrink-0">{fmtDate(tx.fecha)}</span>
                            <span className="truncate">{tx.notas ?? ""}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span>{fmtBs(tx.monto_bs ?? 0)}</span>
                            <span className="text-muted-foreground">{fmtUsd(tx.monto_usd ?? 0)}</span>
                            {tx.rol && tx.rol !== "seleccionada" && (
                              <Badge variant="secondary" className="text-[10px]">{tx.rol}</Badge>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {plan.propinasCount > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Además se eliminarán <b>{plan.propinasCount}</b> registro(s) en la tabla de propinas.
                    </div>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!plan || bloqueado || running || loading}
            onClick={(e) => {
              e.preventDefault();
              ejecutar();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {running ? "Eliminando…" : "Eliminar todo"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
