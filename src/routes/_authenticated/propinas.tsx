import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, ArrowUpDown } from "lucide-react";
import { fmtUsd, fmtDate } from "@/lib/format";
import { MESES } from "@/lib/account-helpers";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, Line,
} from "recharts";

export const Route = createFileRoute("/_authenticated/propinas")({ component: PropinasPage });

type Propina = {
  id: string;
  fecha: string;
  monto_usd: number;
  centro_costo: string | null;
  concepto: string | null;
  notas: string | null;
};

type SortKey = "fecha" | "centro_costo" | "monto_usd" | "concepto" | "notas";

function PropinasPage() {
  const now = new Date();
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState<number | "all">(now.getMonth() + 1);
  const [centroFiltro, setCentroFiltro] = useState<string>("Consolidado");
  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: propinas } = useQuery({
    queryKey: ["propinas", anio],
    queryFn: async () => {
      const ini = `${anio}-01-01`;
      const fin = `${anio}-12-31`;
      const { data } = await supabase
        .from("propinas")
        .select("id,fecha,monto_usd,centro_costo,concepto,notas")
        .gte("fecha", ini)
        .lte("fecha", fin)
        .order("fecha", { ascending: false });
      return (data ?? []) as Propina[];
    },
  });

  const { data: ventasMensual } = useQuery({
    queryKey: ["ventas-netas-mensual", anio],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_transacciones_mensual" as any)
        .select("mes,cuenta_codigo,base_usd")
        .eq("anio", anio)
        .eq("modo", "on_balance")
        .in("cuenta_codigo", ["1.1", "1.2", "1.3", "1.4", "1.6", "1.7"]);
      return (data ?? []) as { mes: number; cuenta_codigo: string; base_usd: number }[];
    },
  });

  // Filter by month + centro for KPIs / table
  const filtered = useMemo(() => {
    return (propinas ?? []).filter((p) => {
      const m = Number(p.fecha.slice(5, 7));
      if (mes !== "all" && m !== mes) return false;
      if (centroFiltro !== "Consolidado" && (p.centro_costo ?? "") !== centroFiltro) return false;
      return true;
    });
  }, [propinas, mes, centroFiltro]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = (a as any)[sortKey] ?? "";
      const bv = (b as any)[sortKey] ?? "";
      let cmp = 0;
      if (sortKey === "monto_usd") cmp = Number(av) - Number(bv);
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const total = filtered.reduce((s, p) => s + Number(p.monto_usd ?? 0), 0);
  const totalYV = filtered.filter((p) => p.centro_costo === "YV").reduce((s, p) => s + Number(p.monto_usd ?? 0), 0);
  const totalBocu = filtered.filter((p) => p.centro_costo === "Bocu").reduce((s, p) => s + Number(p.monto_usd ?? 0), 0);
  const dias = new Set(filtered.map((p) => p.fecha)).size;
  const promedio = dias > 0 ? total / dias : 0;

  // Monthly aggregation (full year, no centro filter for charts so comparison works)
  const chartData = useMemo(() => {
    const out: Record<number, { mes: number; mesLabel: string; YV: number; Bocu: number; Otros: number; total: number }> = {};
    for (let m = 1; m <= 12; m++) {
      out[m] = { mes: m, mesLabel: MESES[m - 1], YV: 0, Bocu: 0, Otros: 0, total: 0 };
    }
    (propinas ?? []).forEach((p) => {
      const m = Number(p.fecha.slice(5, 7));
      const amt = Number(p.monto_usd ?? 0);
      const c = p.centro_costo === "YV" ? "YV" : p.centro_costo === "Bocu" ? "Bocu" : "Otros";
      out[m][c] += amt;
      out[m].total += amt;
    });

    // ventas netas por mes
    const ventasPorMes: Record<number, number> = {};
    (ventasMensual ?? []).forEach((v) => {
      const signo = v.cuenta_codigo === "1.6" || v.cuenta_codigo === "1.7" ? -1 : 1;
      ventasPorMes[v.mes] = (ventasPorMes[v.mes] ?? 0) + signo * Number(v.base_usd ?? 0);
    });

    return Object.values(out).map((r) => {
      const ventas = ventasPorMes[r.mes] ?? 0;
      const pct = ventas > 0 ? (r.total / ventas) * 100 : 0;
      return { ...r, ventas, pctVentas: Number(pct.toFixed(2)) };
    });
  }, [propinas, ventasMensual]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Propinas</h1>
        <p className="text-sm text-muted-foreground">Control interno de propinas · separado del G&P y Flujo de Caja</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Las propinas no forman parte de los ingresos del restaurante ni del Flujo de Caja.
          Se registran por separado para control interno y distribución al personal.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div>
            <Label className="text-xs">Año</Label>
            <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mes</Label>
            <Select value={String(mes)} onValueChange={(v) => setMes(v === "all" ? "all" : Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el año</SelectItem>
                {MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Centro de costo</Label>
            <Select value={centroFiltro} onValueChange={setCentroFiltro}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Consolidado">Consolidado</SelectItem>
                <SelectItem value="YV">YV</SelectItem>
                <SelectItem value="Bocu">Bocú</SelectItem>
                <SelectItem value="Compartido">Compartido</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total propinas del período</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmtUsd(total)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Por centro de costo</CardTitle></CardHeader>
          <CardContent>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">YV</span><span className="font-semibold">{fmtUsd(totalYV)}</span></div>
            <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Bocú</span><span className="font-semibold">{fmtUsd(totalBocu)}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Promedio por día</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtUsd(promedio)}</div>
            <div className="text-xs text-muted-foreground mt-1">{dias} día{dias === 1 ? "" : "s"} con propinas</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Propinas mensuales · {anio}</CardTitle></CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mesLabel" />
              <YAxis tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} />
              <Legend />
              <Bar dataKey="YV" stackId="a" fill="#0F6E56" />
              <Bar dataKey="Bocu" stackId="a" fill="#534AB7" name="Bocú" />
              <Bar dataKey="Otros" stackId="a" fill="#9CA3AF" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Propinas vs % sobre ventas netas · {anio}</CardTitle></CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mesLabel" />
              <YAxis yAxisId="left" tickFormatter={(v) => `$${v}`} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number, name) => name === "% sobre ventas" ? `${v}%` : fmtUsd(v)} />
              <Legend />
              <Bar yAxisId="left" dataKey="total" fill="#0F6E56" name="Total propinas" />
              <Line yAxisId="right" type="monotone" dataKey="pctVentas" stroke="#E11D48" strokeWidth={2} name="% sobre ventas" />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle ({sorted.length} registros)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  {([
                    ["fecha", "Fecha"],
                    ["centro_costo", "Centro"],
                    ["monto_usd", "Monto USD"],
                    ["concepto", "Método/Concepto"],
                    ["notas", "Notas"],
                  ] as [SortKey, string][]).map(([k, lbl]) => (
                    <th key={k} className="text-left py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort(k)}>
                      <span className="inline-flex items-center gap-1">{lbl} <ArrowUpDown className="h-3 w-3 opacity-50" />{sortKey === k && <span className="text-[10px]">{sortDir}</span>}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-1.5 px-2 mono">{fmtDate(p.fecha)}</td>
                    <td className="py-1.5 px-2">{p.centro_costo ?? "—"}</td>
                    <td className="py-1.5 px-2 mono">{fmtUsd(p.monto_usd)}</td>
                    <td className="py-1.5 px-2">{p.concepto ?? "—"}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{p.notas ?? "—"}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Sin propinas registradas en este período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
