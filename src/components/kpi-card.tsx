import { Card, CardContent } from "@/components/ui/card";

/** Tarjeta KPI genérica — usada por las pantallas "en Detalle" (Ingresos,
 * Egresos) para mostrar un total o subtotal con su etiqueta e ícono. */
export function KpiCard({ icon: Icon, label, value, sub, tone }: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg" | "muted";
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${tone === "neg" ? "text-destructive" : tone === "pos" ? "text-green-600" : tone === "muted" ? "text-muted-foreground" : ""}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}
