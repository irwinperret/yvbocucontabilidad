import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Undo2, Loader2, Trash2 } from "lucide-react";
import { fmtUsd } from "@/lib/format";
import {
  analizarReversion,
  ejecutarReversion,
  purgarRevertidas,
  listarResiduos,
  purgarResiduos,
  ORIGEN_LABEL,
  TIPO_LABEL,
  type ImportBatch,
  type RevertPlan,
} from "@/lib/import-batches";

export const Route = createFileRoute("/_authenticated/importaciones")({
  component: ImportacionesPage,
  head: () => ({
    meta: [
      { title: "Historial de importaciones | Contabilidad YV/Bocu" },
      { name: "description", content: "Registro de cada carga de reportes de ventas, compras y movimientos bancarios, con opción de revertir." },
      { property: "og:title", content: "Historial de importaciones" },
      { property: "og:description", content: "Revisa y revierte las cargas de reportes importados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });

function ImportacionesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [plan, setPlan] = useState<RevertPlan | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [reverting, setReverting] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [residuosOpen, setResiduosOpen] = useState(false);
  const [purgingResiduos, setPurgingResiduos] = useState(false);


  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("has_role", { _user_id: user!.id, _role: "admin" });
      return !!data;
    },
  });

  const { data: perfiles = [] } = useQuery({
    queryKey: ["perfiles-importaciones"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, email");
      return data ?? [];
    },
  });
  const emailById = new Map((perfiles as any[]).map((p) => [p.id, p.email]));

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["importaciones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("importaciones" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ImportBatch[];
    },
  });

  const abrirReversion = async (b: ImportBatch) => {
    setLoadingId(b.id);
    try {
      const p = await analizarReversion(b);
      setPlan(p);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo analizar la carga");
    } finally {
      setLoadingId(null);
    }
  };

  const confirmarReversion = async () => {
    if (!plan || !user) return;
    setReverting(true);
    const res = await ejecutarReversion(plan, user.id);
    setReverting(false);
    if (!res.ok) return toast.error(res.error ?? "Error al revertir");
    toast.success("Carga revertida correctamente");
    setPlan(null);
    qc.invalidateQueries();
  };

  const revertidas = batches.filter((b) => b.estado === "revertida");

  const confirmarPurga = async () => {
    setPurging(true);
    const res = await purgarRevertidas();
    setPurging(false);
    if (!res.ok) return toast.error(res.error ?? "No se pudieron borrar las cargas revertidas");
    const r = res.resumen;
    toast.success(
      r
        ? `Se borraron ${r.cargas} cargas revertidas (${r.transacciones} transacciones, ${r.cxp} CxP, ${r.cxc} CxC, ${r.propinas} propinas, ${r.conciliaciones} conciliaciones).`
        : "Cargas revertidas borradas"
    );
    setPurgeOpen(false);
    qc.invalidateQueries();
  };

  const { data: residuos = [], isLoading: loadingResiduos } = useQuery({
    queryKey: ["import-residuos"],
    queryFn: listarResiduos,
  });

  const confirmarPurgaResiduos = async () => {
    setPurgingResiduos(true);
    const res = await purgarResiduos(residuos.map((r) => r.id));
    setPurgingResiduos(false);
    if (!res.ok) return toast.error(res.error ?? "No se pudieron borrar los residuos");
    const r = res.resumen;
    toast.success(
      r
        ? `Se borraron ${r.transacciones} transacciones huérfanas (${r.conciliaciones} conciliaciones, ${r.cxp} CxP eliminadas, ${r.cxp_restauradas} facturas restauradas a pendiente).`
        : "Residuos borrados"
    );
    setResiduosOpen(false);
    qc.invalidateQueries();
  };



  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Historial de importaciones</h1>
        <p className="text-sm text-muted-foreground">
          Cada carga de reporte de ventas, compras o movimientos bancarios queda registrada aquí y se puede revertir por completo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Cargas registradas</CardTitle>
            {isAdmin && revertidas.length > 0 && (
              <Button size="sm" variant="destructive" onClick={() => setPurgeOpen(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Borrar revertidas ({revertidas.length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Archivo</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Periodo</TableHead>
                <TableHead className="text-right">Filas</TableHead>
                <TableHead className="text-right">Total USD</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">Cargando…</TableCell>
                </TableRow>
              )}
              {!isLoading && batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    Aún no hay importaciones registradas. El historial arranca con la próxima carga.
                  </TableCell>
                </TableRow>
              )}
              {batches.map((b) => (
                <TableRow key={b.id} className={b.estado === "revertida" ? "opacity-60" : ""}>
                  <TableCell className="whitespace-nowrap">{fmtFecha(b.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">{TIPO_LABEL[b.tipo] ?? b.tipo}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={b.archivo_nombre}>{b.archivo_nombre}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{emailById.get(b.created_by ?? "") ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {b.fecha_desde ? `${b.fecha_desde} → ${b.fecha_hasta ?? b.fecha_desde}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.filas_registradas}
                    {b.filas_omitidas > 0 && (
                      <span className="text-muted-foreground text-xs"> ({b.filas_omitidas} omitidas)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUsd(Number(b.total_usd) || 0)}</TableCell>
                  <TableCell>
                    {b.estado === "revertida" ? (
                      <Badge variant="secondary">
                        Revertida {b.reverted_at ? `· ${fmtFecha(b.reverted_at)}` : ""}
                      </Badge>
                    ) : (
                      <Badge>Activa</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {b.estado !== "revertida" && isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loadingId === b.id}
                        onClick={() => abrirReversion(b)}
                      >
                        {loadingId === b.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Undo2 className="mr-1 h-4 w-4" /> Revertir
                          </>
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!plan} onOpenChange={(o) => !o && setPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revertir esta importación</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {plan ? `${TIPO_LABEL[plan.batch.tipo] ?? plan.batch.tipo} · ${plan.batch.archivo_nombre}` : ""}
                </p>
                {plan?.bloqueoMesCerrado ? (
                  <p className="text-destructive">
                    Hay transacciones en un mes cerrado ({plan.bloqueoMesCerrado}). Reabre el mes antes de revertir.
                  </p>
                ) : (
                  <ul className="list-disc pl-5">
                    <li>Se eliminarán {plan?.transacciones.length ?? 0} transacciones (incluidas sus líneas derivadas).</li>
                    <li>Se eliminarán {plan?.cxpCreadas ?? 0} cuentas por pagar y {plan?.cxcCreadas ?? 0} cuentas por cobrar.</li>
                    <li>Se eliminarán {plan?.propinas ?? 0} propinas.</li>
                    <li>Se restaurarán {plan?.cxpRestaurables ?? 0} facturas a su estado anterior (pendiente/parcial).</li>
                    <li>Se revertirán {plan?.anticiposRevertidos ?? 0} aplicaciones de anticipo.</li>
                  </ul>
                )}
                <p className="text-muted-foreground">Esta acción no se puede deshacer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={reverting || !!plan?.bloqueoMesCerrado}
              onClick={(e) => {
                e.preventDefault();
                confirmarReversion();
              }}
            >
              {reverting ? "Revirtiendo…" : "Sí, revertir todo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeOpen} onOpenChange={(o) => !o && setPurgeOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar cargas revertidas</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Se eliminarán del historial {revertidas.length} carga(s) revertida(s) junto con cualquier
                  resto que hubiera quedado asociado (transacciones, cuentas por pagar/cobrar, propinas y
                  conciliaciones).
                </p>
                <p className="text-muted-foreground">Esta acción no se puede deshacer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={purging}
              onClick={(e) => {
                e.preventDefault();
                confirmarPurga();
              }}
            >
              {purging ? "Borrando…" : "Sí, borrar definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
