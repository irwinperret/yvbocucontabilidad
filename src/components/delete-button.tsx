import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { isPeriodClosed } from "@/lib/audit";
import { toast } from "sonner";

type Props = {
  fecha?: string | null;
  detail: string;
  warnings?: string[];
  onConfirm: () => Promise<void>;
  disabledReason?: string | null;
};

export function DeleteButton({ fecha, detail, warnings = [], onConfirm, disabledReason }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleOpen = async (isOpen: boolean) => {
    if (isOpen && fecha) {
      const closed = await isPeriodClosed(fecha);
      if (closed) {
        toast.error("Período cerrado — no se puede borrar.");
        return;
      }
    }
    if (isOpen && disabledReason) {
      toast.error(disabledReason);
      return;
    }
    setOpen(isOpen);
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Error al eliminar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpen}>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar registro</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <div className="text-sm">{detail}</div>
              {warnings.map((w, i) => (
                <div key={i} className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">{w}</div>
              ))}
              <div className="text-xs text-muted-foreground">Esta acción es permanente.</div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={busy} className="bg-destructive hover:bg-destructive/90">
            {busy ? "Eliminando…" : "Eliminar definitivamente"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
