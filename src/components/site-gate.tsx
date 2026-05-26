import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifySiteAccess } from "@/lib/site-gate.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const STORAGE_KEY = "site-access-granted";

export function SiteGate({ children }: { children: ReactNode }) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = useServerFn(verifySiteAccess);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setGranted(sessionStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  if (granted === null) return null;
  if (granted) return <>{children}</>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await verify({ data: { password } });
      if (res.ok) {
        sessionStorage.setItem(STORAGE_KEY, "1");
        setGranted(true);
      } else {
        toast.error("Contraseña incorrecta");
        setPassword("");
      }
    } catch (err) {
      toast.error("Error al verificar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Acceso restringido</CardTitle>
          <p className="text-sm text-muted-foreground">Ingresa la contraseña para continuar.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Contraseña</Label>
              <Input
                type="password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Verificando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
