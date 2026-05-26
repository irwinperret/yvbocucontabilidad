import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/plan-cuentas")({ component: PlanCuentasPage });

function PlanCuentasPage() {
  const { data } = useQuery({
    queryKey: ["plan-cuentas-all"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("*").order("orden");
      return data ?? [];
    },
  });

  const grupos: Record<string, any[]> = {};
  (data ?? []).forEach((c: any) => { (grupos[c.grupo] ||= []).push(c); });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plan de cuentas</h1>
        <p className="text-sm text-muted-foreground">Catálogo contable · solo lectura</p>
      </div>
      {Object.entries(grupos).map(([g, items]) => (
        <Card key={g}>
          <CardHeader><CardTitle className="text-base">{g}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2 w-20">Código</th>
                  <th className="text-left py-2 px-2">Nombre</th>
                  <th className="text-center py-2 px-2 w-16">G&P</th>
                  <th className="text-center py-2 px-2 w-16">FC</th>
                  <th className="text-center py-2 px-2 w-20">Activa</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c: any) => (
                  <tr key={c.codigo} className="border-b last:border-0">
                    <td className="py-1.5 px-2 mono font-semibold">{c.codigo}</td>
                    <td className="py-1.5 px-2">{c.nombre}</td>
                    <td className="py-1.5 px-2 text-center">{c.afecta_gyp && <Badge variant="outline" className="text-xs">G&P</Badge>}</td>
                    <td className="py-1.5 px-2 text-center">{c.afecta_fc && <Badge variant="outline" className="text-xs">FC</Badge>}</td>
                    <td className="py-1.5 px-2 text-center">
                      {c.activa ? <Badge className="bg-green-600 text-xs">on</Badge> : <Badge variant="outline" className="text-xs">off</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
