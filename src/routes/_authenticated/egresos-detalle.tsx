import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtUsd } from "@/lib/format";
import { MESES, ordenarPorCodigo } from "@/lib/account-helpers";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import {
  Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine,
} from "recharts";
import { Wallet, Package, Building2, Zap, Landmark, MoreHorizontal, Receipt, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { TablaExcel, type FilaExcel } from "@/components/tabla-excel";
import { estimarCogsMesesAbiertos } from "@/lib/cierre-mes";
import {
  CATEGORIAS_EGRESO, COLOR_EGRESO, construirSerieEgresos, construirDesgloseEgresos, calcularTotalesEgresosMes,
  type CategoriaEgreso, type RowEgreso, type CuentaEgreso,
} from "@/lib/egresos-detalle-calc";
import { exportEgresosDetalle, type RowEgresoRaw } from "@/lib/export-egresos";

export const Route = createFileRoute("/_authenticated/egresos-detalle")({
  component: EgresosDetallePage,
});

const ICONO_CATEGORIA: Record<CategoriaEgreso, any> = {
  COGS: Package,
  "Costos Fijos": Building2,
  "Costos Variables (operativos)": Zap,
  Financiamiento: Landmark,
  Otros: MoreHorizontal,
  Impuestos: Receipt,
};

function EgresosDetallePage() {
  const { mode, label } = useUsdView();
  const hoy = new Date();
  // Igual que Ingresos en Detalle / Resumen IPA Mensual: por defecto el mes
  // anterior, porque el mes en curso casi nunca tiene todo cargado todavía.
  const mesAnteriorD = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const [anio, setAnio] = useState(mesAnteriorD.getFullYear());
  const [mes, setMes] = useState(mesAnteriorD.getMonth() + 1);
  const [incluirOff, setIncluirOff] = useState(true);
  const [exportando, setExportando] = useState(false);

  // Mismas cuentas que usan G&P / Resumen IPA Mensual (afecta_gyp = true):
  // así "COGS" acá es solo la cuenta 2.2 (el ajuste real), nunca 2.1
  // (Compras, que es inventario y no gasto todavía) — ver cierre-mes.ts.
  const { data: cuentas } = useQuery({
    queryKey: ["egresos-detalle-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo,orden").eq("afecta_gyp", true);
      return ordenarPorCodigo((data ?? []) as CuentaEgreso[]);
    },
  });

  // Vista mensual agregada (misma que G&P) — no la transacción cruda: así el
  // ajuste de COGS estimado para meses abiertos sale idéntico en ambas
  // pantallas, sin tener que reimplementar esa lógica dos veces.
  const { data: rowsAnio } = useQuery({
    queryKey: ["egresos-detalle-rows", anio, mode, incluirOff],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<RowEgreso>(async (from, to) => {
        let q = (supabase as any).from(mensualView(mode)).select("*").eq("anio", anio).range(from, to);
        if (!incluirOff) q = q.eq("modo", "on_balance");
        return await q;
      });
    },
  });

  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["egresos-detalle-cogs-estimado", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
  });

  const grupoDe = useMemo(() => {
    const m = new Map<string, string>();
    (cuentas ?? []).forEach((c) => { if (c.grupo) m.set(c.codigo, c.grupo); });
    return m;
  }, [cuentas]);

  const serie = useMemo(
    () => construirSerieEgresos(rowsAnio ?? [], grupoDe, cogsEstimadoPorMes, anio, mes, mode),
    [rowsAnio, grupoDe, cogsEstimadoPorMes, anio, mes, mode],
  );
  const actual = useMemo(
    () => calcularTotalesEgresosMes(rowsAnio ?? [], grupoDe, mes, cogsEstimadoPorMes, anio, mode),
    [rowsAnio, grupoDe, cogsEstimadoPorMes, mes, anio, mode],
  );
  const desglose = useMemo(
    () => construirDesgloseEgresos(rowsAnio ?? [], cuentas, mes, cogsEstimadoPorMes, anio, mode),
    [rowsAnio, cuentas, mes, cogsEstimadoPorMes, anio, mode],
  );

  const labelMes = `${MESES[mes - 1]} ${anio}`;
  const currencyBannerClass = mode === "bcv"
    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";

  // ---------- Datos para las tablas tipo Excel ----------
  const columnasMeses = serie.map((s) => s.mesLabel);
  const sum = (arr: number[]) => Number(arr.reduce((a, b) => a + b, 0).toFixed(2));
  const filasTablaMensual: FilaExcel[] = [
    ...CATEGORIAS_EGRESO.map((cat) => ({
      label: cat,
      valores: [...serie.map((s) => s[cat]), sum(serie.map((s) => s[cat]))],
    })),
    { label: "Total egresos", valores: [...serie.map((s) => s.total), sum(serie.map((s) => s.total))], bold: true },
  ];

  const filasDesglose: FilaExcel[] = desglose.map((d) => ({
    label: `${d.categoria} · ${d.codigo} · ${d.nombre}`,
    valores: [d.total],
    extra: [actual.total !== 0 ? `${((d.total / actual.total) * 100).toFixed(1)}%` : "—"],
  }));
  filasDesglose.push({ label: "Total", valores: [actual.total], extra: ["100.0%"], bold: true });

  const handleExport = async () => {
    setExportando(true);
    try {
      const codigos = (cuentas ?? []).map((c) => c.codigo);
      if (!codigos.length) return;
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const rowsRaw = await fetchAllRows<RowEgresoRaw>(async (from, to) =>
        await (supabase as any)
          .from("transacciones")
          .select("fecha,cuenta_codigo,centro_costo,modo,referencia,notas,monto_bs,monto_base_bs,monto_usd,tasa_bcv,tasa_paralela")
          .in("cuenta_codigo", codigos)
          .neq("standby", true)
          .gte("fecha", `${anio}-01-01`)
          .lte("fecha", `${anio}-12-31`)
          .range(from, to),
      );
      exportEgresosDetalle({ anio, rows: rowsRaw, cuentas: cuentas ?? [] });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Egresos en Detalle Contable</h1>
          <p className="text-base text-muted-foreground mt-1">Desglose de egresos de <b>{labelMes}</b></p>
          <div className={`mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${currencyBannerClass}`}>
            <span className={`h-2 w-2 rounded-full ${mode === "bcv" ? "bg-blue-500" : "bg-emerald-500"}`} />
            Todos los montos de esta pantalla están en <span className="uppercase tracking-wide">{label}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exportando}>
            <Download className="h-4 w-4 mr-2" /> {exportando ? "Exportando…" : "Exportar a Excel"}
          </Button>
          <UsdViewToggle />
          <div className="flex items-center gap-2 border rounded-md px-3 h-10">
            <Switch checked={incluirOff} onCheckedChange={setIncluirOff} id="off" />
            <Label htmlFor="off" className="text-xs whitespace-nowrap">Incluir off-balance</Label>
          </div>
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

      {actual.cogsEstimado && (
        <div className="text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded px-2 py-1.5">
          ⚠ El COGS de {labelMes} es <b>estimado</b> — el mes sigue abierto (sin cierre formal). Se calculó con el inventario y las compras ya cargados, igual que en G&amp;P y Resumen IPA Mensual.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard icon={Wallet} label="Total egresos" value={fmtUsd(actual.total)} sub={`${labelMes} · ${label}`} />
        {CATEGORIAS_EGRESO.map((cat) => (
          <KpiCard
            key={cat}
            icon={ICONO_CATEGORIA[cat]}
            label={cat}
            value={fmtUsd(actual[cat])}
            sub={actual.total !== 0 ? `${((actual[cat] / actual.total) * 100).toFixed(1)}% del total · ${label}` : label}
          />
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Egresos mensuales por categoría — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
        <CardContent className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="mesLabel" fontSize={11} />
              <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
              <ReferenceLine y={0} stroke="#111827" strokeWidth={1} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} />
              <Legend />
              {CATEGORIAS_EGRESO.map((cat) => (
                <Bar key={cat} dataKey={cat} name={cat} stackId="a" fill={COLOR_EGRESO[cat]} />
              ))}
              <Line type="monotone" dataKey="total" name="Total egresos" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose mensual — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
        <CardContent>
          <TablaExcel columnas={[...columnasMeses, "Total"]} filas={filasTablaMensual} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose por cuenta — {labelMes} · {label}</CardTitle></CardHeader>
        <CardContent>
          <TablaExcel columnas={["Total"]} filas={filasDesglose} extraCols={["% del total"]} />
        </CardContent>
      </Card>
    </div>
  );
}
