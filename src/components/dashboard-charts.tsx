import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fmtUsd } from "@/lib/format";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import { CENTROS, MESES } from "@/lib/account-helpers";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend,
  Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  PieChart, Pie,
} from "recharts";

type Row = {
  anio: number; mes: number; cuenta_codigo: string;
  centro_costo: string; modo: string;
  base_usd: number; total_usd: number;
};
type Cuenta = { codigo: string; afecta_gyp: boolean; afecta_fc: boolean };

export function DashboardCharts() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [centro, setCentro] = useState<string>("Consolidado");
  const [incluirOff, setIncluirOff] = useState(false);
  const { mode } = useUsdView();

  const { data: cuentas } = useQuery({
    queryKey: ["dash-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo, nombre, grupo, afecta_gyp, afecta_fc");
      return (data ?? []) as (Cuenta & { nombre: string; grupo: string })[];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["dash-rows", anio, centro, incluirOff, mode],
    queryFn: async () => {
      let q = supabase.from(mensualView(mode) as any).select("*").eq("anio", anio);
      if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
      if (!incluirOff) q = q.eq("modo", "on_balance");
      const { data } = await q;
      return (data ?? []) as Row[];
    },
  });

  const mapCuentas = useMemo(() => {
    const m = new Map<string, Cuenta>();
    (cuentas ?? []).forEach((c) => m.set(c.codigo, c));
    return m;
  }, [cuentas]);

  // Datos mensuales para G&P y FC
  const data = useMemo(() => {
    return MESES.map((nombre, i) => {
      const mes = i + 1;
      const rs = (rows ?? []).filter((r) => r.mes === mes);
      let ingresos = 0, cogs = 0, gastos = 0, fcIn = 0, fcOut = 0, capex = 0;
      rs.forEach((r) => {
        const c = mapCuentas.get(r.cuenta_codigo);
        if (!c) return;
        const base = Number(r.base_usd || 0);
        const total = Number(r.total_usd || 0);
        if (c.afecta_gyp) {
          if (r.cuenta_codigo.startsWith("1.") || r.cuenta_codigo === "11.1") ingresos += base;
          else if (r.cuenta_codigo.startsWith("2.")) cogs += base;
          else gastos += base;
        }
        if (c.afecta_fc) {
          if (r.cuenta_codigo.startsWith("1.") || ["10.1", "10.5"].includes(r.cuenta_codigo)) fcIn += total;
          else fcOut += total;
        }
        // CapEx (activo fijo) — cuenta 10.6
        if (r.cuenta_codigo === "10.6") capex += total;
      });
      const utilidad = ingresos - cogs - gastos;
      const flujoNeto = fcIn - fcOut;
      return {
        mes: nombre, mesNum: mes,
        ingresos: Math.round(ingresos), cogs: Math.round(cogs), gastos: Math.round(gastos),
        utilidad: Math.round(utilidad),
        cogsNeg: -Math.round(cogs),
        gastosNeg: -Math.round(gastos),
        fcIn: Math.round(fcIn), fcOut: Math.round(fcOut),
        flujoNeto: Math.round(flujoNeto),
        capex: Math.round(capex),
        efectivo: 0, // se llena abajo
        capexAcum: 0, // se llena abajo
        utilidadAcum: 0, // se llena abajo
      };
    });
  }, [rows, mapCuentas]);


  // Acumulados: efectivo, CapEx y utilidad
  const dataConAcumulado = useMemo(() => {
    let accEf = 0, accCx = 0, accUt = 0;
    return data.map((d) => {
      accEf += d.flujoNeto;
      accCx += d.capex;
      accUt += d.utilidad;
      return { ...d, efectivo: Math.round(accEf), capexAcum: Math.round(accCx), utilidadAcum: Math.round(accUt) };
    });
  }, [data]);

  const mesHoy = new Date().getMonth() + 1;
  const esAnioActual = anio === anioActual;
  const idxHoy = esAnioActual ? mesHoy - 1 : 11;
  const ytdUtilidad = dataConAcumulado.filter((d) => !esAnioActual || d.mesNum <= mesHoy).reduce((s, d) => s + d.utilidad, 0);
  const ytdFlujo = dataConAcumulado.filter((d) => !esAnioActual || d.mesNum <= mesHoy).reduce((s, d) => s + d.flujoNeto, 0);
  const efectivoActual = dataConAcumulado[idxHoy]?.efectivo ?? 0;
  const ytdCapex = dataConAcumulado.filter((d) => !esAnioActual || d.mesNum <= mesHoy).reduce((s, d) => s + d.capex, 0);
  const capexAcumActual = dataConAcumulado[idxHoy]?.capexAcum ?? 0;
  const utilidadAcumActual = dataConAcumulado[idxHoy]?.utilidadAcum ?? 0;

  // Desglose de gastos operativos YTD por grupo del plan de cuentas
  const gastosPorGrupo = useMemo(() => {
    const acc = new Map<string, number>();
    (rows ?? []).forEach((r) => {
      if (esAnioActual && r.mes > mesHoy) return;
      const c: any = mapCuentas.get(r.cuenta_codigo);
      if (!c || !c.afecta_gyp) return;
      if (r.cuenta_codigo.startsWith("1.") || r.cuenta_codigo.startsWith("2.")) return;
      const grp = c.grupo ?? "Otros";
      acc.set(grp, (acc.get(grp) ?? 0) + Number(r.base_usd || 0));
    });
    return Array.from(acc.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [rows, mapCuentas, esAnioActual, mesHoy]);
  const totalGastosOp = gastosPorGrupo.reduce((s, d) => s + d.value, 0);
  const COLORS_GRP = ["#ef4444","#f97316","#f59e0b","#eab308","#84cc16","#10b981","#06b6d4","#0ea5e9","#8b5cf6","#d946ef","#ec4899"];




  return (
    <div className="space-y-4">
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
            <Label className="text-xs">Centro de costo</Label>
            <Select value={centro} onValueChange={setCentro}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Consolidado">Consolidado</SelectItem>
                {CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={incluirOff} onCheckedChange={setIncluirOff} id="dash-off" />
            <Label htmlFor="dash-off" className="text-xs">Incluir off-balance</Label>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Utilidad mensual (G&P) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Utilidad mensual (G&P)</CardTitle>
            <div className="flex gap-6 text-xs mt-1">
              <span className="text-muted-foreground">YTD utilidad neta</span>
              <span className={`mono font-semibold ${ytdUtilidad >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtUsd(ytdUtilidad)}</span>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={dataConAcumulado} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} stackOffset="sign">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="mes" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => compactUsd(v)} />
                <Tooltip content={<TipGyp />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="ingresos" stackId="g" name="Ingresos" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar dataKey="cogsNeg" stackId="g" name="COGS" fill="#7f1d1d" radius={[0, 0, 0, 0]} />
                <Bar dataKey="gastosNeg" stackId="g" name="Gastos / facturas" fill="#f87171" radius={[2, 2, 0, 0]} />

                <Line type="monotone" dataKey="utilidad" name="Utilidad neta" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />

              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Efectivo disponible (FC) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Efectivo disponible (FC)</CardTitle>
            <div className="flex gap-6 text-xs mt-1">
              <span className="text-muted-foreground">Saldo acumulado</span>
              <span className={`mono font-semibold ${efectivoActual >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtUsd(efectivoActual)}</span>
              <span className="text-muted-foreground">YTD flujo neto</span>
              <span className={`mono font-semibold ${ytdFlujo >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtUsd(ytdFlujo)}</span>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={dataConAcumulado} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="mes" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => compactUsd(v)} />
                <Tooltip content={<TipFC />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="flujoNeto" name="Flujo neto mes" radius={[2, 2, 0, 0]}>
                  {dataConAcumulado.map((d, i) => (
                    <Cell key={i} fill={d.flujoNeto >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="efectivo" name="Efectivo acumulado" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* CapEx acumulado vs Utilidad acumulada */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">CapEx acumulado vs Utilidad acumulada</CardTitle>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mt-1">
            <span className="text-muted-foreground">Utilidad acumulada</span>
            <span className={`mono font-semibold ${utilidadAcumActual >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtUsd(utilidadAcumActual)}</span>
            <span className="text-muted-foreground">CapEx acumulado</span>
            <span className="mono font-semibold text-amber-600">{fmtUsd(capexAcumActual)}</span>
            <span className="text-muted-foreground">CapEx YTD</span>
            <span className="mono font-semibold text-amber-600">{fmtUsd(ytdCapex)}</span>
            <span className="text-muted-foreground">Cobertura</span>
            <span className={`mono font-semibold ${utilidadAcumActual >= capexAcumActual ? "text-emerald-600" : "text-red-600"}`}>
              {capexAcumActual > 0 ? `${((utilidadAcumActual / capexAcumActual) * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dataConAcumulado} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="mes" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => compactUsd(v)} />
              <Tooltip content={<TipCapex />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="capex" name="CapEx mes" fill="#fbbf24" radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="capexAcum" name="CapEx acumulado" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="utilidadAcum" name="Utilidad acumulada" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Gastos operativos YTD por grupo */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Gastos operativos YTD por grupo</CardTitle>
          <div className="flex gap-6 text-xs mt-1">
            <span className="text-muted-foreground">Total YTD</span>
            <span className="mono font-semibold text-red-600">{fmtUsd(totalGastosOp)}</span>
          </div>
        </CardHeader>
        <CardContent>
          {gastosPorGrupo.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Sin gastos operativos en el período.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 items-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={gastosPorGrupo} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={2}>
                    {gastosPorGrupo.map((_, i) => <Cell key={i} fill={COLORS_GRP[i % COLORS_GRP.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 text-sm">
                {gastosPorGrupo.map((g, i) => {
                  const pct = totalGastosOp > 0 ? (g.value / totalGastosOp) * 100 : 0;
                  return (
                    <div key={g.name} className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: COLORS_GRP[i % COLORS_GRP.length] }} />
                      <span className="flex-1 truncate">{g.name}</span>
                      <span className="text-xs text-muted-foreground mono w-12 text-right">{pct.toFixed(1)}%</span>
                      <span className="mono font-medium w-24 text-right">{fmtUsd(g.value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TipCapex({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-md">
      <div className="font-semibold mb-1">{label}</div>
      <Row k="CapEx del mes" v={d.capex} />
      <Row k="Utilidad del mes" v={d.utilidad} />
      <div className="border-t mt-1 pt-1">
        <Row k="CapEx acumulado" v={d.capexAcum} bold />
        <Row k="Utilidad acumulada" v={d.utilidadAcum} bold />
      </div>
    </div>
  );
}


function compactUsd(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

function TipGyp({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-md">
      <div className="font-semibold mb-1">{label}</div>
      <Row k="Ingresos" v={d.ingresos} positive />
      <Row k="COGS" v={-d.cogs} />
      <Row k="Gastos / facturas" v={-d.gastos} />

      <div className="border-t mt-1 pt-1">
        <Row k="Utilidad neta" v={d.utilidad} bold />
      </div>
    </div>
  );
}

function TipFC({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-md">
      <div className="font-semibold mb-1">{label}</div>
      <Row k="Entradas" v={d.fcIn} positive />
      <Row k="Salidas" v={-d.fcOut} />
      <Row k="Flujo neto" v={d.flujoNeto} bold />
      <div className="border-t mt-1 pt-1">
        <Row k="Efectivo acumulado" v={d.efectivo} bold />
      </div>
    </div>
  );
}

function Row({ k, v, positive, bold }: { k: string; v: number; positive?: boolean; bold?: boolean }) {
  const cls = v >= 0 ? (positive ? "text-emerald-600" : "") : "text-red-600";
  return (
    <div className={`flex justify-between gap-4 ${bold ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{k}</span>
      <span className={`mono ${cls}`}>{fmtUsd(v)}</span>
    </div>
  );
}
