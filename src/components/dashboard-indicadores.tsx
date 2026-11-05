import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RotateCcw } from "lucide-react";
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
 *
 * El objetivo de cada gráfico es ajustable (slider) con botón para volver al
 * default -- el benchmark de industria es un punto de partida razonable,
 * pero cada negocio puede querer su propia meta.
 */

const DEFAULT_OBJETIVOS = {
  foodCost: 30,
  primeCost: 55,
  margenNeto: 5,
  diasInventario: 6,
  concentracion: 22,
};

export function DashboardIndicadores() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const { mode } = useUsdView();

  const [objFoodCost, setObjFoodCost] = useState(DEFAULT_OBJETIVOS.foodCost);
  const [objPrimeCost, setObjPrimeCost] = useState(DEFAULT_OBJETIVOS.primeCost);
  const [objMargenNeto, setObjMargenNeto] = useState(DEFAULT_OBJETIVOS.margenNeto);
  const [objDias, setObjDias] = useState(DEFAULT_OBJETIVOS.diasInventario);
  const [objConcentracion, setObjConcentracion] = useState(DEFAULT_OBJETIVOS.concentracion);

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

  const hoy = new Date();
  const mesHoy = hoy.getMonth() + 1;
  const diaHoy = hoy.getDate();
  // El mes en curso casi nunca tiene todo cargado todavía -- se omite salvo
  // que ya estemos pasando el día 25 del mes (ahí ya debería estar casi todo
  // registrado y vale la pena mostrarlo).
  const ultimoMesAMostrar = diaHoy > 25 ? mesHoy : mesHoy - 1;
  const mesCorte = anio === anioActual ? Math.max(ultimoMesAMostrar, 0) : 12;

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

      {mesCorte === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Todavía no hay un mes completo de {anio} para mostrar (el mes en curso se omite hasta el día 25).</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <IndicadorChart
            titulo="Food cost %"
            sub="COGS real / Ingresos"
            data={serie}
            dataKey="foodCostPct"
            color="#7F1D1D"
            sufijo="%"
            min={15} max={50} step={1}
            objetivo={objFoodCost}
            defaultObjetivo={DEFAULT_OBJETIVOS.foodCost}
            onObjetivoChange={setObjFoodCost}
          />
          <IndicadorChart
            titulo="Prime cost %"
            sub="(COGS real + Nómina) / Ingresos"
            data={serie}
            dataKey="primeCostPct"
            color="#B45309"
            sufijo="%"
            min={40} max={75} step={1}
            objetivo={objPrimeCost}
            defaultObjetivo={DEFAULT_OBJETIVOS.primeCost}
            onObjetivoChange={setObjPrimeCost}
          />
          <IndicadorChart
            titulo="Margen neto %"
            sub="Utilidad neta / Ingresos"
            data={serie}
            dataKey="margenNetoPct"
            color="#0ea5e9"
            sufijo="%"
            min={-10} max={20} step={1}
            objetivo={objMargenNeto}
            defaultObjetivo={DEFAULT_OBJETIVOS.margenNeto}
            onObjetivoChange={setObjMargenNeto}
          />
          <IndicadorChart
            titulo="Días de inventario"
            sub="Inventario promedio / COGS real × 30"
            data={serie}
            dataKey="diasInventario"
            color="#0E7490"
            sufijo=" días"
            min={1} max={30} step={1}
            objetivo={objDias}
            defaultObjetivo={DEFAULT_OBJETIVOS.diasInventario}
            onObjetivoChange={setObjDias}
          />
          <ConcentracionChart
            data={serie}
            objetivo={objConcentracion}
            defaultObjetivo={DEFAULT_OBJETIVOS.concentracion}
            onObjetivoChange={setObjConcentracion}
          />
        </div>
      )}
    </div>
  );
}

/** Fila de "Objetivo" con slider + botón para volver al default -- se repite
 * igual en los 5 gráficos (ver IndicadorChart y ConcentracionChart). */
function ObjetivoSlider({ objetivo, defaultObjetivo, onObjetivoChange, min, max, step, sufijo }: {
  objetivo: number;
  defaultObjetivo: number;
  onObjetivoChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  sufijo: string;
}) {
  const alDefault = objetivo === defaultObjetivo;
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Objetivo</span>
      <Slider className="flex-1" value={[objetivo]} min={min} max={max} step={step} onValueChange={([v]) => onObjetivoChange(v)} />
      <span className="text-xs mono w-14 text-right shrink-0">{objetivo}{sufijo}</span>
      <button
        type="button"
        onClick={() => onObjetivoChange(defaultObjetivo)}
        disabled={alDefault}
        title="Volver al valor por defecto"
        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default shrink-0"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function IndicadorChart({ titulo, sub, data, dataKey, color, sufijo, objetivo, defaultObjetivo, onObjetivoChange, min, max, step }: {
  titulo: string;
  sub: string;
  data: FilaIndicadores[];
  dataKey: keyof FilaIndicadores;
  color: string;
  sufijo: string;
  objetivo: number;
  defaultObjetivo: number;
  onObjetivoChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="text-xs text-muted-foreground">{sub}</p>
        <ObjetivoSlider objetivo={objetivo} defaultObjetivo={defaultObjetivo} onObjetivoChange={onObjetivoChange} min={min} max={max} step={step} sufijo={sufijo} />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="mesLabel" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${v}${sufijo}`} />
            <Tooltip formatter={(v: number) => (v == null ? "—" : `${v}${sufijo}`)} />
            <ReferenceLine y={objetivo} stroke="#6b7280" strokeDasharray="4 4" label={{ value: `Objetivo: ${objetivo}${sufijo}`, position: "insideTopRight", fontSize: 10, fill: "#6b7280" }} />
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

function ConcentracionChart({ data, objetivo, defaultObjetivo, onObjetivoChange }: {
  data: FilaIndicadores[];
  objetivo: number;
  defaultObjetivo: number;
  onObjetivoChange: (v: number) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Concentración de compras</CardTitle>
        <p className="text-xs text-muted-foreground">% del proveedor #1 sobre las compras del mes (puede cambiar de proveedor cada mes)</p>
        <ObjetivoSlider objetivo={objetivo} defaultObjetivo={defaultObjetivo} onObjetivoChange={onObjetivoChange} min={5} max={60} step={1} sufijo="%" />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="mesLabel" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<ConcentracionTooltip />} />
            <ReferenceLine y={objetivo} stroke="#6b7280" strokeDasharray="4 4" label={{ value: `Objetivo: ${objetivo}%`, position: "insideTopRight", fontSize: 10, fill: "#6b7280" }} />
            <Line type="monotone" dataKey="concentracionTopPct" stroke="#7C3AED" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
