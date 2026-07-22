import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
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
import { Button } from "@/components/ui/button";
import { isPeriodClosed } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";

const ADMIN_REOPEN_EMAILS = [
  "irwinperret@hotmail.com",
  "irwinperret@gmail.com",
  "castillo_iris@yahoo.com",
];

type Resolver = (v: boolean) => void;

type Ctx = {
  ensurePeriodoAbierto: (fecha: string) => Promise<boolean>;
};

const MesCerradoContext = createContext<Ctx | null>(null);

export function MesCerradoProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [periodo, setPeriodo] = useState<string>("");
  const resolverRef = useRef<Resolver | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = !!user?.email && ADMIN_REOPEN_EMAILS.includes(user.email.toLowerCase());

  const ensurePeriodoAbierto = useCallback(async (fecha: string): Promise<boolean> => {
    if (!fecha) return true;
    let closed = false;
    try {
      closed = await isPeriodClosed(fecha);
    } catch {
      return true; // no bloquear si la verificación falla
    }
    if (!closed) return true;
    const per = fecha.slice(0, 7);
    setPeriodo(per);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const resolve = (v: boolean) => {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(v);
  };

  return (
    <MesCerradoContext.Provider value={{ ensurePeriodoAbierto }}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) resolve(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>El mes {periodo} está cerrado</AlertDialogTitle>
            <AlertDialogDescription>
              Puedes registrar esta transacción, pero <strong>no podrás editarla ni borrarla</strong>{" "}
              mientras el mes siga cerrado. Si necesitas hacer cambios posteriormente, deberás
              reabrir el mes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel onClick={() => resolve(false)}>Cancelar</AlertDialogCancel>
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => {
                  resolve(false);
                  navigate({ to: "/transacciones", search: { reabrir: periodo } as any });
                }}
              >
                Reabrir mes
              </Button>
            )}
            <AlertDialogAction onClick={() => resolve(true)}>
              Continuar y registrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MesCerradoContext.Provider>
  );
}

export function useMesCerradoGuard(): (fecha: string) => Promise<boolean> {
  const ctx = useContext(MesCerradoContext);
  if (!ctx) {
    // Fallback no-op para componentes fuera del provider
    return async () => true;
  }
  return ctx.ensurePeriodoAbierto;
}
