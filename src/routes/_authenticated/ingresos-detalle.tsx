import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtUsd } from "@/lib/format";
import { MESES, ordenarPorCodigo } from "@/lib/account-helpers";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import {
  Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine,
} from "recharts";
import { TrendingUp, SlidersHorizontal, Receipt, Wallet } from "lucide-react";
import {
  construirSerieIngresos, construirDesgloseIngresos, calcularTotalesIngresosMes,
  type RowIngreso, type CuentaIngreso,
} from "@/lib/ingresos-detalle-calc";

export const Route = createFileRoute("/_authenticated/ingresos-detalle")({
  component: IngresosDetallePage,
});

function KpiCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: "pos" | "neg" | "muted" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${tone === "neg" ? "text-destructive" : tone === "pos" ? "text-green-600" : tone === "muted" ? "text-muted-foreground" : ""}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}

function IngresosDetallePage() {
  const { mode, label } = useUsdView();
  const hoy = new Date();
  // Igual que el Resumen IPA Mensual: por defecto el mes anterior, porque el
  // mes en curso casi nunca tiene todos los movimientos cargados todavía.
  const mesAnteriorD = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const [anio, setAnio] = useState(mesAnteriorD.getFullYear());
  const [mes, setMes] = useState(mesAnteriorD.getMonth() + 1);

  const { data: cuentas } = useQuery({
    queryKey: ["ingresos-detalle-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre").like("codigo", "1.%");
      return ordenarPorCodigo((data ?? []) as CuentaIngreso[]);
    },
  });

  const { data: rowsAnio } = useQuery({
    queryKey: ["ingresos-detalle-rows", anio, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode))
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd")
        .eq("anio", anio)
        .like("cuenta_codigo", "1.%");
      return (data ?? []) as RowIngreso[];
    },
  });

  const serie = useMemo(() => construirSerieIngresos(rowsAnio ?? [], mes), [rowsAnio, mes]);
  const actual = useMemo(() => calcularTotalesIngresosMes(rowsAnio ?? [], mes), [rowsAnio, mes]);
  const desglose = useMemo(() => construirDesgloseIngresos(rowsAnio ?? [], cuentas, mes), [rowsAnio, cuentas, mes]);

  const labelMes = `${MESES[mes - 1]} ${anio}`;
  const currencyBannerClass = mode === "bcv"
    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ingresos en Detalle Contable</h1>
          <p className="text-base text-muted-foreground mt-1">Desglose de ingresos de <b>{labelMes}</b></p>
          <div className={`mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${currencyBannerClass}`}>
            <span className={`h-2 w-2 rounded-full ${mode === "bcv" ? "bg-blue-500" : "bg-emerald-500"}`} />
            Todos los montos de esta pantalla están en <span className="uppercase tracking-wide">{label}</span>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <UsdViewToggle />
          <div>
            <Label className="text-xs">Mes</Label>
            <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Año</Label>
            <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-1.5">
        ℹ "Ingresos por IVA" (cuenta 1.8) está en $0.00 porque el IVA que se cobra en cada venta se contabiliza como pasivo transitorio
        con el SENIAT (cuenta 7.3 · IVA débito fiscal cobrado), no como ingreso propio del negocio. Esta cuenta queda aquí como
        referencia por si alguna vez se usa.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          icon={Wallet}
          label="Total ingresos"
          value={fmtUsd(actual.total)}
          sub={`${labelMes} · ${label}`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Ventas comunes"
          value={fmtUsd(actual.ventasComunes)}
          sub={actual.total !== 0 ? `${((actual.ventasComunes / actual.total) * 100).toFixed(1)}% del total · ${label}` : label}
        />
        <KpiCard
          icon={SlidersHorizontal}
          label="Ajustes (descuentos y devoluciones)"
          value={fmtUsd(actual.ajustes)}
          tone={actual.ajustes < 0 ? "neg" : undefined}
          sub={`${labelMes} · ${label}`}
        />
        <KpiCard
          icon={Receipt}
          label="Ingresos por IVA"
          value={fmtUsd(actual.ingresosIva)}
          tone="muted"
          sub="Normalmente $0.00 — ver nota arriba"
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Ingresos mensuales por tipo — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
        <CardContent className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="mesLabel" fontSize={11} />
              <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
              <ReferenceLine y={0} stroke="#111827" strokeWidth={1} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} />
              <Legend />
              <Bar dataKey="ventasComunes" name="Ventas comunes" stackId="a" fill="#0F6E56" />
              <Bar dataKey="ajustes" name="Ajustes (descuentos/devoluciones)" stackId="a" fill="#D97706" />
              <Bar dataKey="ingresosIva" name="Ingresos por IVA" stackId="a" fill="#64748B" />
              <Line type="monotone" dataKey="total" name="Total ingresos" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose mensual — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 text-xs uppercase text-muted-foreground">Tipo</th>
                {serie.map((s) => (
                  <th key={s.mesLabel} className="text-right py-2 px-2 text-xs uppercase text-muted-foreground whitespace-nowrap">{s.mesLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-1.5 px-2">Ventas comunes</td>
                {serie.map((s) => <td key={s.mesLabel} className="py-1.5 px-2 text-right mono">{fmtUsd(s.ventasComunes)}</td>)}
              </tr>
              <tr className="border-b">
                <td className="py-1.5 px-2">Ajustes (descuentos/devoluciones)</td>
                {serie.map((s) => <td key={s.mesLabel} className="py-1.5 px-2 text-right mono">{fmtUsd(s.ajustes)}</td>)}
              </tr>
              <tr className="border-b">
                <td className="py-1.5 px-2">Ingresos por IVA</td>
                {serie.map((s) => <td key={s.mesLabel} className="py-1.5 px-2 text-right mono text-muted-foreground">{fmtUsd(s.ingresosIva)}</td>)}
              </tr>
              <tr className="border-t-2">
                <td className="py-2 px-2 font-bold">Total ingresos</td>
                {serie.map((s) => <td key={s.mesLabel} className="py-2 px-2 text-right mono font-bold text-green-600">{fmtUsd(s.total)}</td>)}
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose por cuenta — {labelMes} · {label}</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {desglose.length === 0 && (
                <tr><td className="py-3 px-2 text-muted-foreground">Sin movimientos de ingresos en {labelMes}.</td></tr>
              )}
              {desglose.map((d) => (
                <tr key={d.codigo} className="border-b last:border-0">
                  <td className="py-1.5 px-2 text-muted-foreground">{d.codigo} · {d.nombre}</td>
                  <td className="py-1.5 px-2 text-right mono">{fmtUsd(d.total)}</td>
                  <td className="py-1.5 px-2 text-right text-xs text-muted-foreground w-20">
                    {actual.total !== 0 ? `${((d.total / actual.total) * 100).toFixed(1)}%` : ""}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2">
                <td className="py-2 px-2 font-bold">Total</td>
                <td className="py-2 px-2 text-right mono font-bold">{fmtUsd(actual.total)}</td>
                <td className="py-2 px-2 text-right text-xs">100.0%</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
