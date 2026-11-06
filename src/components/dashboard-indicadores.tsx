import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RotateCcw } from "lucide-react";
import {
  Line, LineChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import { estimarCogsMesesAbiertos } from "@/lib/cierre-mes";
import { CUENTA_COMPRAS, construirNombrePorTerceroId, type CompraRaw, type Tercero } from "@/lib/cogs-proveedores-calc";
import {
  construirSerieIndicadores, type FilaIndicadores, type RowIndicador, type CuentaIndicador,
} from "@/lib/indicadores-restaurante-calc";

/**
 * 4 indicadores clave de restaurante (ver indicadores-restaurante-calc.ts
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
  // 28-32¢ por dólar vendido es el rango cómodo para COGS real en un
  // restaurante; 30¢ como punto medio recomendado.
  cogsPorDolar: 30,
};

export function DashboardIndicadores() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const { mode } = useUsdView();
  // Mismos switches que Ingresos en Detalle: off-balance e Ingresos por IVA
  // activados por defecto, incluidos en food cost %, prime cost % y margen
  // neto % (ver construirSerieIndicadores).
  const [incluirOff, setIncluirOff] = useState(true);
  const [incluirIva, setIncluirIva] = useState(true);

  const [objFoodCost, setObjFoodCost] = useState(DEFAULT_OBJETIVOS.foodCost);
  const [objPrimeCost, setObjPrimeCost] = useState(DEFAULT_OBJETIVOS.primeCost);
  const [objMargenNeto, setObjMargenNeto] = useState(DEFAULT_OBJETIVOS.margenNeto);
  const [objCogsPorDolar, setObjCogsPorDolar] = useState(DEFAULT_OBJETIVOS.cogsPorDolar);

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
      const { data } = await (supabase as any).from(mensualView(mode)).select("mes,cuenta_codigo,modo,base_usd").eq("anio", anio);
      return (data ?? []) as RowIndicador[];
    },
  });

  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["dash-ind-cogs-estimado", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
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
      rows ?? [], mapCuentas, cogsEstimadoPorMes, comprasAnio ?? [], nombrePorTerceroId, anio, mesCorte, mode,
      incluirOff, incluirIva,
    ),
    [rows, mapCuentas, cogsEstimadoPorMes, comprasAnio, nombrePorTerceroId, anio, mesCorte, mode, incluirOff, incluirIva],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Indicadores clave del restaurante</h2>
          <p className="text-sm text-muted-foreground">Comparación mensual · consolidado de todos los centros</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-center gap-2 border rounded-md px-3 h-10">
            <Switch checked={incluirOff} onCheckedChange={setIncluirOff} id="dash-ind-off" />
            <Label htmlFor="dash-ind-off" className="text-xs whitespace-nowrap">Incluir off-balance</Label>
          </div>
          <div className="flex items-center gap-2 border rounded-md px-3 h-10">
            <Switch checked={incluirIva} onCheckedChange={setIncluirIva} id="dash-ind-iva" />
            <Label htmlFor="dash-ind-iva" className="text-xs whitespace-nowrap">Incluir Ingresos IVA</Label>
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
            definicion="Qué parte de cada venta se fue en comprar los insumos de lo que se preparó. Mientras más bajo, más margen bruto queda antes de pagar nómina y gastos fijos."
            data={serie}
            dataKey="foodCostPct"
            color="#7F1D1D"
            sufijo="%"
            min={15} max={50} step={1}
            objetivo={objFoodCost}
            defaultObjetivo={DEFAULT_OBJETIVOS.foodCost}
            onObjetivoChange={setObjFoodCost}
            mejorEsBajo
          />
          <IndicadorChart
            titulo="Prime cost %"
            sub="(COGS real + Nómina) / Ingresos"
            definicion="Food cost + nómina juntos -- los dos costos que más pesan en un restaurante. Es el indicador #1 de salud operativa: si sube mucho, exprime el margen aunque las ventas vayan bien."
            data={serie}
            dataKey="primeCostPct"
            color="#B45309"
            sufijo="%"
            min={40} max={75} step={1}
            objetivo={objPrimeCost}
            defaultObjetivo={DEFAULT_OBJETIVOS.primeCost}
            onObjetivoChange={setObjPrimeCost}
            mejorEsBajo
          />
          <IndicadorChart
            titulo="Margen neto %"
            sub="Utilidad neta / Ingresos"
            definicion="Qué porcentaje de cada dólar vendido queda como utilidad real, después de COGS, nómina, gastos fijos, variables e impuestos. Es la última línea: lo que de verdad gana el negocio."
            data={serie}
            dataKey="margenNetoPct"
            color="#0ea5e9"
            sufijo="%"
            min={-10} max={20} step={1}
            objetivo={objMargenNeto}
            defaultObjetivo={DEFAULT_OBJETIVOS.margenNeto}
            onObjetivoChange={setObjMargenNeto}
            mejorEsBajo={false}
          />
          <IndicadorChart
            titulo="COGS real / $ vendido"
            sub="COGS real / Ingresos, en centavos por dólar"
            definicion="Mismo cálculo que Food cost %, mostrado en centavos por cada dólar vendido en vez de porcentaje -- a veces es más fácil de sentir así: de cada dólar que vendo, X centavos se van en la comida real que se consumió. El rango cómodo en un restaurante es 28-32¢ por dólar."
            data={serie}
            dataKey="cogsPorDolar"
            color="#7F1D1D"
            sufijo="¢"
            min={15} max={50} step={1}
            objetivo={objCogsPorDolar}
            defaultObjetivo={DEFAULT_OBJETIVOS.cogsPorDolar}
            onObjetivoChange={setObjCogsPorDolar}
            mejorEsBajo
          />
        </div>
      )}
    </div>
  );
}

/** Fila de "Objetivo" con slider + botón para volver al default -- se repite
 * igual en los 4 gráficos (ver IndicadorChart y ConcentracionChart). */
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

/** Pastilla "Saludable" / "fuera de rango" para el mes más reciente con
 * dato, comparado contra el objetivo -- misma convención de verde/rojo que
 * ya usa Análisis AI (IndicadoresPlain), para no inventar un segundo
 * lenguaje visual de bueno/malo en la misma app. */
function calcularEstadoIndicador(valor: number | null, objetivo: number, mejorEsBajo: boolean): { label: string; className: string } | null {
  if (valor == null) return null;
  const enRango = mejorEsBajo ? valor <= objetivo : valor >= objetivo;
  if (enRango) {
    return { label: "Saludable", className: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" };
  }
  return {
    label: mejorEsBajo ? "Más alto de lo ideal" : "Más bajo de lo ideal",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  };
}

function EstadoPill({ estado }: { estado: { label: string; className: string } | null }) {
  if (!estado) return null;
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${estado.className}`}>{estado.label}</span>;
}

function IndicadorChart({ titulo, sub, definicion, data, dataKey, color, sufijo, objetivo, defaultObjetivo, onObjetivoChange, min, max, step, mejorEsBajo }: {
  titulo: string;
  sub: string;
  definicion: string;
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
  mejorEsBajo: boolean;
}) {
  const ultimo = [...data].reverse().find((d) => d[dataKey] != null);
  const valorUltimo = ultimo ? (ultimo[dataKey] as number | null) : null;
  const estado = calcularEstadoIndicador(valorUltimo, objetivo, mejorEsBajo);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {titulo}
          <EstadoPill estado={estado} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">{sub}</p>
        <p className="text-xs text-muted-foreground/80 italic">{definicion}</p>
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
