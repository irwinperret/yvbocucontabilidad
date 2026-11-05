import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtUsd } from "@/lib/format";
import { MESES } from "@/lib/account-helpers";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import {
  Bar, Cell, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart,
} from "recharts";
import { Package, Users, Award, Scale } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { QueryErrorBanner } from "@/components/query-error-banner";
import { estimarCogsMesesAbiertos } from "@/lib/cierre-mes";
import { type Row as RowGyP, type Cuenta } from "@/lib/resumen-mensual-calc";
import {
  CUENTA_COMPRAS, construirNombrePorTerceroId, construirNombreATerceroId, totalComprasPorMes,
  rankingProveedoresMes, construirSerieCostoUnitario, construirSerieTopMensual,
  colorParaProveedor, COLOR_OTROS_PROVEEDOR,
  type CompraRaw, type Tercero, type FilaTopMensual,
} from "@/lib/cogs-proveedores-calc";

export const Route = createFileRoute("/_authenticated/cogs-proveedores")({
  component: CogsProveedoresPage,
});

const TOP_N = 5;

/** Tooltip a medida: el top 5 cambia de proveedor cada mes, así que en vez de
 * una leyenda fija (que mentiría sobre qué representa cada color de mes a
 * mes), el nombre de cada proveedor se muestra al hacer hover sobre su barra. */
function TopProveedoresTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const fila = payload[0]?.payload as FilaTopMensual;
  const filasTop = [1, 2, 3, 4, 5]
    .map((k) => ({
      nombre: fila[`top${k}Nombre` as keyof FilaTopMensual] as string | null,
      usd: fila[`top${k}Usd` as keyof FilaTopMensual] as number,
    }))
    .filter((f) => f.nombre && f.usd > 0);
  return (
    <div className="bg-background border rounded-md shadow-lg px-3 py-2 text-xs space-y-1 min-w-[220px]">
      <p className="font-semibold">{label}</p>
      {filasTop.map((f) => (
        <p key={f.nombre} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorParaProveedor(f.nombre as string) }} />
            {f.nombre}
          </span>
          <span className="mono">{fmtUsd(f.usd)}</span>
        </p>
      ))}
      {fila.otros > 0 && (
        <p className="flex justify-between gap-3 text-muted-foreground">
          <span>Otros proveedores</span>
          <span className="mono">{fmtUsd(fila.otros)}</span>
        </p>
      )}
      <p className="flex justify-between gap-3 font-semibold border-t pt-1">
        <span>Total compras</span>
        <span className="mono">{fmtUsd(fila.total)}</span>
      </p>
      {fila.cogsPorDolar != null && (
        <p className="flex justify-between gap-3 text-muted-foreground">
          <span>COGS real / $ vendido</span>
          <span className="mono">{(fila.cogsPorDolar * 100).toFixed(1)}¢</span>
        </p>
      )}
    </div>
  );
}

function CogsProveedoresPage() {
  const { mode, label } = useUsdView();
  const hoy = new Date();
  // Igual que Egresos en Detalle: por defecto el mes anterior, porque el mes
  // en curso casi nunca tiene todas las compras cargadas todavía.
  const mesAnteriorD = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const [anio, setAnio] = useState(mesAnteriorD.getFullYear());
  const [mes, setMes] = useState(mesAnteriorD.getMonth() + 1);

  // Compras crudas de la cuenta 2.1 del año -- es la fuente de verdad de
  // "quién vendió qué, cuándo", distinta de la vista mensual (que agrupa
  // por afecta_gyp y excluye la 2.1 a propósito -- ver cogs-proveedores-calc.ts).
  const { data: comprasAnio, isError: comprasError } = useQuery({
    queryKey: ["cogs-proveedores-compras", anio],
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

  const { data: terceros, isError: tercerosError } = useQuery({
    queryKey: ["cogs-proveedores-terceros"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<Tercero>(async (from, to) =>
        await (supabase as any).from("terceros").select("id,nombre_comercial,razon_social").range(from, to),
      );
    },
  });

  // Mismas cuentas (afecta_gyp = true) que usa G&P / Egresos en Detalle --
  // necesarias para el indicador de "costo por dólar vendido", que compara
  // Compras contra Ingresos y COGS real del mismo período.
  const { data: cuentasGyP } = useQuery({
    queryKey: ["cogs-proveedores-cuentas-gyp"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo,orden").eq("afecta_gyp", true);
      return (data ?? []) as Cuenta[];
    },
  });

  const { data: rowsAnioGyP, isError: rowsGyPError } = useQuery({
    queryKey: ["cogs-proveedores-rows-gyp", anio, mode],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<RowGyP>(async (from, to) =>
        await (supabase as any).from(mensualView(mode)).select("*").eq("anio", anio).range(from, to),
      );
    },
  });

  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["cogs-proveedores-cogs-estimado", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
  });

  const grupoDe = useMemo(() => {
    const m = new Map<string, string>();
    (cuentasGyP ?? []).forEach((c) => { if (c.grupo) m.set(c.codigo, c.grupo); });
    return m;
  }, [cuentasGyP]);

  const nombrePorTerceroId = useMemo(() => construirNombrePorTerceroId(terceros ?? []), [terceros]);
  const nombreATerceroId = useMemo(() => construirNombreATerceroId(terceros ?? []), [terceros]);

  const ranking = useMemo(
    () => rankingProveedoresMes(comprasAnio ?? [], nombrePorTerceroId, nombreATerceroId, mes, mode),
    [comprasAnio, nombrePorTerceroId, nombreATerceroId, mes, mode],
  );

  const comprasPorMes = useMemo(
    () => totalComprasPorMes(comprasAnio ?? [], mes, mode),
    [comprasAnio, mes, mode],
  );

  const serieCostoUnitario = useMemo(
    () => construirSerieCostoUnitario(comprasPorMes, rowsAnioGyP ?? [], grupoDe, cogsEstimadoPorMes, anio, mes, mode),
    [comprasPorMes, rowsAnioGyP, grupoDe, cogsEstimadoPorMes, anio, mes, mode],
  );

  // El top 5 es POR MES (no acumulado del año) -- cada mes puede traer
  // proveedores distintos en el podio, por eso no hay una leyenda fija (ver
  // TopProveedoresTooltip arriba).
  const serieTopMensual = useMemo(
    () => construirSerieTopMensual(comprasAnio ?? [], nombrePorTerceroId, serieCostoUnitario, mes, mode, TOP_N),
    [comprasAnio, nombrePorTerceroId, serieCostoUnitario, mes, mode],
  );

  const labelMes = `${MESES[mes - 1]} ${anio}`;
  const currencyBannerClass = mode === "bcv"
    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";

  const filaMesActual = serieTopMensual[serieTopMensual.length - 1];
  const totalComprasMes = filaMesActual?.total ?? 0;
  const nProveedoresMes = ranking.length;
  const topProveedorMes = ranking[0];
  const costoMesActual = serieCostoUnitario[serieCostoUnitario.length - 1];

  return (
    <div className="space-y-6">
      <QueryErrorBanner show={comprasError || tercerosError || rowsGyPError} label="las compras por proveedor" />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">COGS / Compras en Detalle por Proveedor</h1>
          <p className="text-base text-muted-foreground mt-1">Quién vendió qué en <b>{labelMes}</b>, y con qué incidencia</p>
          <div className={`mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${currencyBannerClass}`}>
            <span className={`h-2 w-2 rounded-full ${mode === "bcv" ? "bg-blue-500" : "bg-emerald-500"}`} />
            Todos los montos de esta pantalla están en <span className="uppercase tracking-wide">{label}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
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

      <div className="text-xs bg-blue-50 text-blue-700 border border-blue-300 rounded px-2 py-1.5 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
        ℹ Esta pantalla trabaja con <b>Compras</b> (cuenta 2.1): lo que se pagó/facturó ese mes, con detalle por proveedor. No es lo mismo que el <b>COGS real</b> (cuenta 2.2, el que se ve en G&amp;P): ese es el ajuste de inventario del cierre de mes y no tiene detalle por proveedor. Compras y COGS casi siempre se mueven juntos, pero pueden separarse si se compró por adelantado (inventario sube) sin que se haya consumido todavía.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard icon={Package} label="Total compras" value={fmtUsd(totalComprasMes)} sub={`${labelMes} · ${label}`} />
        <KpiCard icon={Users} label="Proveedores con compras" value={String(nProveedoresMes)} sub={labelMes} />
        <KpiCard
          icon={Award}
          label="Proveedor con más incidencia"
          value={topProveedorMes ? topProveedorMes.nombre : "—"}
          sub={topProveedorMes ? `${fmtUsd(topProveedorMes.usd)} · ${topProveedorMes.pct.toFixed(1)}% del mes` : labelMes}
        />
        <KpiCard
          icon={Scale}
          label="Costo variable por $ vendido"
          value={costoMesActual?.comprasPorDolar != null ? `${(costoMesActual.comprasPorDolar * 100).toFixed(1)}¢` : "—"}
          sub={costoMesActual?.cogsPorDolar != null ? `COGS real: ${(costoMesActual.cogsPorDolar * 100).toFixed(1)}¢ por $ · ${label}` : label}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Compras mensuales por proveedor — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada barra son los 5 proveedores con más compras <b>ese mes</b> (no acumulado del año -- pueden cambiar de mes a mes). Cada proveedor tiene siempre el mismo color así aparezca en meses distintos; pase el cursor para ver el detalle con nombre y color. La línea punteada es el COGS real por cada dólar vendido (eje derecho).
          </p>
        </CardHeader>
        <CardContent className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serieTopMensual}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="mesLabel" fontSize={11} />
              <YAxis yAxisId="left" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(v * 100).toFixed(0)}¢`} fontSize={11} />
              <Tooltip content={<TopProveedoresTooltip />} />
              {[1, 2, 3, 4, 5].map((k) => (
                <Bar key={k} yAxisId="left" dataKey={`top${k}Usd`} stackId="a">
                  {serieTopMensual.map((fila, i) => (
                    <Cell key={i} fill={fila[`top${k}Nombre` as keyof FilaTopMensual] ? colorParaProveedor(fila[`top${k}Nombre` as keyof FilaTopMensual] as string) : "transparent"} />
                  ))}
                </Bar>
              ))}
              <Bar yAxisId="left" dataKey="otros" stackId="a" fill={COLOR_OTROS_PROVEEDOR} />
              <Line yAxisId="right" type="monotone" dataKey="cogsPorDolar" stroke="#7F1D1D" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Costo variable por dólar vendido — Enero a {MESES[mes - 1]} {anio}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cuántos centavos de Compras y de COGS real salieron por cada dólar de ingreso. Si Compras/$ sube sin que COGS/$ lo haga, se compró por adelantado (inventario sube) y el margen real del mes no se vio afectado.
          </p>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serieCostoUnitario}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="mesLabel" fontSize={11} />
              <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}¢`} fontSize={11} />
              <Tooltip formatter={(v: number) => `${(v * 100).toFixed(1)}¢ por $ vendido`} />
              <Legend />
              <Line type="monotone" dataKey="comprasPorDolar" name="Compras / $ vendido" stroke="#B45309" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="cogsPorDolar" name="COGS real / $ vendido" stroke="#7F1D1D" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Ranking de proveedores — {labelMes} · {label}</CardTitle></CardHeader>
        <CardContent>
          {ranking.length === 0 ? <p className="text-sm text-muted-foreground">Sin compras en este período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Proveedor</th>
                    <th className="text-right py-2 px-2">Compras</th>
                    <th className="text-right py-2 px-2">% del mes</th>
                    <th className="text-right py-2 px-2">Var. vs. mes anterior</th>
                    <th className="text-right py-2 px-2">Xetux</th>
                    <th className="text-right py-2 px-2">Bancario</th>
                    <th className="text-right py-2 px-2">Manual</th>
                    <th className="text-right py-2 px-2"># Facturas</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((f) => (
                    <tr key={f.nombre} className="border-b last:border-0">
                      <td className="py-2 px-2">
                        {f.terceroId ? (
                          <Link to="/proveedores/$id" params={{ id: f.terceroId }} className="text-primary hover:underline">
                            {f.nombre}
                          </Link>
                        ) : f.nombre}
                      </td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(f.usd)}</td>
                      <td className="py-2 px-2 text-right text-xs text-muted-foreground">{f.pct.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-right text-xs">
                        {f.variacionPct == null ? <span className="text-muted-foreground">—</span> : (
                          <span className={f.variacionPct > 0 ? "text-destructive" : "text-green-600"}>
                            {f.variacionPct > 0 ? "+" : ""}{f.variacionPct.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right text-xs text-muted-foreground">{f.usdXetux > 0 ? fmtUsd(f.usdXetux) : "—"}</td>
                      <td className="py-2 px-2 text-right text-xs text-muted-foreground">{f.usdBanco > 0 ? fmtUsd(f.usdBanco) : "—"}</td>
                      <td className="py-2 px-2 text-right text-xs text-muted-foreground">{f.usdManual > 0 ? fmtUsd(f.usdManual) : "—"}</td>
                      <td className="py-2 px-2 text-right text-xs text-muted-foreground">{f.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
