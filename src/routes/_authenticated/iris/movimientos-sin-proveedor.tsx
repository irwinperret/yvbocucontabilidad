import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { fmtUsd, fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { marcarEstadoConciliacion } from "@/lib/conciliacion";
import { EditDialog } from "@/components/transaccion-edit-dialog";

export const Route = createFileRoute("/_authenticated/iris/movimientos-sin-proveedor")({
  component: MovimientosSinProveedorPage,
  head: () => ({
    meta: [
      { title: "Movimientos sin proveedor | Iris | Yvbocu Contabilidad" },
    ],
  }),
});

function MovimientosSinProveedorPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [confirmandoTodos, setConfirmandoTodos] = useState(false);
  const [movimientoEditando, setMovimientoEditando] = useState<any | null>(null);

  const { data: movimientos, isLoading } = useQuery({
    queryKey: ["iris-movs-sin-proveedor"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const movs = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("*")
          .like("referencia", "BANK:%")
          .neq("standby", true)
          .is("tercero_id", null)
          .order("fecha", { ascending: false })
          .range(from, to),
      );
      if (!movs.length) return [];
      const vinculos = await fetchAllRows<any>(async (from, to) =>
        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_bancaria_id, origen")
          .in("transaccion_bancaria_id", movs.map((m) => m.id))
          .range(from, to),
      );
      const yaConfirmados = new Set(
        vinculos.filter((v: any) => v.origen === "manual").map((v: any) => v.transaccion_bancaria_id),
      );
      return movs.filter((m) => !yaConfirmados.has(m.id));
    },
  });

  const usdBcv = (m: any) => {
    const tasa = Number(m.tasa_bcv) || 0;
    return tasa > 0 ? Math.abs(Number(m.monto_bs) || 0) / tasa : Number(m.monto_usd) || 0;
  };

  const confirmar = async (movId: string) => {
    setConfirmandoId(movId);
    const r = await marcarEstadoConciliacion({ movimientoId: movId, estado: "gasto_directo", userId: user?.id ?? null });
    setConfirmandoId(null);
    if (!r.ok) return toast.error(r.error ?? "No se pudo confirmar");
    toast.success("Confirmado como Gasto Stand-Alone");
    qc.invalidateQueries({ queryKey: ["iris-movs-sin-proveedor"] });
    qc.invalidateQueries({ queryKey: ["iris-sin-proveedor-count"] });
  };

  const confirmarTodos = async () => {
    if (!movimientos?.length) return;
    if (!window.confirm(`¿Confirmar los ${movimientos.length} movimientos como Gasto Stand-Alone?`)) return;
    setConfirmandoTodos(true);
    let ok = 0;
    for (const m of movimientos) {
      const r = await marcarEstadoConciliacion({ movimientoId: m.id, estado: "gasto_directo", userId: user?.id ?? null });
      if (r.ok) ok++;
    }
    setConfirmandoTodos(false);
    toast.success(`${ok} de ${movimientos.length} confirmados como Gasto Stand-Alone`);
    qc.invalidateQueries({ queryKey: ["iris-movs-sin-proveedor"] });
    qc.invalidateQueries({ queryKey: ["iris-sin-proveedor-count"] });
  };

  const afterSaved = () => {
    setMovimientoEditando(null);
    qc.invalidateQueries({ queryKey: ["iris-movs-sin-proveedor"] });
    qc.invalidateQueries({ queryKey: ["iris-sin-proveedor-count"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/iris"><ArrowLeft className="h-4 w-4 mr-1" />Iris</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Movimientos sin proveedor</h1>
          <p className="text-sm text-muted-foreground">
            Revisa, edita y confirma estos movimientos. Puedes asignar el proveedor correcto desde la edición del movimiento. Montos en USD BCV.
          </p>
        </div>
        {!!movimientos?.length && (
          <Button onClick={confirmarTodos} disabled={confirmandoTodos}>
            <Check className="h-4 w-4 mr-2" />
            {confirmandoTodos ? "Confirmando…" : `Confirmar los ${movimientos.length}`}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground px-4 py-6 text-center">Cargando…</p>
          ) : !movimientos?.length ? (
            <p className="text-sm text-muted-foreground px-4 py-6 text-center">No hay movimientos sin proveedor pendientes de confirmar.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-4">Fecha</th>
                  <th className="text-right py-2 px-4">USD BCV</th>
                  <th className="text-left py-2 px-4">Notas / memo</th>
                  <th className="text-center py-2 px-4 w-48">Acción</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2 px-4 whitespace-nowrap">{fmtDate(m.fecha)}</td>
                    <td className="py-2 px-4 text-right mono">{fmtUsd(usdBcv(m))}</td>
                    <td className="py-2 px-4">{m.notas ?? m.detalle ?? "—"}</td>
                    <td className="py-2 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setMovimientoEditando(m)} disabled={confirmandoTodos}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Editar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => confirmar(m.id)} disabled={confirmandoId === m.id || confirmandoTodos}>
                          <Check className="h-3.5 w-3.5 mr-1" />
                          {confirmandoId === m.id ? "…" : "Confirmar"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {movimientoEditando && (
        <EditDialog
          tx={movimientoEditando}
          onClose={() => setMovimientoEditando(null)}
          onSaved={afterSaved}
        />
      )}
    </div>
  );
}
