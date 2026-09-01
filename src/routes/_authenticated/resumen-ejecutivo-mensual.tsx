import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtUsd } from "@/lib/format";
import { MESES, ordenarPorCodigo } from "@/lib/account-helpers";
import { useAuth } from "@/lib/auth-context";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import { useExcelCellSelection } from "@/components/excel-cell-selection";
import { estimarCogsMesesAbiertos } from "@/lib/cierre-mes";
import {
  Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine,
} from "recharts";
import { Wrench, TrendingUp, TrendingDown, Wallet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CATEGORIAS, COLOR_CAT, type Cuenta, type Row, grupoDeCuentas, calcularTotalesMes,
  pct, frase, construirSerieCategorias, construirSerieMargenes, construirComparativoMensual,
  construirDesglose, calcularCxpSaldos, calcularPrestamosYDividendos,
} from "@/lib/resumen-mensual-calc";

export const Route = createFileRoute("/_authenticated/resumen-ejecutivo-mensual")({
  component: ResumenEjecutivoMensualPage,
});

export const PERMITIDOS_RESUMEN_MENSUAL = [
  "irwinperret@hotmail.com",
  "irwinperret@gmail.com",
  "cristobalperret@gmail.com",
  "marianaperret@gmail.com",
];

function KpiCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${tone === "neg" ? "text-destructive" : tone === "pos" ? "text-green-600" : ""}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Convierte los **negrita** de frase() en <b> reales dentro de un <p>. */
function ConNegritas({ children }: { children: string }) {
  const partes = children.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {partes.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function ResumenEjecutivoMensualPage() {
  const { user } = useAuth();
  const { mode, label } = useUsdView();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);

  const { data: cuentas } = useQuery({
    queryKey: ["rie-mensual-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo").eq("afecta_gyp", true);
      return ordenarPorCodigo((data ?? []) as Cuenta[]);
    },
  });

  // Filas mensuales del año seleccionado y del anterior (para comparativos)
  const { data: rowsAnio } = useQuery({
    queryKey: ["rie-mensual-rows", anio, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode))
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd").eq("anio", anio);
      return (data ?? []) as Row[];
    },
  });
  const { data: rowsPrev } = useQuery({
    queryKey: ["rie-mensual-rows", anio - 1, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode))
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd").eq("anio", anio - 1);
      return (data ?? []) as Row[];
    },
  });

  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["rie-mensual-cogs-est", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
  });
  const { data: cogsEstimadoPrev } = useQuery({
    queryKey: ["rie-mensual-cogs-est", anio - 1],
    queryFn: () => estimarCogsMesesAbiertos(anio - 1),
  });

  // Saldo de CxP pendiente al cierre de un mes (según el modo USD)
  const { data: cxp } = useQuery({
    queryKey: ["rie-mensual-cxp", mode],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<any>(async (from, to) =>
        await supabase.from("cuentas_por_pagar")
          .select("created_at, pagada_at, estado, monto_usd, usd_bcv_factura, usd_paralelo_factura")
          .range(from, to),
      );
    },
  });

  const grupoDe = useMemo(() => grupoDeCuentas(cuentas), [cuentas]);

  const actual = useMemo(
    () => calcularTotalesMes(rowsAnio ?? [], grupoDe, mes, cogsEstimadoPorMes, anio),
    [grupoDe, rowsAnio, mes, cogsEstimadoPorMes, anio],
  );
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const anioMesAnterior = mes === 1 ? anio - 1 : anio;
  const anterior = useMemo(
    () => calcularTotalesMes(
      mes === 1 ? (rowsPrev ?? []) : (rowsAnio ?? []),
      grupoDe,
      mesAnterior,
      mes === 1 ? cogsEstimadoPrev : cogsEstimadoPorMes,
      anioMesAnterior,
    ),
    [grupoDe, rowsAnio, rowsPrev, mes, mesAnterior, anioMesAnterior, cogsEstimadoPorMes, cogsEstimadoPrev],
  );
  const anioPasado = useMemo(
    () => calcularTotalesMes(rowsPrev ?? [], grupoDe, mes, cogsEstimadoPrev, anio - 1),
    [grupoDe, rowsPrev, mes, cogsEstimadoPrev, anio],
  );
  const hayAnioPasado = (rowsPrev ?? []).some((r) => r.mes === mes);

  const comparativoMensual = useMemo(
    () => construirComparativoMensual(rowsAnio ?? [], grupoDe, cogsEstimadoPorMes, anio, mes),
    [rowsAnio, grupoDe, cogsEstimadoPorMes, anio, mes],
  );

  const serie = useMemo(
    () => construirSerieCategorias(rowsAnio ?? [], grupoDe, cogsEstimadoPorMes, anio, mes),
    [rowsAnio, grupoDe, cogsEstimadoPorMes, anio, mes],
  );

  const categoriasConDatos = CATEGORIAS.filter((c) => serie.some((s: any) => Math.abs(s[c]) > 0.009));

  const desglose = useMemo(
    () => construirDesglose(rowsAnio ?? [], cuentas, mes, actual),
    [rowsAnio, cuentas, mes, actual],
  );

  const categoriasComparativo = CATEGORIAS.filter((cat) => comparativoMensual.some((c) => Math.abs(c.t[cat]) > 0.009));
  const valoresComparativoSeleccion = useMemo(() => [
    ...categoriasComparativo.map((cat) => comparativoMensual.map((c) => c.t[cat])),
    comparativoMensual.map((c) => c.utilidad),
  ], [categoriasComparativo, comparativoMensual]);
  const valoresGpSeleccion = useMemo(
    () => desglose.flatMap((g) => [g.subtotal, ...g.items.map((i) => i.total)]).map((v) => [v]),
    [desglose],
  );
  const seleccionComparativo = useExcelCellSelection(valoresComparativoSeleccion);
  const seleccionGp = useExcelCellSelection(valoresGpSeleccion);

  const cxpSaldos = useMemo(
    () => calcularCxpSaldos(cxp, anio, mes, mesAnterior, anioMesAnterior, mode),
    [cxp, anio, mes, mesAnterior, anioMesAnterior, mode],
  );

  const serieMargenes = useMemo(
    () => construirSerieMargenes(rowsAnio ?? [], grupoDe, cogsEstimadoPorMes, anio, mes),
    [rowsAnio, grupoDe, cogsEstimadoPorMes, anio, mes],
  );

  const ingresos = actual.t["Ingresos"] ?? 0;
  const cogs = actual.t["COGS"] ?? 0;
  const gastosTotales = CATEGORIAS.filter((c) => c !== "Ingresos").reduce((s, c) => s + (actual.t[c] ?? 0), 0);
  const margenBruto = ingresos - cogs;
  const utilidadNeta = ingresos - gastosTotales;

  const { pagoPrestamos, dividendos } = useMemo(
    () => calcularPrestamosYDividendos(rowsAnio ?? [], mes),
    [rowsAnio, mes],
  );

  const autorizado = !!user?.email && PERMITIDOS_RESUMEN_MENSUAL.includes(user.email.toLowerCase());
  if (!autorizado) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Wrench className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-medium">En Construcción</p>
        <p className="text-sm text-muted-foreground max-w-sm">Esta pantalla todavía no está disponible.</p>
      </div>
    );
  }

  const labelMes = `${MESES[mes - 1]} ${anio}`;
  const labelMesAnt = `${MESES[mesAnterior - 1]} ${anioMesAnterior}`;
  const labelAnioAnt = `${MESES[mes - 1]} ${anio - 1}`;

  const abrirImpresion = () => {
    const params = new URLSearchParams({ anio: String(anio), mes: String(mes), modo: mode });
    window.open(`/reporte-mensual-imprimir?${params.toString()}`, "_blank");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resumen IPA Mensual</h1>
          <p className="text-base text-muted-foreground mt-1">Informe ejecutivo de <b>{labelMes}</b> · montos en {label}</p>
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
          <Button variant="outline" onClick={abrirImpresion} className="self-end">
            <Printer className="h-4 w-4 mr-2" />
            Imprimir / PDF
          </Button>
        </div>
      </div>

      {actual.estimado && (
        <div className="text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded px-2 py-1.5">
          ⚠ El COGS de {labelMes} es <b>estimado</b> — el mes sigue abierto (sin cierre formal). Se calculó con el inventario y las compras ya cargados.
        </div>
      )}

      {/* Análisis del mes — primero lo que se lee, antes de los números en detalle */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Análisis del mes</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            Así se comportó el negocio en {labelMes}, comparado con {labelMesAnt}{hayAnioPasado ? ` y con ${labelAnioAnt}` : ""}:
          </p>
          <p>
            <ConNegritas>{frase("Los ingresos fueron", ingresos, anterior.t["Ingresos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Ingresos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p>
            <ConNegritas>{frase("El COGS fue", cogs, anterior.t["COGS"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["COGS"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p>
            <ConNegritas>{frase("Los costos fijos fueron", actual.t["Costos Fijos"] ?? 0, anterior.t["Costos Fijos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Fijos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p>
            <ConNegritas>{frase("Los costos variables (operativos) fueron", actual.t["Costos Variables (operativos)"] ?? 0, anterior.t["Costos Variables (operativos)"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Variables (operativos)"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p className="text-muted-foreground">
            La utilidad neta del mes fue de <b>{fmtUsd(utilidadNeta)}</b>
            {ingresos > 0 ? ` (${((utilidadNeta / ingresos) * 100).toFixed(1)}% de los ingresos)` : ""} y la deuda con
            proveedores <b>{cxpSaldos.cambio > 0 ? "aumentó" : cxpSaldos.cambio < 0 ? "disminuyó" : "no cambió"}</b> en {fmtUsd(Math.abs(cxpSaldos.cambio))}.
          </p>
          {(pagoPrestamos > 0.01 || dividendos > 0.01) && (
            <p className="text-muted-foreground">
              Además, en {labelMes}
              {pagoPrestamos > 0.01 && <> se pagó un total de <b>{fmtUsd(pagoPrestamos)}</b> en préstamos</>}
              {pagoPrestamos > 0.01 && dividendos > 0.01 && " y"}
              {dividendos > 0.01 && <> se repartieron <b>{fmtUsd(dividendos)}</b> en dividendos</>}.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard icon={TrendingUp} label="Ingresos" value={fmtUsd(ingresos)} sub={labelMes} />
        <KpiCard icon={TrendingDown} label="COGS" value={fmtUsd(cogs)} sub={actual.estimado ? "Estimado (mes abierto)" : undefined} />
        <KpiCard icon={TrendingUp} label="Margen bruto" value={fmtUsd(margenBruto)} sub={ingresos > 0 ? `${((margenBruto / ingresos) * 100).toFixed(1)}% de ingresos` : undefined} />
        <KpiCard
          icon={Wallet}
          label="Utilidad neta"
          value={fmtUsd(utilidadNeta)}
          tone={utilidadNeta >= 0 ? "pos" : "neg"}
          sub={ingresos > 0 ? `${((utilidadNeta / ingresos) * 100).toFixed(1)}% de ingresos` : undefined}
        />
      </div>

      {/* Dos gráficos lado a lado: montos por categoría, y márgenes operativos (%) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">Utilidad mensual por categorías — Enero a {MESES[mes - 1]} {anio}</CardTitle></CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} stackOffset="sign">
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mesLabel" fontSize={11} />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                <ReferenceLine y={0} stroke="#111827" strokeWidth={1} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Legend />
                {categoriasConDatos.map((c) => (
                  <Bar key={c} dataKey={c} name={c} stackId="a" fill={COLOR_CAT[c]} />
                ))}
                <Line type="monotone" dataKey="utilidad" name="Utilidad neta" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Márgenes operativos — Enero a {MESES[mes - 1]} {anio}</CardTitle></CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serieMargenes}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mesLabel" fontSize={11} />
                <YAxis tickFormatter={(v) => `${v}%`} fontSize={11} width={45} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Legend />
                <Line type="monotone" dataKey="margenBrutoPct" name="Margen bruto %" stroke="#0F6E56" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="utilidadNetaPct" name="Utilidad neta %" stroke="#00BFFF" strokeWidth={4} dot={{ r: 4, fill: "#00BFFF", stroke: "#00BFFF", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#00BFFF", stroke: "#00BFFF" }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Comparativo mensual — Enero hasta el mes de corte */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose mensual — Enero a {MESES[mes - 1]} {anio}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto select-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 text-xs uppercase text-muted-foreground">Categoría</th>
                {comparativoMensual.map((c) => (
                  <th key={c.mesLabel} className="text-right py-2 px-2 text-xs uppercase text-muted-foreground whitespace-nowrap">
                    {c.mesLabel}{c.estimado ? " *" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categoriasComparativo.map((cat, r) => (
                <tr key={cat} className="border-b last:border-0">
                  <td className="py-1.5 px-2">{cat}</td>
                  {comparativoMensual.map((c, ci) => (
                    <td
                      key={c.mesLabel}
                      onMouseDown={seleccionComparativo.startSelection(r, ci)}
                      onMouseEnter={seleccionComparativo.overSelection(r, ci)}
                      className={`py-1.5 px-2 text-right mono cursor-cell select-none ${seleccionComparativo.isSelected(r, ci) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                    >{fmtUsd(c.t[cat])}</td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2">
                <td className="py-2 px-2 font-bold">{comparativoMensual.some((c) => c.utilidad < 0) ? "Utilidad / pérdida neta" : "Utilidad neta"}</td>
                {comparativoMensual.map((c, ci) => (
                  <td
                    key={c.mesLabel}
                    onMouseDown={seleccionComparativo.startSelection(categoriasComparativo.length, ci)}
                    onMouseEnter={seleccionComparativo.overSelection(categoriasComparativo.length, ci)}
                    className={`py-2 px-2 text-right mono font-bold cursor-cell select-none ${c.utilidad < 0 ? "text-destructive" : "text-green-600"} ${seleccionComparativo.isSelected(categoriasComparativo.length, ci) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                  >
                    {fmtUsd(c.utilidad)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {comparativoMensual.some((c) => c.estimado) && (
            <p className="text-xs text-amber-700 mt-2">* Mes abierto — COGS estimado con el inventario y las compras ya cargados.</p>
          )}
        </CardContent>
      </Card>
      {seleccionComparativo.selection.count > 0 && (
        <div className="flex justify-end -mt-4">
          <div className="bg-foreground text-background text-xs rounded-md shadow-lg px-4 py-2 flex items-center gap-4 mono">
            <span>Celdas: <b>{seleccionComparativo.selection.count}</b></span>
            <span>Promedio: <b>{fmtUsd(seleccionComparativo.selection.average)}</b></span>
            <span>Suma: <b>{fmtUsd(seleccionComparativo.selection.suma)}</b></span>
          </div>
        </div>
      )}

      {/* Desglose G&P del mes */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose G&P — {labelMes}</CardTitle></CardHeader>
        <CardContent className="select-none">
          <table className="w-full text-sm">
            <tbody>
              {desglose.map((g, gi) => {
                const rowBase = desglose.slice(0, gi).reduce((n, x) => n + 1 + x.items.length, 0);
                return (
                <Fragment key={g.cat}>
                  <tr className="bg-muted/50">
                    <td className="py-1.5 px-2 text-xs font-semibold uppercase tracking-wide">{g.cat}</td>
                    <td
                      onMouseDown={seleccionGp.startSelection(rowBase, 0)}
                      onMouseEnter={seleccionGp.overSelection(rowBase, 0)}
                      className={`py-1.5 px-2 text-right mono font-semibold cursor-cell select-none ${seleccionGp.isSelected(rowBase, 0) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                    >{fmtUsd(g.subtotal)}</td>
                  </tr>
                  {g.items.map((i, ii) => (
                    <tr key={`${g.cat}-${i.codigo}`} className="border-b last:border-0">
                      <td className="py-1 px-2 pl-6 text-muted-foreground">{i.codigo} · {i.nombre}</td>
                      <td
                        onMouseDown={seleccionGp.startSelection(rowBase + 1 + ii, 0)}
                        onMouseEnter={seleccionGp.overSelection(rowBase + 1 + ii, 0)}
                        className={`py-1 px-2 text-right mono cursor-cell select-none ${seleccionGp.isSelected(rowBase + 1 + ii, 0) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                      >{fmtUsd(i.total)}</td>
                    </tr>
                  ))}
                </Fragment>
                );
              })}
              <tr className="border-t-2">
                <td className="py-2 px-2 font-semibold">Margen bruto {ingresos > 0 ? `· ${((margenBruto / ingresos) * 100).toFixed(1)}%` : ""}</td>
                <td className="py-2 px-2 text-right mono font-semibold">{fmtUsd(margenBruto)}</td>
              </tr>
              <tr className="border-t">
                <td className="py-2 px-2 font-bold text-base">{utilidadNeta < 0 ? "Pérdida neta" : "Utilidad neta"} {ingresos > 0 ? `· ${((utilidadNeta / ingresos) * 100).toFixed(1)}%` : ""}</td>
                <td className={`py-2 px-2 text-right mono font-bold text-base ${utilidadNeta < 0 ? "text-destructive" : "text-green-600"}`}>{fmtUsd(utilidadNeta)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
      {seleccionGp.selection.count > 0 && (
        <div className="flex justify-end -mt-4">
          <div className="bg-foreground text-background text-xs rounded-md shadow-lg px-4 py-2 flex items-center gap-4 mono">
            <span>Celdas: <b>{seleccionGp.selection.count}</b></span>
            <span>Promedio: <b>{fmtUsd(seleccionGp.selection.average)}</b></span>
            <span>Suma: <b>{fmtUsd(seleccionGp.selection.suma)}</b></span>
          </div>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Cuentas por pagar — cambio vs. {labelMesAnt}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs uppercase font-semibold tracking-wide text-muted-foreground">Cambio neto en la deuda con proveedores</p>
          <p className={`text-3xl font-bold mono mt-1 ${cxpSaldos.cambio > 0 ? "text-destructive" : "text-green-600"}`}>
            {cxpSaldos.cambio >= 0 ? "+" : "−"}{fmtUsd(Math.abs(cxpSaldos.cambio)).replace("$ ", "$")}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            La deuda con proveedores <b>{cxpSaldos.cambio > 0 ? "aumentó" : cxpSaldos.cambio < 0 ? "disminuyó" : "no cambió"}</b> respecto a {labelMesAnt}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
