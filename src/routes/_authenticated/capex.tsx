import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { MESES } from "@/lib/account-helpers";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/capex")({ component: CapExPage });

function CapExPage() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState<number>(anioActual);
  const [centro, setCentro] = useState<string>("Todos");

  const { data: txs } = useQuery({
    queryKey: ["capex-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, centro_costo, monto_bs, monto_usd, notas, numero_factura, referencia, metodo_pago, modo, tercero_id")
        .eq("cuenta_codigo", "10.6")
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
    return (txs ?? []).filter((t: any) => {
      const y = new Date(t.fecha).getUTCFullYear();
      if (y !== anio) return false;
      if (centro !== "Todos" && t.centro_costo !== centro) return false;
      return true;
    });
  }, [txs, anio, centro]);

  const chartData = useMemo(() => {
    const buckets = MESES.map((m, i) => ({ mes: m, idx: i, YV: 0, Bocu: 0, Compartido: 0, total: 0 }));
    filtered.forEach((t: any) => {
      const d = new Date(t.fecha);
      const i = d.getUTCMonth();
      const usd = Number(t.monto_usd) || 0;
      const cc = String(t.centro_costo);
      if (cc === "YV" || cc === "Bocu" || cc === "Compartido") {
        (buckets[i] as any)[cc] += usd;
      }
      buckets[i].total += usd;
    });
    return buckets;
  }, [filtered]);

  const totalUsd = filtered.reduce((s: number, t: any) => s + (Number(t.monto_usd) || 0), 0);
  const totalBs = filtered.reduce((s: number, t: any) => s + (Number(t.monto_bs) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CapEx</h1>
          <p className="text-sm text-muted-foreground">Inversiones en activo fijo (cuenta 10.6)</p>
        </div>
        <div className="flex gap-2">
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{anios.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={centro} onValueChange={setCentro}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Todos">Todos los centros</SelectItem>
              <SelectItem value="YV">YV</SelectItem>
              <SelectItem value="Bocu">Bocú</SelectItem>
              <SelectItem value="Compartido">Compartido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total USD</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total Bs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtBs(totalBs)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Movimientos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{filtered.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">CapEx por mes ({anio})</CardTitle></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                <Legend />
                <Bar dataKey="YV" stackId="a" fill="#534AB7" />
                <Bar dataKey="Bocu" stackId="a" fill="#0F6E56" />
                <Bar dataKey="Compartido" stackId="a" fill="#E8A87C" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle</CardTitle></CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin CapEx registrados en el período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-left py-2 px-2">Descripción</th>
                    <th className="text-left py-2 px-2">N° Factura</th>
                    <th className="text-left py-2 px-2">Método</th>
                    <th className="text-right py-2 px-2">Bs</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Modo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t: any) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 px-2 mono">{fmtDate(t.fecha)}</td>
                      <td className="py-2 px-2">{t.centro_costo}</td>
                      <td className="py-2 px-2">{t.notas ?? "—"}</td>
                      <td className="py-2 px-2 mono text-xs">{t.numero_factura ?? "—"}</td>
                      <td className="py-2 px-2 text-xs">{t.metodo_pago ?? "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(t.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(t.monto_usd)}</td>
                      <td className="py-2 px-2">
                        {t.modo === "off_balance"
                          ? <Badge variant="outline" className="text-orange-600 border-orange-300">off</Badge>
                          : <Badge variant="outline">on</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t">
                    <td colSpan={5} className="py-2 px-2 text-right">Total</td>
                    <td className="py-2 px-2 text-right mono">{fmtBs(totalBs)}</td>
                    <td className="py-2 px-2 text-right mono">{fmtUsd(totalUsd)}</td>
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
