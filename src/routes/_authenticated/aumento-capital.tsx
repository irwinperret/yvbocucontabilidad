import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Pencil, Save, X } from "lucide-react";
import {
import { UsdRateBadge } from "@/components/usd-rate-badge";
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
  PieChart, Pie,
} from "recharts";

export const Route = createFileRoute("/_authenticated/aumento-capital")({ component: AumentoCapitalPage });

const PALETTE = ["#534AB7", "#0F6E56", "#E8A87C", "#C38D9E", "#41B3A3", "#F39C12", "#3498DB", "#E74C3C", "#16A085", "#9B59B6", "#34495E", "#D35400"];

function AumentoCapitalPage() {
  const qc = useQueryClient();
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState<string>("Todos");
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({});

  const { data: txs } = useQuery({
    queryKey: ["aumento-capital-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, centro_costo, monto_bs, monto_usd, detalle, notas, metodo_pago, modo")
        .eq("cuenta_codigo", "10.5")
        .order("fecha", { ascending: false });
      return data ?? [];
    },
  });

  const anios = useMemo(() => {
    const s = new Set<number>([anioActual]);
    (txs ?? []).forEach((t: any) => s.add(new Date(t.fecha).getUTCFullYear()));
    return Array.from(s).sort((a, b) => b - a);
  }, [txs, anioActual]);

  const filtered = useMemo(() => {
    if (anio === "Todos") return txs ?? [];
    return (txs ?? []).filter((t: any) => new Date(t.fecha).getUTCFullYear() === Number(anio));
  }, [txs, anio]);

  const porAportante = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((t: any) => {
      const k = (t.detalle?.trim() || "—Sin nombre—");
      m.set(k, (m.get(k) ?? 0) + (Number(t.monto_usd) || 0));
    });
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const totalUsd = filtered.reduce((s: number, t: any) => s + (Number(t.monto_usd) || 0), 0);
  const totalBs = filtered.reduce((s: number, t: any) => s + (Number(t.monto_bs) || 0), 0);

  const startEdit = (t: any) => {
    setEditId(t.id);
    setDraft({
      fecha: t.fecha,
      centro_costo: t.centro_costo,
      monto_usd: String(t.monto_usd ?? ""),
      detalle: t.detalle ?? "",
      notas: t.notas ?? "",
    });
  };

  const cancel = () => { setEditId(null); setDraft({}); };

  const save = async (t: any) => {
    const usdN = Number(draft.monto_usd) || 0;
    if (usdN <= 0) return toast.error("USD debe ser > 0");
    const tasaOrig = Number(t.monto_usd) > 0 ? Number(t.monto_bs) / Number(t.monto_usd) : 1;
    const newBs = usdN * tasaOrig;
    const upd: any = {
      fecha: draft.fecha,
      centro_costo: draft.centro_costo,
      monto_usd: usdN,
      monto_bs: newBs,
      monto_base_bs: newBs,
      detalle: draft.detalle || null,
      notas: draft.notas || null,
    };
    const { error } = await supabase.from("transacciones").update(upd).eq("id", t.id);
    if (error) return toast.error(error.message);
    await logAudit("transacciones", "UPDATE", t.id, t, { ...t, ...upd });
    toast.success("Actualizado");
    cancel();
    qc.invalidateQueries({ queryKey: ["aumento-capital-list"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Aumento de capital</h1>
          <div className="mt-1"><UsdRateBadge /></div>
          <p className="text-sm text-muted-foreground">Aportes de capital social (cuenta 10.5)</p>
        </div>
        <Select value={anio} onValueChange={setAnio}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Todos">Todos los años</SelectItem>
            {anios.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total USD</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total Bs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtBs(totalBs)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Aportantes</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{porAportante.length}</div></CardContent></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Total por aportante (pie)</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                  <Legend />
                  <Pie data={porAportante} dataKey="value" nameKey="name" outerRadius={100} label={(d: any) => `${d.name}: ${fmtUsd(d.value)}`}>
                    {porAportante.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Total por aportante (barras)</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={porAportante} layout="vertical" margin={{ left: 20, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} />
                  <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                  <Bar dataKey="value">
                    {porAportante.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin aumentos de capital registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-left py-2 px-2">Aportante</th>
                    <th className="text-left py-2 px-2">Notas</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-right py-2 px-2">Bs</th>
                    <th className="text-center py-2 px-2 w-24">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t: any) => {
                    const isEd = editId === t.id;
                    return (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-2 px-2 mono">
                          {isEd ? <Input type="date" value={draft.fecha} onChange={(e) => setDraft({ ...draft, fecha: e.target.value })} className="h-7 text-xs" /> : fmtDate(t.fecha)}
                        </td>
                        <td className="py-2 px-2">
                          {isEd ? (
                            <Select value={draft.centro_costo} onValueChange={(v) => setDraft({ ...draft, centro_costo: v })}>
                              <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="YV">YV</SelectItem>
                                <SelectItem value="Bocu">Bocu</SelectItem>
                                <SelectItem value="Compartido">Compartido</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : t.centro_costo}
                        </td>
                        <td className="py-2 px-2">
                          {isEd ? <Input value={draft.detalle} onChange={(e) => setDraft({ ...draft, detalle: e.target.value })} className="h-7 text-xs" /> : (t.detalle ?? "—")}
                        </td>
                        <td className="py-2 px-2 text-xs text-muted-foreground">
                          {isEd ? <Input value={draft.notas} onChange={(e) => setDraft({ ...draft, notas: e.target.value })} className="h-7 text-xs" /> : (t.notas ?? "—")}
                        </td>
                        <td className="py-2 px-2 text-right mono">
                          {isEd ? <Input type="number" step="0.01" value={draft.monto_usd} onChange={(e) => setDraft({ ...draft, monto_usd: e.target.value })} className="h-7 text-xs text-right w-28" /> : fmtUsd(t.monto_usd)}
                        </td>
                        <td className="py-2 px-2 text-right mono text-xs text-muted-foreground">{fmtBs(t.monto_bs)}</td>
                        <td className="py-2 px-2 text-center">
                          {isEd ? (
                            <div className="flex gap-1 justify-center">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => save(t)}><Save className="h-3.5 w-3.5" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancel}><X className="h-3.5 w-3.5" /></Button>
                            </div>
                          ) : (
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t">
                    <td colSpan={4} className="py-2 px-2 text-right">Total</td>
                    <td className="py-2 px-2 text-right mono">{fmtUsd(totalUsd)}</td>
                    <td className="py-2 px-2 text-right mono">{fmtBs(totalBs)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
