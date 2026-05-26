import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function useCuentasBancarias() {
  return useQuery({
    queryKey: ["cuentas-bancarias-activas"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cuentas_bancarias" as any)
        .select("*")
        .eq("activa", true)
        .order("nombre");
      return (data as any[]) ?? [];
    },
  });
}

export function BankAccountSelect({
  value,
  onChange,
  required,
  label = "Cuenta bancaria",
  moneda,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  label?: string;
  moneda?: "BS" | "USD";
}) {
  const { data, isLoading } = useCuentasBancarias();
  const list = (data ?? []).filter((c) => !moneda || c.moneda === moneda);

  if (!isLoading && list.length === 0) {
    return (
      <div>
        <Label>{label}</Label>
        <div className="text-xs text-muted-foreground border rounded p-2">
          No hay cuentas bancarias registradas.{" "}
          <Link to="/cuentas-bancarias" className="text-primary underline">Agregar</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Label>{label}{required && " *"}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Selecciona cuenta" /></SelectTrigger>
        <SelectContent>
          {list.map((c) => {
            const last4 = (c.numero || "").slice(-4);
            return (
              <SelectItem key={c.id} value={c.id}>
                {c.nombre} — {c.banco} ****{last4} {c.moneda}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
