import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { Pencil, AlertTriangle, Trash2, Link as LinkIcon } from "lucide-react";
import { fmtUsd, fmtBs } from "@/lib/format";
import { editarInventarioSnapshot, borrarInventarioSnapshot } from "@/lib/inventario.functions";
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/inventarios")({
  component: InventariosPage,
});

function periodoLabel(periodo: string) {
  const [y, m] = periodo.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-VE", { year: "numeric", month: "long" });
}

type Snap = {
  id: string;
  periodo: string;
  tipo: "inicial" | "final";
  monto_usd: number | string | null;
  monto_bs: number | string | null;
  tasa_bcv: number | string | null;
  notas: string | null;
  fecha: string | null;
};

function InventariosPage() {
  const qc = useQueryClient();
  const editar = useServerFn(editarInventarioSnapshot);
  const borrar = useServerFn(borrarInventarioSnapshot);

  const { data: cierres } = useQuery({
    queryKey: ["cierres-de-mes-estado"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cierres_de_mes")
        .select("periodo, estado");
      if (error) throw error;
      return (data ?? []) as { periodo: string; estado: string }[];
    },
  });
  const cierresMap = useMemo(() => {
    const m = new Map<string, string>();
    (cierres ?? []).forEach((c) => m.set(c.periodo, c.estado));
    return m;
  }, [cierres]);
  const isPeriodoCerrado = (periodo: string) => cierresMap.get(periodo) === "cerrado";

  function shiftPeriodo(periodo: string, delta: number) {
    const [y, m] = periodo.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ["inventario-snapshots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventario_snapshots")
        .select("id, periodo, tipo, monto_usd, monto_bs, tasa_bcv, notas, fecha")
        .order("periodo", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Snap[];
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { periodo: string; inicial: Snap | null; final: Snap | null }>();
    (snapshots ?? []).forEach((s) => {
      if (!map.has(s.periodo)) map.set(s.periodo, { periodo: s.periodo, inicial: null, final: null });
      const row = map.get(s.periodo)!;
      if (s.tipo === "inicial") row.inicial = s;
      else if (s.tipo === "final") row.final = s;
    });
    return Array.from(map.values()).sort((a, b) => b.periodo.localeCompare(a.periodo));
  }, [snapshots]);

  const chartData = useMemo(() => {
    return [...grouped]
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .map((r) => ({
        periodo: r.periodo,
        inicial: r.inicial ? Number(r.inicial.monto_usd) || 0 : null,
        final: r.final ? Number(r.final.monto_usd) || 0 : null,
      }));
  }, [grouped]);

  const groupedMap = useMemo(() => {
    const m = new Map<string, { inicial: Snap | null; final: Snap | null }>();
    grouped.forEach((g) => m.set(g.periodo, { inicial: g.inicial, final: g.final }));
    return m;
  }, [grouped]);


  const [editing, setEditing] = useState<Snap | null>(null);
  const [draft, setDraft] = useState({ monto_usd: "", monto_bs: "", tasa_bcv: "", notas: "" });
  const [busy, setBusy] = useState(false);

  const openEdit = (s: Snap | null) => {
    if (!s) return;
    setEditing(s);
    setDraft({
      monto_usd: String(s.monto_usd ?? ""),
      monto_bs: String(s.monto_bs ?? ""),
      tasa_bcv: s.tasa_bcv != null ? String(s.tasa_bcv) : "",
      notas: s.notas ?? "",
    });
  };

  const close = () => {
    setEditing(null);
    setDraft({ monto_usd: "", monto_bs: "", tasa_bcv: "", notas: "" });
  };

  const save = async () => {
    if (!editing) return;
    const s = editing;
    const montoUsd = Number(draft.monto_usd);
    let montoBs = Number(draft.monto_bs);
    const tasa = draft.tasa_bcv ? Number(draft.tasa_bcv) : null;
    if (!Number.isFinite(montoUsd)) return toast.error("Monto USD inválido");
    if (
      tasa &&
      Math.abs(montoUsd - Number(s.monto_usd || 0)) > 0.005 &&
      Math.abs(montoBs - Number(s.monto_bs || 0)) < 0.005
    ) {
      montoBs = Math.round(montoUsd * tasa * 100) / 100;
    }

    const cascadeNext = s.tipo === "final";
    const cascadePrev = s.tipo === "inicial";
    const vecino = cascadeNext ? shiftPeriodo(s.periodo, 1) : shiftPeriodo(s.periodo, -1);
    const cascadeMsg = cascadeNext
      ? `Al modificar el inventario final de ${periodoLabel(s.periodo)}, se actualizará automáticamente el inventario inicial de ${periodoLabel(vecino)} a ${fmtUsd(montoUsd)}.`
      : `Al modificar el inventario inicial de ${periodoLabel(s.periodo)}, se actualizará automáticamente el inventario final de ${periodoLabel(vecino)} a ${fmtUsd(montoUsd)}.`;
    const confirmMsg =
      `Modificar este inventario requiere reabrir el cierre de ${periodoLabel(s.periodo)}, recalcular el COGS y volver a cerrar.\n\n` +
      cascadeMsg +
      `\n\n¿Deseas continuar?`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const r = await editar({
        data: {
          snapshot_id: s.id,
          monto_usd: montoUsd,
          monto_bs: montoBs,
          tasa_bcv: tasa,
          notas: draft.notas || null,
          cascade_next_month: cascadeNext,
          cascade_prev_month: cascadePrev,
        },
      });
      const cogs = r.primary?.cogs_usd ?? 0;
      const msgs = [
        `Inventario actualizado. COGS recalculado: ${fmtUsd(cogs)}. Cierre de ${periodoLabel(s.periodo)} actualizado.`,
      ];
      if (r.cascaded_next) {
        msgs.push(`Cierre de ${periodoLabel(r.cascaded_next.periodo)} recalculado (COGS: ${fmtUsd(r.cascaded_next.cogs_usd)}).`);
      }
      if (r.cascaded_prev) {
        msgs.push(`Cierre de ${periodoLabel(r.cascaded_prev.periodo)} recalculado (COGS: ${fmtUsd(r.cascaded_prev.cogs_usd)}).`);
      }
      toast.success(msgs.join(" "));
      close();
      qc.invalidateQueries({ queryKey: ["inventario-snapshots"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error actualizando inventario");
    } finally {
      setBusy(false);
    }
  };

  const scrollToRow = (periodo: string) => {
    const el = document.getElementById(`inv-row-${periodo}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("bg-accent/40");
    setTimeout(() => el.classList.remove("bg-accent/40"), 1500);
  };



  const handleDelete = async (s: Snap | null) => {
    if (!s) return;
    if (isPeriodoCerrado(s.periodo)) {
      toast.error(`El cierre de ${periodoLabel(s.periodo)} está cerrado. Reábrelo primero.`);
      return;
    }
    let cascade = false;
    if (s.tipo === "final") {
      const next = shiftPeriodo(s.periodo, 1);
      const nextIniExiste = (snapshots ?? []).some(
        (x) => x.periodo === next && x.tipo === "inicial",
      );
      if (nextIniExiste) {
        if (isPeriodoCerrado(next)) {
          toast.error(
            `No se puede borrar: el inicial del mes siguiente (${periodoLabel(next)}) está en un cierre cerrado.`,
          );
          return;
        }
        cascade = confirm(
          `¿Borrar también el inventario INICIAL del mes siguiente (${periodoLabel(next)})?\n\nEstán sincronizados. Recomendado: Aceptar.`,
        );
      }
    }
    const montoTxt = fmtUsd(Number(s.monto_usd) || 0);
    if (
      !confirm(
        `Borrar inventario ${s.tipo.toUpperCase()} de ${periodoLabel(s.periodo)} (${montoTxt}).\n\n¿Continuar?`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await borrar({
        data: { snapshot_id: s.id, cascade_next_month_inicial: cascade },
      });
      toast.success(
        `Inventario ${r.tipo} de ${periodoLabel(r.deleted_periodo)} borrado.` +
          (r.cascaded_periodo
            ? ` También se borró el inicial de ${periodoLabel(r.cascaded_periodo)}.`
            : ""),
      );
      qc.invalidateQueries({ queryKey: ["inventario-snapshots"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error borrando inventario");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventarios</h1>
        <p className="text-sm text-muted-foreground">
          Snapshots de inventario inicial y final por período. Editar recalcula automáticamente el COGS del cierre correspondiente.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolución de inventarios (USD)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Sin snapshots registrados
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="periodo" fontSize={11} />
                  <YAxis tickFormatter={(v) => "$" + Number(v).toLocaleString()} fontSize={11} />
                  <Tooltip formatter={(v: any, name: any) => [v == null ? "—" : fmtUsd(Number(v)), name]} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="inicial"
                    name="Inventario inicial"
                    stroke="hsl(215 20% 55%)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="final"
                    name="Inventario final"
                    stroke="hsl(142 71% 45%)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Snapshots ({grouped.length} períodos)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6">Cargando...</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2" rowSpan={2}>Período</th>
                    <th className="text-center py-2 border-l" colSpan={4}>Inventario inicial</th>
                    <th className="text-center py-2 border-l" colSpan={4}>Inventario final</th>
                  </tr>
                  <tr>
                    <th className="text-right py-2 border-l pl-2">USD</th>
                    <th className="text-right py-2">Bs</th>
                    <th className="text-right py-2">Tasa BCV</th>
                    <th className="text-right py-2 pr-2"></th>
                    <th className="text-right py-2 border-l pl-2">USD</th>
                    <th className="text-right py-2">Bs</th>
                    <th className="text-right py-2">Tasa BCV</th>
                    <th className="text-right py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((row) => (
                    <tr key={row.periodo} className="border-b last:border-0">
                      <td className="py-2 mono">{row.periodo}</td>

                      {/* Inicial */}
                      <td className="py-2 text-right mono border-l pl-2">
                        {row.inicial ? fmtUsd(Number(row.inicial.monto_usd) || 0) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="py-2 text-right mono">
                        {row.inicial ? fmtBs(Number(row.inicial.monto_bs) || 0) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="py-2 text-right mono">
                        {row.inicial?.tasa_bcv != null ? Number(row.inicial.tasa_bcv).toFixed(4) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="py-2 text-right pr-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(row.inicial)}
                            disabled={!row.inicial}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(row.inicial)}
                            disabled={!row.inicial || isPeriodoCerrado(row.periodo) || busy}
                            title={
                              isPeriodoCerrado(row.periodo)
                                ? "Mes cerrado: reábrelo primero"
                                : "Borrar"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>

                      {/* Final */}
                      <td className="py-2 text-right mono border-l pl-2">
                        {row.final ? fmtUsd(Number(row.final.monto_usd) || 0) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="py-2 text-right mono">
                        {row.final ? fmtBs(Number(row.final.monto_bs) || 0) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="py-2 text-right mono">
                        {row.final?.tasa_bcv != null ? Number(row.final.tasa_bcv).toFixed(4) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="py-2 text-right pr-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(row.final)}
                            disabled={!row.final}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(row.final)}
                            disabled={!row.final || isPeriodoCerrado(row.periodo) || busy}
                            title={
                              isPeriodoCerrado(row.periodo)
                                ? "Mes cerrado: reábrelo primero"
                                : "Borrar"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {grouped.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted-foreground">
                        Sin snapshots registrados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-yellow-500/40 bg-yellow-50/50 dark:bg-yellow-950/20">
        <CardContent className="py-4 flex gap-3 items-start">
          <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            Editar un inventario reabre el cierre del período, recalcula el COGS con la fórmula{" "}
            <code className="text-foreground">inventario_inicial + compras (2.1) − inventario_final</code>,
            regenera la transacción 2.2 y vuelve a cerrar automáticamente. Si editas un inventario final,
            también se sincroniza el inicial del mes siguiente y se recalcula su cierre.
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!editing} onOpenChange={(o) => (!o ? close() : null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {editing && (
            <>
              <SheetHeader>
                <SheetTitle>
                  Editar inventario {editing.tipo === "inicial" ? "inicial" : "final"} — {periodoLabel(editing.periodo)}
                </SheetTitle>
                <SheetDescription>
                  Ajusta el monto y la tasa. Al guardar se reabre el cierre y se recalcula el COGS automáticamente.
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-1.5">
                  <Label>Monto USD</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={draft.monto_usd}
                    onChange={(e) => setDraft((d) => ({ ...d, monto_usd: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tasa BCV</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={draft.tasa_bcv}
                    onChange={(e) => setDraft((d) => ({ ...d, tasa_bcv: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Monto Bs</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={draft.monto_bs}
                    onChange={(e) => setDraft((d) => ({ ...d, monto_bs: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Si cambias el USD y dejas el Bs sin tocar, se recalcula con la tasa.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Notas</Label>
                  <Textarea
                    rows={3}
                    value={draft.notas}
                    onChange={(e) => setDraft((d) => ({ ...d, notas: e.target.value }))}
                  />
                </div>

                <div className="rounded-md border border-yellow-500/40 bg-yellow-50/50 dark:bg-yellow-950/20 p-3 flex gap-2 items-start">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    Se reabrirá el cierre de <strong>{periodoLabel(editing.periodo)}</strong>, se recalculará el COGS y se volverá a cerrar.
                    {editing.tipo === "final" && (
                      <> También se sincronizará el inventario inicial del mes siguiente (si existe) y se recalculará su cierre.</>
                    )}
                  </div>
                </div>
              </div>

              <SheetFooter className="gap-2">
                <Button variant="ghost" onClick={close} disabled={busy}>Cancelar</Button>
                <Button onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
