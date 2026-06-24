import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { MESES, CAPEX_CATEGORIAS } from "@/lib/account-helpers";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { UsdRateBadge } from "@/components/usd-rate-badge";

const OPEX_GROUPS: { key: string; label: string; prefix: string; color: string }[] = [
  { key: "cogs",   label: "COGS (2.x)",            prefix: "2.",  color: "#E74C3C" },
  { key: "nomina", label: "Nómina (3.x)",          prefix: "3.",  color: "#534AB7" },
  { key: "admin",  label: "Administrativos (4.x)", prefix: "4.",  color: "#3498DB" },
  { key: "ops",    label: "Operativos (5.x)",      prefix: "5.",  color: "#0F6E56" },
  { key: "mkt",    label: "Mercadeo (6.x)",        prefix: "6.",  color: "#E8A87C" },
  { key: "fin",    label: "Financieros (7.x)",     prefix: "7.",  color: "#16A085" },
  { key: "inv",    label: "Investigación (8.x)",   prefix: "8.",  color: "#9B59B6" },
  { key: "gen",    label: "Generales (9.x)",       prefix: "9.",  color: "#41B3A3" },
  { key: "imp",    label: "Impuestos (12.x)",      prefix: "12.", color: "#D35400" },
];

export const Route = createFileRoute("/_authenticated/capex")({ component: CapExPage });

const CAT_COLORS: Record<string, string> = {
  "Remodelación/Obra Civil": "#534AB7",
  "Equipos de Cocina": "#0F6E56",
  "Equipos de Sala": "#E8A87C",
  "Mobiliario": "#C38D9E",
  "Utilería": "#41B3A3",
  "Otros": "#85929E",
};

function CapExPage() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState<number>(anioActual);
  const [centro, setCentro] = useState<string>("Todos");
  const [categoria, setCategoria] = useState<string>("Todas");

  const { data: txs } = useQuery({
    queryKey: ["capex-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, centro_costo, monto_bs, monto_usd, notas, numero_factura, referencia, metodo_pago, modo, tercero_id, capex_categoria")
        .eq("cuenta_codigo", "10.6")
        .order("fecha", { ascending: false });
      return data ?? [];
    },
  });

  const { data: opexTxs } = useQuery({
    queryKey: ["opex-by-group", anio],
    queryFn: async () => {
      const desde = `${anio}-01-01`;
      const hasta = `${anio}-12-31`;
      const { data } = await supabase
        .from("transacciones")
        .select("fecha, cuenta_codigo, monto_usd")
        .gte("fecha", desde).lte("fecha", hasta)
        .eq("modo", "on_balance");
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
      if (categoria !== "Todas" && (t.capex_categoria ?? "Otros") !== categoria) return false;
      return true;
    });
  }, [txs, anio, centro, categoria]);

  const chartData = useMemo(() => {
    const buckets = MESES.map((m) => {
      const row: any = { mes: m, total: 0 };
      CAPEX_CATEGORIAS.forEach((c) => { row[c] = 0; });
      return row;
    });
    filtered.forEach((t: any) => {
      const d = new Date(t.fecha);
      const i = d.getUTCMonth();
      const usd = Number(t.monto_usd) || 0;
      const cat = (t.capex_categoria as string) ?? "Otros";
      if (buckets[i][cat] !== undefined) buckets[i][cat] += usd;
      else buckets[i]["Otros"] += usd;
      buckets[i].total += usd;
    });
    return buckets;
  }, [filtered]);

  const porCategoria = useMemo(() => {
    const map: Record<string, number> = {};
    CAPEX_CATEGORIAS.forEach((c) => { map[c] = 0; });
    filtered.forEach((t: any) => {
      const cat = (t.capex_categoria as string) ?? "Otros";
      map[cat] = (map[cat] ?? 0) + (Number(t.monto_usd) || 0);
    });
    return map;
  }, [filtered]);

  const totalUsd = filtered.reduce((s: number, t: any) => s + (Number(t.monto_usd) || 0), 0);
  const totalBs = filtered.reduce((s: number, t: any) => s + (Number(t.monto_bs) || 0), 0);

  const opexChartData = useMemo(() => {
    const buckets = MESES.map((m) => {
      const row: any = { mes: m };
      OPEX_GROUPS.forEach((g) => { row[g.label] = 0; });
      return row;
    });
    (opexTxs ?? []).forEach((t: any) => {
      const code = String(t.cuenta_codigo ?? "");
      const g = OPEX_GROUPS.find((x) => code.startsWith(x.prefix));
      if (!g) return;
      const i = new Date(t.fecha).getUTCMonth();
      buckets[i][g.label] += Number(t.monto_usd) || 0;
    });
    return buckets;
  }, [opexTxs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CapEx</h1>
          <div className="mt-1"><UsdRateBadge /></div>
          <p className="text-sm text-muted-foreground">Inversiones en activo fijo (cuenta 10.6)</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Todas">Todas las categorías</SelectItem>
              {CAPEX_CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
        <CardHeader><CardTitle className="text-base">Total por categoría ({anio})</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3">
            {CAPEX_CATEGORIAS.map((c) => (
              <div key={c} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: CAT_COLORS[c] }} />
                  <span>{c}</span>
                </div>
                <span className="mono font-semibold">{fmtUsd(porCategoria[c] ?? 0)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">CapEx por mes ({anio})</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 360 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="mes" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                  <Legend />
                  {CAPEX_CATEGORIAS.map((c) => (
                    <Bar key={c} dataKey={c} stackId="a" fill={CAT_COLORS[c]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Gastos operativos por mes ({anio})</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 360 }}>
              <ResponsiveContainer>
                <BarChart data={opexChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="mes" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {OPEX_GROUPS.map((g) => (
                    <Bar key={g.key} dataKey={g.label} stackId="a" fill={g.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>


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
                    <th className="text-left py-2 px-2">Categoría</th>
                    <th className="text-left py-2 px-2">Descripción</th>
                    <th className="text-left py-2 px-2">N° Factura</th>
                    <th className="text-left py-2 px-2">Método</th>
                    <th className="text-right py-2 px-2">Bs</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Modo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t: any) => {
                    const cat = (t.capex_categoria as string) ?? "Otros";
                    return (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="py-2 px-2 mono">{fmtDate(t.fecha)}</td>
                        <td className="py-2 px-2">{t.centro_costo}</td>
                        <td className="py-2 px-2">
                          <Badge variant="outline" style={{ borderColor: CAT_COLORS[cat], color: CAT_COLORS[cat] }}>
                            {cat}
                          </Badge>
                        </td>
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
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t">
                    <td colSpan={6} className="py-2 px-2 text-right">Total</td>
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
