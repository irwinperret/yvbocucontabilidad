import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Trash2, PlusCircle, AlertTriangle } from "lucide-react";
import { fmtUsd, fmtBs } from "@/lib/format";
import { useMesCerradoGuard } from "@/lib/mes-cerrado-guard";
import {
  listarReclasificacionesIslr, guardarReclasificacionIslr, borrarReclasificacionIslr,
  migrarLegacyAReclasificacion, periodoDeFecha, type ReclasificacionIslr,
} from "@/lib/retencion-islr-reclass";
import { tasaBcvQuery } from "@/lib/tasas";

export const Route = createFileRoute("/_authenticated/retencion-islr")({
  component: RetencionIslrPage,
});

function periodoLabel(periodo: string) {
  const [y, m] = periodo.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-VE", { year: "numeric", month: "long" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function useTasaForDate(fecha: string) {
  return useQuery({
    queryKey: ["tasa-for", fecha],
    queryFn: async () => {
      const { data } = await tasaBcvQuery(fecha, "*");
      return data;
    },
  });
}

function RetencionIslrPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const ensurePeriodoAbierto = useMesCerradoGuard();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["retencion-islr-reclasificaciones"],
    queryFn: listarReclasificacionesIslr,
  });

  const porPeriodo = useMemo(() => {
    const m = new Map<string, ReclasificacionIslr>();
    (rows ?? []).forEach((r) => {
      const p = periodoDeFecha(r.fecha);
      if (!m.has(p)) m.set(p, r);
    });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const [editing, setEditing] = useState<ReclasificacionIslr | "nuevo" | null>(null);
  const [fecha, setFecha] = useState(todayISO());
  const [montoUsd, setMontoUsd] = useState("");
  const [tasa, setTasa] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSugerida } = useTasaForDate(fecha);

  const openNuevo = () => {
    setEditing("nuevo");
    setFecha(todayISO());
    setMontoUsd("");
    setTasa(tasaSugerida?.tasa ? String(tasaSugerida.tasa) : "");
    setNotas("");
  };

  const openEdit = (r: ReclasificacionIslr) => {
    setEditing(r);
    setFecha(r.fecha);
    setMontoUsd(String(r.montoUsd ?? ""));
    setTasa(String(r.tasaBcv ?? ""));
    setNotas(r.notas ?? "");
  };

  const close = () => setEditing(null);

  const montoUsdN = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  const montoBs = +(montoUsdN * tasaN).toFixed(2);

  const save = async () => {
    if (!user) return;
    if (!montoUsdN) return toast.error("Falta el monto en USD");
    if (!tasaN) return toast.error("Falta la tasa BCV");
    if (!(await ensurePeriodoAbierto(fecha))) return;
    if (editing && editing !== "nuevo" && editing.legacy) {
      return toast.error("Este registro es legacy: corrígelo primero con el botón \"Corregir\" antes de editarlo.");
    }
    setBusy(true);
    try {
      await guardarReclasificacionIslr({
        grupoId: editing !== "nuevo" ? editing?.grupoId : null,
        ids: editing !== "nuevo" && editing?.id48 ? { id95: editing.id95, id48: editing.id48 } : null,
        fecha,
        montoUsd: montoUsdN,
        tasaBcv: tasaN,
        notas: notas || null,
        userId: user.id,
      });
      toast.success("Reclasificación ISLR guardada");
      close();
      qc.invalidateQueries({ queryKey: ["retencion-islr-reclasificaciones"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error guardando");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (r: ReclasificacionIslr) => {
    const periodo = periodoDeFecha(r.fecha);
    if (!confirm(`¿Borrar la reclasificación ISLR de ${periodoLabel(periodo)} (${fmtUsd(r.montoUsd)})? Se borran las dos patas (4.8 y 9.5).`)) return;
    if (!(await ensurePeriodoAbierto(r.fecha))) return;
    try {
      await borrarReclasificacionIslr(r);
      toast.success("Reclasificación borrada");
      qc.invalidateQueries({ queryKey: ["retencion-islr-reclasificaciones"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error borrando");
    }
  };

  const handleCorregir = async (r: ReclasificacionIslr) => {
    if (!user) return;
    if (!confirm(
      `Este registro de ${periodoLabel(periodoDeFecha(r.fecha))} se hizo con el formulario viejo: está solo en 9.5 y con una cuenta bancaria asignada.\n\n` +
      `Al corregirlo: se le quita la cuenta bancaria (no fue un depósito real) y se crea la pata que falta en 4.8 por ${fmtUsd(r.montoUsd)}, para que ese mes también quede bien en Saldos Bancarios y en el G&P.\n\n¿Continuar?`
    )) return;
    if (!(await ensurePeriodoAbierto(r.fecha))) return;
    try {
      await migrarLegacyAReclasificacion(r, user.id);
      toast.success("Registro corregido al nuevo modelo");
      qc.invalidateQueries({ queryKey: ["retencion-islr-reclasificaciones"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error corrigiendo");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Retención ISLR (banco)</h1>
          <p className="text-sm text-muted-foreground">
            Reclasificación mensual: resta de Gastos financieros (4.8) y suma a Retención ISLR (9.5). Afecta FC siempre; afecta G&amp;P solo en la parte que reduce 4.8.
          </p>
        </div>
        <Button onClick={openNuevo}>
          <PlusCircle className="h-4 w-4 mr-1" /> Nuevo mes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reclasificaciones por mes ({porPeriodo.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">Cargando…</p>
          ) : porPeriodo.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Sin registros todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Mes</th>
                    <th className="py-2 pr-4">Fecha</th>
                    <th className="py-2 pr-4 text-right">USD</th>
                    <th className="py-2 pr-4 text-right">Bs</th>
                    <th className="py-2 pr-4">Estado</th>
                    <th className="py-2 pr-4">Notas</th>
                    <th className="py-2 pr-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {porPeriodo.map(([periodo, r]) => (
                    <tr key={periodo} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium capitalize">{periodoLabel(periodo)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.fecha}</td>
                      <td className="py-2 pr-4 text-right mono font-semibold">{fmtUsd(r.montoUsd)}</td>
                      <td className="py-2 pr-4 text-right mono text-muted-foreground">{fmtBs(r.montoBs)}</td>
                      <td className="py-2 pr-4">
                        {r.legacy ? (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <AlertTriangle className="h-3 w-3" /> Legacy, sin pata en 4.8
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-green-700 border-green-300">Completa (4.8 + 9.5)</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground max-w-[200px] truncate">{r.notas}</td>
                      <td className="py-2 pr-2 text-right whitespace-nowrap">
                        {r.legacy ? (
                          <Button size="sm" variant="outline" onClick={() => handleCorregir(r)}>Corregir</Button>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(r)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "nuevo" ? "Nueva reclasificación — Retención ISLR" : "Editar — Retención ISLR"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <Label>Tasa BCV</Label>
              <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} className="mono" />
            </div>
            <div>
              <Label>Monto ISLR retenido (USD)</Label>
              <Input type="number" step="0.01" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} className="mono" />
            </div>
            <div className="rounded-md bg-muted p-3 flex flex-col justify-center">
              <span className="text-xs text-muted-foreground">Bs</span>
              <span className="text-base font-bold mono">{fmtBs(montoBs)}</span>
            </div>
            <div className="col-span-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Se resta este monto a Gastos financieros (4.8) y se suma a Retención ISLR (9.5). No afecta ninguna cuenta bancaria.
            </div>
            <div className="col-span-2">
              <Label>Notas</Label>
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancelar</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
