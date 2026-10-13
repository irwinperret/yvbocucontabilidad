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
import { fmtUsd, fmtDate } from "@/lib/format";
import {
  analizarReversion,
  ejecutarReversion,
  purgarRevertidas,
  purgarImportacionRevertida,
  listarResiduos,
  purgarResiduos,
  ORIGEN_LABEL,
  TIPO_LABEL,
  type ImportBatch,
  type RevertPlan,
} from "@/lib/import-batches";
import {
  MAPEO_PROVEEDORES_2_1,
  backfillReclasificacionProveedores2_1,
  resumenBackfillProveedores,
  type ResultadoBackfillProveedores,
} from "@/lib/backfill-proveedores-2-1";
import {
  fetchCambiosAuditoria,
  revertirCambioAuditoria,
  resumenRevertirCambios,
  type CambioAuditoria,
  type ResultadoRevertirCambio,
} from "@/lib/revertir-auditoria";
import { fetchPeriodosCerrados } from "@/lib/home-checklist";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [purgeTarget, setPurgeTarget] = useState<ImportBatch | null>(null);
  const [purgingOne, setPurgingOne] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<ResultadoBackfillProveedores | null>(null);

  const [histDesde, setHistDesde] = useState("");
  const [histHasta, setHistHasta] = useState("");
  const [cambios, setCambios] = useState<CambioAuditoria[]>([]);
  const [buscandoCambios, setBuscandoCambios] = useState(false);
  const [seleccionCambios, setSeleccionCambios] = useState<Set<string>>(new Set());
  const [confirmRevertirOpen, setConfirmRevertirOpen] = useState(false);
  const [revirtiendoCambios, setRevirtiendoCambios] = useState(false);
  const [resultadoRevertir, setResultadoRevertir] = useState<ResultadoRevertirCambio[] | null>(null);


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

  const confirmarPurgaUna = async () => {
    if (!purgeTarget) return;
    setPurgingOne(true);
    const res = await purgarImportacionRevertida(purgeTarget.id);
    setPurgingOne(false);
    if (!res.ok) return toast.error(res.error ?? "No se pudo borrar la carga");
    toast.success("Carga borrada definitivamente del historial");
    setPurgeTarget(null);
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

  const confirmarBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await backfillReclasificacionProveedores2_1();
      setBackfillResult(res);
      toast.success(resumenBackfillProveedores(res));
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo ejecutar la reclasificación");
    } finally {
      setBackfilling(false);
    }
  };

  const toLocalInputValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const buscarCambios = async (desdeIso: string, hastaIso: string) => {
    setBuscandoCambios(true);
    try {
      const res = await fetchCambiosAuditoria({ desde: desdeIso, hasta: hastaIso });
      setCambios(res);
      setSeleccionCambios(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo buscar el historial de cambios");
    } finally {
      setBuscandoCambios(false);
    }
  };

  const aplicarVentanaRapida = (minutos: number) => {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - minutos * 60000);
    setHistDesde(toLocalInputValue(desde));
    setHistHasta(toLocalInputValue(hasta));
    buscarCambios(desde.toISOString(), hasta.toISOString());
  };

  const buscarConFormulario = () => {
    if (!histDesde || !histHasta) return toast.error("Completa ambas fechas");
    const desde = new Date(histDesde);
    const hasta = new Date(histHasta);
    if (desde > hasta) return toast.error("La fecha \"desde\" no puede ser posterior a \"hasta\"");
    buscarCambios(desde.toISOString(), hasta.toISOString());
  };

  const toggleSeleccionCambio = (id: string, v: boolean) => {
    setSeleccionCambios((s) => {
      const next = new Set(s);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const confirmarRevertirCambios = async () => {
    setRevirtiendoCambios(true);
    try {
      const periodosCerrados = await fetchPeriodosCerrados();
      const seleccionados = cambios.filter((c) => seleccionCambios.has(c.id));
      const resultados: ResultadoRevertirCambio[] = [];
      for (const c of seleccionados) {
        resultados.push(await revertirCambioAuditoria(c, periodosCerrados));
      }
      setResultadoRevertir(resultados);
      toast.success(resumenRevertirCambios(resultados));
      qc.invalidateQueries();
      if (histDesde && histHasta) {
        buscarCambios(new Date(histDesde).toISOString(), new Date(histHasta).toISOString());
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo deshacer los cambios seleccionados");
    } finally {
      setRevirtiendoCambios(false);
    }
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
                    {b.estado === "revertida" && isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPurgeTarget(b)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Borrar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Reclasificación histórica · compras en 2.1</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Corrige retroactivamente la cuenta de las compras de Xetux que quedaron en 2.1 -- Compras de
                  mercancía, para 5 proveedores ya confirmados, sin tocar los demás ni los meses cerrados.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBackfillResult(null);
                  setBackfillOpen(true);
                }}
              >
                Reclasificar proveedores
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deshacer cambios recientes (auditoría)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Busca los cambios registrados en una ventana de tiempo -- útil justo después de correr un
              backfill o script que haya salido mal -- y deshace los que quieras. Solo se restauran los
              campos que cambiaron, y nunca si ya fueron modificados otra vez después.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Desde</label>
                <Input
                  type="datetime-local"
                  value={histDesde}
                  onChange={(e) => setHistDesde(e.target.value)}
                  className="w-56"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Hasta</label>
                <Input
                  type="datetime-local"
                  value={histHasta}
                  onChange={(e) => setHistHasta(e.target.value)}
                  className="w-56"
                />
              </div>
              <Button size="sm" onClick={buscarConFormulario} disabled={buscandoCambios}>
                {buscandoCambios ? "Buscando…" : "Buscar"}
              </Button>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => aplicarVentanaRapida(15)}>
                  Últimos 15 min
                </Button>
                <Button size="sm" variant="outline" onClick={() => aplicarVentanaRapida(60)}>
                  Última hora
                </Button>
                <Button size="sm" variant="outline" onClick={() => aplicarVentanaRapida(60 * 24)}>
                  Últimas 24h
                </Button>
              </div>
            </div>

            {cambios.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{cambios.length} cambio(s) encontrados.</p>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={seleccionCambios.size === 0}
                    onClick={() => {
                      setResultadoRevertir(null);
                      setConfirmRevertirOpen(true);
                    }}
                  >
                    Deshacer seleccionados ({seleccionCambios.size})
                  </Button>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tabla</TableHead>
                        <TableHead>Acción</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Qué cambió</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cambios.map((c) => {
                        const soportado = c.accion === "UPDATE" && !!c.registro_id && c.diffs.length > 0;
                        return (
                          <TableRow key={c.id}>
                            <TableCell>
                              <Checkbox
                                checked={seleccionCambios.has(c.id)}
                                disabled={!soportado}
                                onCheckedChange={(v) => toggleSeleccionCambio(c.id, Boolean(v))}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{fmtFecha(c.created_at)}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{c.tabla}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{c.accion}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {emailById.get(c.user_id ?? "") ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {soportado ? (
                                c.diffs.map((d) => (
                                  <div key={d.campo}>
                                    <span className="font-medium">{d.campo}</span>: {JSON.stringify(d.antes)} →{" "}
                                    {JSON.stringify(d.despues)}
                                  </div>
                                ))
                              ) : (
                                <span className="text-muted-foreground">
                                  {c.accion === "UPDATE" ? "sin campos detectables" : `${c.accion} -- no soportado aquí`}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            {!buscandoCambios && cambios.length === 0 && histDesde && histHasta && (
              <p className="text-sm text-muted-foreground">Sin cambios en esa ventana.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Residuos de importaciones</CardTitle>
              <p className="text-sm text-muted-foreground">
                Transacciones de origen importado (movimientos bancarios, compras Xetux) que quedaron
                sin carga asociada y por eso no se borran al revertir. No incluye registros manuales ni standby.
              </p>
            </div>
            {isAdmin && residuos.length > 0 && (
              <Button size="sm" variant="destructive" onClick={() => setResiduosOpen(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Borrar residuos ({residuos.length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Bs</TableHead>
                <TableHead className="text-right">USD</TableHead>
                <TableHead>Referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingResiduos && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">Cargando…</TableCell>
                </TableRow>
              )}
              {!loadingResiduos && residuos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No hay residuos: todo lo importado está asociado a una carga.
                  </TableCell>
                </TableRow>
              )}
              {residuos.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.fecha)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant="secondary">{ORIGEN_LABEL[r.origen]}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.cuenta_codigo}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(Number(r.monto_bs) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUsd(Number(r.monto_usd) || 0)}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs" title={r.referencia ?? ""}>
                    {r.referencia ?? "—"}
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

      <AlertDialog open={!!purgeTarget} onOpenChange={(o) => !o && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar esta carga revertida</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {purgeTarget ? `${TIPO_LABEL[purgeTarget.tipo] ?? purgeTarget.tipo} · ${purgeTarget.archivo_nombre}` : ""}
                </p>
                <p>
                  Se eliminará del historial esta carga ya revertida, junto con cualquier resto que hubiera
                  quedado asociado (transacciones, cuentas por pagar/cobrar, propinas y conciliaciones).
                </p>
                <p className="text-muted-foreground">Esta acción no se puede deshacer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgingOne}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={purgingOne}
              onClick={(e) => {
                e.preventDefault();
                confirmarPurgaUna();
              }}
            >
              {purgingOne ? "Borrando…" : "Sí, borrar definitivamente"}
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

      <AlertDialog open={residuosOpen} onOpenChange={(o) => !o && setResiduosOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar residuos de importaciones</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Se eliminarán {residuos.length} transacciones de origen importado que quedaron sin carga
                  asociada, junto con sus conciliaciones, diferenciales cambiarios y cuentas por pagar creadas.
                  Las facturas que hayan sido pagadas por estos movimientos vuelven a "pendiente".
                </p>
                <p className="text-muted-foreground">
                  No se tocan registros manuales, transacciones en standby ni meses cerrados. Esta acción no se
                  puede deshacer.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgingResiduos}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={purgingResiduos}
              onClick={(e) => {
                e.preventDefault();
                confirmarPurgaResiduos();
              }}
            >
              {purgingResiduos ? "Borrando…" : "Sí, borrar residuos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={backfillOpen}
        onOpenChange={(o) => {
          if (backfilling) return;
          setBackfillOpen(o);
          if (!o) setBackfillResult(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reclasificación histórica de proveedores (2.1)</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {!backfillResult ? (
                  <>
                    <p>
                      Se buscarán todas las compras de estos proveedores que sigan en 2.1 -- Compras de
                      mercancía (en cualquier mes) y se reclasificarán a:
                    </p>
                    <ul className="list-disc pl-5">
                      {MAPEO_PROVEEDORES_2_1.map((m) => (
                        <li key={m.razonSocial}>
                          {m.razonSocial} → {m.cuenta} ({m.cuentaLabel})
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">
                      Se respetan los meses ya cerrados (se reportan, no se tocan) y cada cambio queda
                      registrado en auditoría, igual que cualquier otra edición.
                    </p>
                  </>
                ) : (
                  <>
                    <p>{resumenBackfillProveedores(backfillResult)}</p>
                    {backfillResult.items.length > 0 && (
                      <ul className="list-disc pl-5 max-h-48 overflow-y-auto">
                        {backfillResult.items.map((it) => (
                          <li key={it.transaccionId}>
                            {it.proveedor} · {it.fecha} · {it.resultado.status}
                            {it.resultado.status === "reclasificada" ? ` (${it.resultado.de} → ${it.resultado.a})` : ""}
                            {it.resultado.status === "mes_cerrado" ? ` (${it.resultado.periodo})` : ""}
                            {it.resultado.status === "conflicto" ? ` (actual ${it.resultado.actual}, sugerida ${it.resultado.sugerida})` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {!backfillResult ? (
              <>
                <AlertDialogCancel disabled={backfilling}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={backfilling}
                  onClick={(e) => {
                    e.preventDefault();
                    confirmarBackfill();
                  }}
                >
                  {backfilling ? "Reclasificando…" : "Sí, reclasificar"}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setBackfillOpen(false);
                  setBackfillResult(null);
                }}
              >
                Cerrar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRevertirOpen}
        onOpenChange={(o) => {
          if (revirtiendoCambios) return;
          setConfirmRevertirOpen(o);
          if (!o) setResultadoRevertir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deshacer cambios seleccionados</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {!resultadoRevertir ? (
                  <>
                    <p>
                      Se restaurará el valor anterior de estos campos, solo si no fueron tocados otra vez
                      después:
                    </p>
                    <ul className="list-disc pl-5 max-h-48 overflow-y-auto">
                      {cambios
                        .filter((c) => seleccionCambios.has(c.id))
                        .map((c) => (
                          <li key={c.id}>
                            {c.tabla} · {fmtFecha(c.created_at)}
                            {c.diffs
                              .map((d) => ` · ${d.campo}: ${JSON.stringify(d.despues)} → ${JSON.stringify(d.antes)}`)
                              .join("")}
                          </li>
                        ))}
                    </ul>
                    <p className="text-muted-foreground">
                      Esta acción no se puede deshacer por sí misma, pero queda registrada en auditoría.
                    </p>
                  </>
                ) : (
                  <p>{resumenRevertirCambios(resultadoRevertir)}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {!resultadoRevertir ? (
              <>
                <AlertDialogCancel disabled={revirtiendoCambios}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={revirtiendoCambios}
                  onClick={(e) => {
                    e.preventDefault();
                    confirmarRevertirCambios();
                  }}
                >
                  {revirtiendoCambios ? "Deshaciendo…" : "Sí, deshacer"}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmRevertirOpen(false);
                  setResultadoRevertir(null);
                }}
              >
                Cerrar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
