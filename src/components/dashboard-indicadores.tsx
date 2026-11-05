import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Line, LineChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import { estimarCogsMesesAbiertos, construirNivelInventarioPorPeriodo } from "@/lib/cierre-mes";
import { CUENTA_COMPRAS, construirNombrePorTerceroId, type CompraRaw, type Tercero } from "@/lib/cogs-proveedores-calc";
import {
  construirSerieIndicadores, type FilaIndicadores, type RowIndicador, type CuentaIndicador,
} from "@/lib/indicadores-restaurante-calc";

/**
 * 5 indicadores clave de restaurante (ver indicadores-restaurante-calc.ts
 * para la fórmula y la fuente de cada benchmark), comparación mensual
 * Ene-Dic del año elegido. Consolidado de todos los centros de costo --
 * estos son ratios de salud del negocio completo, no por local.
 */
export function DashboardIndicadores() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const { mode } = useUsdView();

  const { data: cuentas } = useQuery({
    queryKey: ["dash-ind-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,afecta_gyp");
      return (data ?? []) as CuentaIndicador[];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["dash-ind-rows", anio, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode)).select("mes,cuenta_codigo,base_usd").eq("anio", anio);
      return (data ?? []) as RowIndicador[];
    },
  });

  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["dash-ind-cogs-estimado", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
  });

  // Historial completo de inventario (sin límite inferior) para poder
  // heredar el nivel del último mes con dato cargado -- mismo criterio que
  // estimarCogsMesesAbiertos.
  const { data: snapsInventario } = useQuery({
    queryKey: ["dash-ind-inventario", anio],
    queryFn: async () => {
      const { data } = await supabase.from("inventario_snapshots").select("periodo,tipo,monto_usd").lte("periodo", `${anio}-12`);
      return data ?? [];
    },
  });

  const { data: comprasAnio, isError: comprasError } = useQuery({
    queryKey: ["dash-ind-compras", anio],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<CompraRaw>(async (from, to) =>
        await (supabase as any)
          .from("transacciones")
          .select("fecha,monto_bs,monto_base_bs,monto_usd,tasa_bcv,tasa_paralela,tercero_id,referencia")
          .eq("cuenta_codigo", CUENTA_COMPRAS)
          .neq("standby", true)
          .gte("fecha", `${anio}-01-01`)
          .lte("fecha", `${anio}-12-31`)
          .range(from, to),
      );
    },
  });

  const { data: terceros } = useQuery({
    queryKey: ["dash-ind-terceros"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<Tercero>(async (from, to) =>
        await (supabase as any).from("terceros").select("id,nombre_comercial,razon_social").range(from, to),
      );
    },
  });

  const mapCuentas = useMemo(() => {
    const m = new Map<string, CuentaIndicador>();
    (cuentas ?? []).forEach((c) => m.set(c.codigo, c));
    return m;
  }, [cuentas]);

  const nivelInventario = useMemo(() => construirNivelInventarioPorPeriodo((snapsInventario ?? []) as any), [snapsInventario]);
  const nombrePorTerceroId = useMemo(() => construirNombrePorTerceroId(terceros ?? []), [terceros]);

  const mesHoy = new Date().getMonth() + 1;
  const mesCorte = anio === anioActual ? mesHoy : 12;

  const serie = useMemo(
    () => construirSerieIndicadores(
      rows ?? [], mapCuentas, cogsEstimadoPorMes, nivelInventario, comprasAnio ?? [], nombrePorTerceroId, anio, mesCorte, mode,
    ),
    [rows, mapCuentas, cogsEstimadoPorMes, nivelInventario, comprasAnio, nombrePorTerceroId, anio, mesCorte, mode],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Indicadores clave del restaurante</h2>
          <p className="text-sm text-muted-foreground">Comparación mensual · consolidado de todos los centros</p>
        </div>
        <div>
          <Label className="text-xs">Año</Label>
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {comprasError && (
        <p className="text-xs text-red-600">No se pudieron cargar las compras por proveedor -- el indicador de concentración puede salir incompleto.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <IndicadorChart
          titulo="Food cost %"
          sub="COGS real / Ingresos"
          data={serie}
          dataKey="foodCostPct"
          color="#7F1D1D"
          sufijo="%"
          bandas={[
            { y: 28, label: "28% · mín. sano", color: "#10b981" },
            { y: 35, label: "35% · alerta", color: "#ef4444" },
          ]}
        />
        <IndicadorChart
          titulo="Prime cost %"
          sub="(COGS real + Nómina) / Ingresos"
          data={serie}
          dataKey="primeCostPct"
          color="#B45309"
          sufijo="%"
          bandas={[{ y: 55, label: "55% · objetivo", color: "#10b981" }]}
        />
        <IndicadorChart
          titulo="Margen neto %"
          sub="Utilidad neta / Ingresos"
          data={serie}
          dataKey="margenNetoPct"
          color="#0ea5e9"
          sufijo="%"
          bandas={[
            { y: 0, label: "0% · equilibrio", color: "#6b7280" },
            { y: 5, label: "5% · sano", color: "#10b981" },
          ]}
        />
        <IndicadorChart
          titulo="Días de inventario"
          sub="Inventario promedio / COGS real × 30"
          data={serie}
          dataKey="diasInventario"
          color="#0E7490"
          sufijo=" días"
          bandas={[{ y: 6, label: "~6 días · prom. industria", color: "#f59e0b" }]}
        />
        <ConcentracionChart data={serie} />
      </div>
    </div>
  );
}

function IndicadorChart({ titulo, sub, data, dataKey, color, sufijo, bandas }: {
  titulo: string;
  sub: string;
  data: FilaIndicadores[];
  dataKey: keyof FilaIndicadores;
  color: string;
  sufijo: string;
  bandas: { y: number; label: string; color: string }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="mesLabel" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${v}${sufijo}`} />
            <Tooltip formatter={(v: number) => (v == null ? "—" : `${v}${sufijo}`)} />
            {bandas.map((b) => (
              <ReferenceLine key={b.y} y={b.y} stroke={b.color} strokeDasharray="4 4" label={{ value: b.label, position: "insideTopRight", fontSize: 10, fill: b.color }} />
            ))}
            <Line type="monotone" dataKey={dataKey as string} stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function ConcentracionTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as FilaIndicadores;
  if (d.concentracionTopPct == null) return <div className="rounded-md border bg-background p-2 text-xs shadow-md">{label}: sin compras</div>;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-md">
      <div className="font-semibold mb-1">{label}</div>
      <div>{d.proveedorTopNombre}</div>
      <div className="mono">{d.concentracionTopPct}% de las compras del mes</div>
    </div>
  );
}

function ConcentracionChart({ data }: { data: FilaIndicadores[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Concentración de compras</CardTitle>
        <p className="text-xs text-muted-foreground">% del proveedor #1 sobre las compras del mes (puede cambiar de proveedor cada mes)</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="mesLabel" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<ConcentracionTooltip />} />
            <ReferenceLine y={20} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "20-25% · zona de riesgo", position: "insideTopRight", fontSize: 10, fill: "#f59e0b" }} />
            <Line type="monotone" dataKey="concentracionTopPct" stroke="#7C3AED" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
