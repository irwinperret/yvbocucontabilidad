import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { fmtUsd } from "@/lib/format";
import { toast } from "sonner";
import { Lock, LockOpen, Pencil, Loader2, Info } from "lucide-react";
import { calcularYGuardarCierre, reabrirMes } from "@/lib/cierre-mes";
import { editarInventarioSnapshot } from "@/lib/inventario.functions";

export const Route = createFileRoute("/_authenticated/cierres-de-mes")({ component: CierresDeMesPage });

function periodoLabel(periodo: string) {
  const [y, m] = periodo.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-VE", { year: "numeric", month: "long" });
}
function shiftPeriodo(periodo: string, delta: number) {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type FilaMes = {
  periodo: string;
  cerrado: boolean;
  invIniUsd: number | null;
  invFinUsd: number | null;
  invFinId: string | null;
  invFinTasaBcv: number | null;
  cogsBs: number | null;
  cogsUsdBcv: number | null;
  cogsUsdParalelo: number | null;
  registradoPor: string | null;
  actualizadoEn: string | null;
};

function CierresDeMesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const editarSnapshot = useServerFn(editarInventarioSnapshot);

  const [cerrando, setCerrando] = useState<{ periodo: string; sugerido: string } | null>(null);
  const [editando, setEditando] = useState<{ periodo: string; snapshotId: string | null; valorActual: number | null; tasaBcv: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: cierres } = useQuery({
    queryKey: ["cierres-de-mes-lista"],
    queryFn: async () => {
      const { data } = await supabase.from("cierres_de_mes").select("*").order("periodo");
      return data ?? [];
    },
  });

  const { data: snapshots } = useQuery({
    queryKey: ["inventario-snapshots-lista"],
    queryFn: async () => {
      const { data } = await supabase.from("inventario_snapshots").select("id, periodo, tipo, monto_usd, tasa_bcv").order("periodo");
      return data ?? [];
    },
  });

  const { data: primeraFecha } = useQuery({
    queryKey: ["primera-fecha-transaccion"],
    queryFn: async () => {
      const { data } = await supabase.from("transacciones").select("fecha").order("fecha", { ascending: true }).limit(1).maybeSingle();
      return data?.fecha ?? null;
    },
  });

  const filas: FilaMes[] = useMemo(() => {
    if (!primeraFecha) return [];
    const inicio = String(primeraFecha).slice(0, 7);
    const hoy = new Date();
    const actual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;

    const periodos: string[] = [];
    let p = inicio;
    while (p <= actual) {
      periodos.push(p);
      p = shiftPeriodo(p, 1);
    }

    const cierrePorPeriodo = new Map((cierres ?? []).map((c: any) => [c.periodo, c]));
    const snapPorPeriodoTipo = new Map((snapshots ?? []).map((s: any) => [`${s.periodo}::${s.tipo}`, s]));

    return periodos.map((periodo) => {
      const c: any = cierrePorPeriodo.get(periodo);
      const inicial: any = snapPorPeriodoTipo.get(`${periodo}::inicial`);
      const final: any = snapPorPeriodoTipo.get(`${periodo}::final`);
      return {
        periodo,
        cerrado: c?.estado === "cerrado",
        invIniUsd: inicial ? Number(inicial.monto_usd) : null,
        invFinUsd: final ? Number(final.monto_usd) : null,
        invFinId: final?.id ?? null,
        invFinTasaBcv: final ? Number(final.tasa_bcv) || null : null,
        cogsBs: c ? Number(c.cogs_bs) : null,
        cogsUsdBcv: c ? Number(c.cogs_usd) : null,
        cogsUsdParalelo: c && c.cogs_usd_paralelo != null ? Number(c.cogs_usd_paralelo) : null,
        registradoPor: c?.registrado_por ?? null,
        actualizadoEn: c?.updated_at ?? c?.created_at ?? null,
      };
    }).reverse(); // más reciente primero
  }, [cierres, snapshots, primeraFecha]);

  const abrirCerrar = (fila: FilaMes) => {
    setCerrando({ periodo: fila.periodo, sugerido: fila.invIniUsd != null ? String(fila.invIniUsd) : "" });
  };

  const confirmarCierre = async (invFinUsdStr: string) => {
    if (!cerrando || !user) return;
    const invFinUsd = Number(invFinUsdStr);
    if (!Number.isFinite(invFinUsd) || invFinUsd < 0) return toast.error("Ingresa un monto válido en USD");
    // Inventario inicial = final del mes anterior (misma convención que Registrar).
    const filaAnterior = filas.find((f) => f.periodo === shiftPeriodo(cerrando.periodo, -1));
    const invIniUsd = filaAnterior?.invFinUsd ?? 0;
    setBusy(true);
    try {
      const r = await calcularYGuardarCierre(cerrando.periodo, invIniUsd, invFinUsd, user.id);
      toast.success(`${periodoLabel(cerrando.periodo)} cerrado. COGS (BCV): ${fmtUsd(r.cogsUsdBcv)} · COGS (paralelo): ${fmtUsd(r.cogsUsdParalelo)}`);
      setCerrando(null);
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmarReabrir = async (periodo: string) => {
    if (!confirm(`¿Reabrir ${periodoLabel(periodo)}? Se eliminará el cierre actual y podrás editar transacciones y volver a cerrarlo.`)) return;
    setBusy(true);
    try {
      await reabrirMes(periodo);
      toast.success(`${periodoLabel(periodo)} reabierto`);
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const guardarEdicionInventario = async (nuevoValorStr: string) => {
    if (!editando || !user) return;
    const nuevoValor = Number(nuevoValorStr);
    if (!Number.isFinite(nuevoValor) || nuevoValor < 0) return toast.error("Ingresa un monto válido en USD");
    setBusy(true);
    try {
      if (editando.snapshotId) {
        // Ya existía snapshot final de este mes: usa el mismo flujo que la
        // pantalla de Inventarios (recalcula COGS y sincroniza el mes
        // siguiente automáticamente). editarInventarioSnapshot NO recalcula
        // monto_bs por su cuenta, así que hay que mandarlo ya convertido.
        let tasa = editando.tasaBcv;
        if (!tasa) {
          const finDate = new Date(`${editando.periodo}-01T00:00:00`);
          finDate.setMonth(finDate.getMonth() + 1);
          finDate.setDate(0);
          const { tasaBcvQuery } = await import("@/lib/tasas");
          const { data } = await tasaBcvQuery(finDate.toISOString().slice(0, 10), "tasa");
          tasa = Number((data as any)?.tasa) || 0;
        }
        if (!tasa) { toast.error("No hay tasa BCV disponible para ese mes"); setBusy(false); return; }
        await editarSnapshot({
          data: {
            snapshot_id: editando.snapshotId,
            monto_usd: nuevoValor,
            monto_bs: nuevoValor * tasa,
            tasa_bcv: tasa,
            notas: null,
            cascade_next_month: true,
            cascade_prev_month: false,
          },
        });
      } else {
        // No existía todavía: crear vía cierre completo del mes con este valor.
        const filaAnterior = filas.find((f) => f.periodo === shiftPeriodo(editando.periodo, -1));
        const invIniUsd = filaAnterior?.invFinUsd ?? 0;
        await calcularYGuardarCierre(editando.periodo, invIniUsd, nuevoValor, user.id);
      }
      toast.success("Inventario final actualizado");
      setEditando(null);
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cierres de Mes</h1>
        <p className="text-sm text-muted-foreground">Cierra, reabre y ajusta el inventario final de cada mes</p>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-3 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">
            <strong>Todos los valores de inventario en esta pantalla están en USD a tasa BCV.</strong> Modificar el
            inventario final de un mes ya cerrado recalcula automáticamente su COGS y sincroniza el inventario inicial
            del mes siguiente — es el mismo motor que usan Inventarios y Registrar → COGS e Inventario, así que queda
            todo integrado en un solo lugar.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 px-2">Mes</th>
                <th className="text-center py-2 px-2">Estado</th>
                <th className="text-right py-2 px-2">Inv. inicial (USD BCV)</th>
                <th className="text-right py-2 px-2">Inv. final (USD BCV)</th>
                <th className="text-right py-2 px-2">COGS (BCV)</th>
                <th className="text-right py-2 px-2">COGS (paralelo)</th>
                <th className="text-center py-2 px-2 w-40">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.periodo} className="border-b last:border-0 hover:bg-muted/10">
                  <td className="py-2 px-2 font-medium capitalize">{periodoLabel(f.periodo)}</td>
                  <td className="py-2 px-2 text-center">
                    {f.cerrado ? (
                      <Badge className="bg-green-600 gap-1"><Lock className="h-3 w-3" /> Cerrado</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1"><LockOpen className="h-3 w-3" /> Abierto</Badge>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right mono text-muted-foreground">
                    {f.invIniUsd != null ? fmtUsd(f.invIniUsd) : "—"}
                  </td>
                  <td className="py-2 px-2 text-right mono">
                    <div className="flex items-center justify-end gap-1">
                      {f.invFinUsd != null ? fmtUsd(f.invFinUsd) : "—"}
                      <Button
                        size="icon" variant="ghost" className="h-6 w-6"
                        title="Editar inventario final (USD a tasa BCV)"
                        onClick={() => setEditando({ periodo: f.periodo, snapshotId: f.invFinId, valorActual: f.invFinUsd, tasaBcv: f.invFinTasaBcv })}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right mono">{f.cogsUsdBcv != null ? fmtUsd(f.cogsUsdBcv) : "—"}</td>
                  <td className="py-2 px-2 text-right mono">{f.cogsUsdParalelo != null ? fmtUsd(f.cogsUsdParalelo) : "—"}</td>
                  <td className="py-2 px-2 text-center">
                    {f.cerrado ? (
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => confirmarReabrir(f.periodo)} disabled={busy}>
                        <LockOpen className="h-3.5 w-3.5 mr-1" /> Reabrir
                      </Button>
                    ) : (
                      <Button size="sm" className="h-7 px-2" onClick={() => abrirCerrar(f)} disabled={busy}>
                        <Lock className="h-3.5 w-3.5 mr-1" /> Cerrar mes
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">Sin transacciones registradas todavía.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {cerrando && (
        <Dialog open onOpenChange={(o) => !o && setCerrando(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="capitalize">Cerrar {periodoLabel(cerrando.periodo)}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Inventario final — USD a tasa BCV</Label>
                <Input
                  type="number" step="0.01" min="0" className="mono" autoFocus
                  defaultValue={cerrando.sugerido}
                  id="inv-final-cierre"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCerrando(null)}>Cancelar</Button>
              <Button
                disabled={busy}
                onClick={() => {
                  const el = document.getElementById("inv-final-cierre") as HTMLInputElement | null;
                  confirmarCierre(el?.value ?? "");
                }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Cerrar mes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editando && (
        <Dialog open onOpenChange={(o) => !o && setEditando(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="capitalize">Inventario final — {periodoLabel(editando.periodo)}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nuevo valor — USD a tasa BCV</Label>
                <Input
                  type="number" step="0.01" min="0" className="mono" autoFocus
                  defaultValue={editando.valorActual != null ? String(editando.valorActual) : ""}
                  id="inv-final-editar"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Esto recalcula el COGS de {periodoLabel(editando.periodo)} y sincroniza el inventario inicial del mes
                siguiente automáticamente.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button
                disabled={busy}
                onClick={() => {
                  const el = document.getElementById("inv-final-editar") as HTMLInputElement | null;
                  guardarEdicionInventario(el?.value ?? "");
                }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
