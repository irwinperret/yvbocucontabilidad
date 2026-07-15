import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Pencil, Save, X, AlertTriangle } from "lucide-react";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { editarInventarioSnapshot } from "@/lib/inventario.functions";
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

function InventariosPage() {
  const qc = useQueryClient();
  const editar = useServerFn(editarInventarioSnapshot);

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ["inventario-snapshots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventario_snapshots")
        .select("id, periodo, tipo, monto_usd, monto_bs, tasa_bcv, notas, fecha")
        .order("periodo", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ monto_usd: string; monto_bs: string; tasa_bcv: string; notas: string }>({
    monto_usd: "",
    monto_bs: "",
    tasa_bcv: "",
    notas: "",
  });
  const [busy, setBusy] = useState(false);

  const chartData = useMemo(() => {
    const map = new Map<string, any>();
    (snapshots ?? []).forEach((s: any) => {
      if (!map.has(s.periodo)) map.set(s.periodo, { periodo: s.periodo });
      const row = map.get(s.periodo);
      if (s.tipo === "inicial") row.inicial = Number(s.monto_usd) || 0;
      if (s.tipo === "final") row.final = Number(s.monto_usd) || 0;
    });
    return Array.from(map.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
  }, [snapshots]);

  const startEdit = (s: any) => {
    setEditId(s.id);
    setDraft({
      monto_usd: String(s.monto_usd ?? ""),
      monto_bs: String(s.monto_bs ?? ""),
      tasa_bcv: s.tasa_bcv != null ? String(s.tasa_bcv) : "",
      notas: s.notas ?? "",
    });
  };
  const cancel = () => {
    setEditId(null);
    setDraft({ monto_usd: "", monto_bs: "", tasa_bcv: "", notas: "" });
  };

  const save = async (s: any) => {
    const montoUsd = Number(draft.monto_usd);
    let montoBs = Number(draft.monto_bs);
    const tasa = draft.tasa_bcv ? Number(draft.tasa_bcv) : null;
    if (!Number.isFinite(montoUsd)) return toast.error("Monto USD inválido");
    // Si cambió el USD pero no el Bs, recalcular Bs con tasa
    if (tasa && Math.abs(montoUsd - Number(s.monto_usd || 0)) > 0.005 && Math.abs(montoBs - Number(s.monto_bs || 0)) < 0.005) {
      montoBs = Math.round(montoUsd * tasa * 100) / 100;
    }

    const cascade = s.tipo === "final";
    const confirmMsg =
      `Modificar este inventario requiere reabrir el cierre de ${periodoLabel(s.periodo)}, recalcular el COGS y volver a cerrar.` +
      (cascade
        ? `\n\nComo es un inventario FINAL, también se actualizará el inventario INICIAL del mes siguiente (si existe) y se recalculará su COGS.`
        : "") +
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
          cascade_next_month: cascade,
        },
      });
      const cogs = r.primary?.cogs_usd ?? 0;
      const msgs = [`Inventario actualizado. COGS recalculado: ${fmtUsd(cogs)}. Cierre de ${periodoLabel(s.periodo)} actualizado automáticamente.`];
      if (r.cascaded) {
        msgs.push(`También se recalculó el cierre de ${periodoLabel(r.cascaded.periodo)} (COGS: ${fmtUsd(r.cascaded.cogs_usd)}).`);
      }
      toast.success(msgs.join(" "));
      cancel();
      qc.invalidateQueries({ queryKey: ["inventario-snapshots"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error actualizando inventario");
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
                  <Tooltip
                    formatter={(v: any, name: any) => [v == null ? "—" : fmtUsd(Number(v)), name]}
                  />
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
          <CardTitle className="text-base">
            Snapshots ({snapshots?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6">Cargando...</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Período</th>
                    <th className="text-left py-2">Tipo</th>
                    <th className="text-right py-2">Monto USD</th>
                    <th className="text-right py-2">Tasa BCV</th>
                    <th className="text-right py-2">Monto Bs</th>
                    <th className="text-left py-2 pl-4">Notas</th>
                    <th className="text-right py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshots ?? []).map((s: any) => {
                    const isEdit = editId === s.id;
                    return (
                      <tr key={s.id} className="border-b last:border-0 align-top">
                        <td className="py-2 mono">{s.periodo}</td>
                        <td className="py-2">
                          <Badge variant={s.tipo === "inicial" ? "outline" : "default"} className={s.tipo === "final" ? "bg-green-600" : ""}>
                            {s.tipo === "inicial" ? "Inicial" : "Final"}
                          </Badge>
                        </td>
                        <td className="py-2 text-right mono">
                          {isEdit ? (
                            <Input
                              type="number"
                              step="0.01"
                              className="h-8 w-28 ml-auto text-right"
                              value={draft.monto_usd}
                              onChange={(e) => setDraft((d) => ({ ...d, monto_usd: e.target.value }))}
                            />
                          ) : (
                            fmtUsd(Number(s.monto_usd) || 0)
                          )}
                        </td>
                        <td className="py-2 text-right mono">
                          {isEdit ? (
                            <Input
                              type="number"
                              step="0.0001"
                              className="h-8 w-28 ml-auto text-right"
                              value={draft.tasa_bcv}
                              onChange={(e) => setDraft((d) => ({ ...d, tasa_bcv: e.target.value }))}
                            />
                          ) : s.tasa_bcv != null ? (
                            Number(s.tasa_bcv).toFixed(4)
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 text-right mono">
                          {isEdit ? (
                            <Input
                              type="number"
                              step="0.01"
                              className="h-8 w-32 ml-auto text-right"
                              value={draft.monto_bs}
                              onChange={(e) => setDraft((d) => ({ ...d, monto_bs: e.target.value }))}
                            />
                          ) : (
                            fmtBs(Number(s.monto_bs) || 0)
                          )}
                        </td>
                        <td className="py-2 pl-4 text-muted-foreground max-w-[240px]">
                          {isEdit ? (
                            <Input
                              className="h-8"
                              value={draft.notas}
                              onChange={(e) => setDraft((d) => ({ ...d, notas: e.target.value }))}
                            />
                          ) : (
                            s.notas || <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {isEdit ? (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" onClick={() => save(s)} disabled={busy}>
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => startEdit(s)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(snapshots ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground">
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
    </div>
  );
}
