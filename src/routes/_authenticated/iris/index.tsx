import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ArrowLeftRight, ChevronRight, StickyNote } from "lucide-react";
import { fmtUsd } from "@/lib/format";
import { pendienteUsdBcv } from "@/lib/cxp-saldo";

export const Route = createFileRoute("/_authenticated/iris/")({
  component: IrisPage,
  head: () => ({
    meta: [
      { title: "Iris — Revisión general | Yvbocu Contabilidad" },
      { name: "description", content: "Revisión administrativa de la conciliación de cada proveedor y de los movimientos bancarios sin proveedor asignado." },
    ],
  }),
});

function IrisPage() {
  // Movimientos "sin proveedor" que todavía no han sido confirmados (sin
  // ningún vínculo manual en conciliacion_bancaria todavía).
  const { data: sinProveedorCount } = useQuery({
    queryKey: ["iris-sin-proveedor-count"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const movs = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id")
          .like("referencia", "BANK:%")
          .neq("standby", true)
          .is("tercero_id", null)
          .range(from, to),
      );
      if (!movs.length) return 0;
      const vinculos = await fetchAllRows<any>(async (from, to) =>
        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_bancaria_id, origen")
          .in("transaccion_bancaria_id", movs.map((m) => m.id))
          .range(from, to),
      );
      const yaConfirmados = new Set(
        vinculos.filter((v: any) => v.origen === "manual").map((v: any) => v.transaccion_bancaria_id),
      );
      return movs.filter((m) => !yaConfirmados.has(m.id)).length;
    },
  });

  // Proveedores con CxP pendiente, ordenados de mayor a menor (USD BCV).
  const { data: proveedores } = useQuery({
    queryKey: ["iris-proveedores-cxp"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const cxps = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("cuentas_por_pagar")
          .select("tercero_id, proveedor, monto_pendiente_usd_bcv, monto_usd, usd_bcv_factura, estado")
          .neq("estado", "pagada")
          .range(from, to),
      );
      const porTercero = new Map<string, { nombre: string; total: number }>();
      for (const c of cxps) {
        if (!c.tercero_id) continue;
        const prev = porTercero.get(c.tercero_id) ?? { nombre: c.proveedor ?? "Proveedor", total: 0 };
        prev.total += pendienteUsdBcv(c);
        porTercero.set(c.tercero_id, prev);
      }
      return Array.from(porTercero, ([tercero_id, v]) => ({ tercero_id, ...v }))
        .filter((p) => p.total > 0.01)
        .sort((a, b) => b.total - a.total);
    },
  });

  // Notas/pendientes abiertos (solo el conteo — el detalle vive en /iris/notas).
  const { data: pendientesAbiertosCount } = useQuery({
    queryKey: ["iris-pendientes-abiertas-count"],
    queryFn: async () => {
      const { count, error } = await (supabase.from as any)("iris_pendientes")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-purple-600" />
          Iris — Revisión general
        </h1>
        <p className="text-sm text-muted-foreground">
          Revisión administrativa de la conciliación de cada proveedor. Todos los montos en USD BCV.
        </p>
      </div>

      <Link to="/iris/notas">
        <Card className="hover:border-primary/60 hover:bg-muted/30 transition-colors cursor-pointer">
          <CardContent className="pt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StickyNote className="h-5 w-5 text-muted-foreground" />
              <div className="text-lg font-bold text-[#534AB7]">Notas</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={pendientesAbiertosCount ? "destructive" : "secondary"}>
                {pendientesAbiertosCount ?? "…"} abiertas
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/iris/movimientos-sin-proveedor">
        <Card className="hover:border-primary/60 hover:bg-muted/30 transition-colors cursor-pointer">
          <CardContent className="pt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-lg font-bold text-[#534AB7]">Movimientos bancarios sin proveedor</div>
                <p className="text-xs text-muted-foreground">Confirmar que son efectivamente Gasto Stand-Alone</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={sinProveedorCount ? "destructive" : "secondary"}>
                {sinProveedorCount ?? "…"} sin confirmar
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-[#534AB7]">Proveedores — de mayor a menor CxP pendiente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {(proveedores ?? []).map((p) => (
              <Link
                key={p.tercero_id}
                to="/proveedores/$id"
                params={{ id: p.tercero_id }}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <span className="font-medium">{p.nombre}</span>
                <div className="flex items-center gap-2">
                  <span className="mono text-sm font-semibold">{fmtUsd(p.total)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
            {proveedores && proveedores.length === 0 && (
              <p className="text-sm text-muted-foreground px-4 py-6 text-center">No hay proveedores con CxP pendiente.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
