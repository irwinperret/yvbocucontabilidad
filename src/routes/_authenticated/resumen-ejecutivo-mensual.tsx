import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtUsd } from "@/lib/format";
import { MESES, ordenarPorCodigo } from "@/lib/account-helpers";
import { useAuth } from "@/lib/auth-context";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView, usdVisual } from "@/lib/usd-view-context";
import { useExcelCellSelection } from "@/components/excel-cell-selection";
import { NotasResumenMensual } from "@/components/notas-resumen-mensual";
import { LeyendaUtilidadMensual, construirLeyendaUtilidadMensual } from "@/components/leyenda-utilidad-mensual";
import { estimarCogsMesesAbiertos } from "@/lib/cierre-mes";
import { CUENTA_VENTA_IVA } from "@/lib/venta-iva";
import { CUENTA_RETENCION_ISLR } from "@/lib/retencion-islr-reclass";
import {
  Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine, Cell, LabelList,
} from "recharts";
import { TrendingUp, TrendingDown, Wallet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { KpiSkeletons, ChartSkeleton, TableSkeleton } from "@/components/page-skeletons";
import { QueryErrorBanner } from "@/components/query-error-banner";
import {
  CATEGORIAS, COLOR_CAT, COLOR_INGRESOS, type Cuenta, type Row, grupoDeCuentas, calcularTotalesMes,
  calcularTotalesRango, pct, frase, construirSerieCategorias, construirSerieMargenes, construirComparativoMensual,
  construirDesglose, calcularPrestamosYDividendos,
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
  // Por defecto se abre en el mes anterior al actual (el mes en curso casi
  // nunca tiene el cierre listo todavía), no en el mes de hoy.
  const mesAnteriorD = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const [anio, setAnio] = useState(mesAnteriorD.getFullYear());
  const [mes, setMes] = useState(mesAnteriorD.getMonth() + 1);
  // Ver acumulado (YTD): Enero hasta el mes de corte, en vez del mes solo.
  const [ytd, setYtd] = useState(false);
  const mesesYtd = useMemo(() => Array.from({ length: mes }, (_, i) => i + 1), [mes]);

  const { data: cuentas, isLoading: cuentasLoading } = useQuery({
    queryKey: ["rie-mensual-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo").eq("afecta_gyp", true);
      return ordenarPorCodigo((data ?? []) as Cuenta[]);
    },
  });

  // Filas mensuales del año seleccionado y del anterior (para comparativos)
  const { data: rowsAnio, isLoading: rowsAnioLoading, isError: rowsAnioError } = useQuery({
    queryKey: ["rie-mensual-rows", anio, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode))
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd").eq("anio", anio);
      return (data ?? []) as Row[];
    },
  });
  const { data: rowsPrev, isLoading: rowsPrevLoading } = useQuery({
    queryKey: ["rie-mensual-rows", anio - 1, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode))
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd").eq("anio", anio - 1);
      return (data ?? []) as Row[];
    },
  });
  const cargando = cuentasLoading || rowsAnioLoading || rowsPrevLoading;
  const conError = rowsAnioError;

  const [incluirIva, setIncluirIva] = useState(true);

  // Filas sin la cuenta 1.8 (Ingresos IVA) cuando el toggle está apagado --
  // se usan en todos los totales/series/gráficos de la página, para que
  // apagar el toggle afecte consistentemente todo el informe, no solo el
  // resumen de arriba.
  const rowsAnioFiltrado = useMemo(
    () => (incluirIva ? (rowsAnio ?? []) : (rowsAnio ?? []).filter((r) => r.cuenta_codigo !== CUENTA_VENTA_IVA)),
    [rowsAnio, incluirIva],
  );
  const rowsPrevFiltrado = useMemo(
    () => (incluirIva ? (rowsPrev ?? []) : (rowsPrev ?? []).filter((r) => r.cuenta_codigo !== CUENTA_VENTA_IVA)),
    [rowsPrev, incluirIva],
  );

  // Monto retenido por el banco por ISLR en el mes (cuenta 9.5) -- siempre
  // sobre las filas SIN filtrar por el toggle de IVA, ya que no tiene nada
  // que ver con la cuenta 1.8.
  const islrRetenidoMes = useMemo(
    () => (rowsAnio ?? []).filter((r) => r.cuenta_codigo === CUENTA_RETENCION_ISLR && r.mes === mes).reduce((s, r) => s + (Number(r.base_usd) || 0), 0),
    [rowsAnio, mes],
  );
  const islrRetenidoYtd = useMemo(
    () => (rowsAnio ?? []).filter((r) => r.cuenta_codigo === CUENTA_RETENCION_ISLR && mesesYtd.includes(r.mes)).reduce((s, r) => s + (Number(r.base_usd) || 0), 0),
    [rowsAnio, mesesYtd],
  );

  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["rie-mensual-cogs-est", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
  });
  const { data: cogsEstimadoPrev } = useQuery({
    queryKey: ["rie-mensual-cogs-est", anio - 1],
    queryFn: () => estimarCogsMesesAbiertos(anio - 1),
  });

  const { data: inventarioSnapshots } = useQuery({
    queryKey: ["rie-mensual-inventario", anio],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventario_snapshots")
        .select("periodo, tipo, monto_usd, monto_bs, tasa_bcv, tasa_paralela")
        .gte("periodo", `${anio}-01`)
        .lte("periodo", `${anio}-12`)
        .eq("tipo", "final")
        .order("periodo");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Igual que el resto de los montos del resumen: revaluado según el modo
  // (BCV o paralelo) con usdVisual, no el monto_usd crudo guardado en el
  // snapshot — antes el gráfico de inventario no se movía al cambiar de modo.
  const serieInventario = useMemo(() => {
    const porPeriodo = new Map(
      (inventarioSnapshots ?? []).map((s: any) => [s.periodo, usdVisual(s, mode) ?? 0]),
    );
    return Array.from({ length: mes }, (_, i) => {
      const periodo = `${anio}-${String(i + 1).padStart(2, "0")}`;
      return { mesLabel: MESES[i].slice(0, 3), inventario: porPeriodo.get(periodo) ?? null };
    });
  }, [inventarioSnapshots, anio, mes, mode]);

  const grupoDe = useMemo(() => grupoDeCuentas(cuentas), [cuentas]);

  const actual = useMemo(
    () => calcularTotalesMes(rowsAnioFiltrado, grupoDe, mes, cogsEstimadoPorMes, anio, mode),
    [grupoDe, rowsAnioFiltrado, mes, cogsEstimadoPorMes, anio],
  );
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const anioMesAnterior = mes === 1 ? anio - 1 : anio;
  const anterior = useMemo(
    () => calcularTotalesMes(
      mes === 1 ? rowsPrevFiltrado : rowsAnioFiltrado,
      grupoDe,
      mesAnterior,
      mes === 1 ? cogsEstimadoPrev : cogsEstimadoPorMes,
      anioMesAnterior,
      mode,
    ),
    [grupoDe, rowsAnioFiltrado, rowsPrevFiltrado, mes, mesAnterior, anioMesAnterior, cogsEstimadoPorMes, cogsEstimadoPrev],
  );
  const anioPasado = useMemo(
    () => calcularTotalesMes(rowsPrevFiltrado, grupoDe, mes, cogsEstimadoPrev, anio - 1, mode),
    [grupoDe, rowsPrevFiltrado, mes, cogsEstimadoPrev, anio],
  );
  const hayAnioPasado = (rowsPrev ?? []).some((r) => r.mes === mes);

  // Variantes YTD (Enero hasta el mes de corte) de los totales de arriba --
  // se usan en vez de `actual`/`anioPasado` cuando el switch "Ver acumulado
  // (YTD)" esta prendido. En YTD solo se compara contra el mismo rango del
  // anio anterior (no existe un "mes anterior" para un rango).
  const actualYtd = useMemo(
    () => calcularTotalesRango(rowsAnioFiltrado, grupoDe, mesesYtd, cogsEstimadoPorMes, anio, mode),
    [rowsAnioFiltrado, grupoDe, mesesYtd, cogsEstimadoPorMes, anio, mode],
  );
  const anioPasadoYtd = useMemo(
    () => calcularTotalesRango(rowsPrevFiltrado, grupoDe, mesesYtd, cogsEstimadoPrev, anio - 1, mode),
    [rowsPrevFiltrado, grupoDe, mesesYtd, cogsEstimadoPrev, anio, mode],
  );
  const hayAnioPasadoYtd = useMemo(
    () => mesesYtd.some((m) => (rowsPrev ?? []).some((r) => r.mes === m)),
    [rowsPrev, mesesYtd],
  );
  const totalesActual = ytd ? actualYtd : actual;

  const comparativoMensual = useMemo(
    () => construirComparativoMensual(rowsAnioFiltrado, grupoDe, cogsEstimadoPorMes, anio, mes, mode),
    [rowsAnioFiltrado, grupoDe, cogsEstimadoPorMes, anio, mes],
  );

  const serie = useMemo(
    () => construirSerieCategorias(rowsAnioFiltrado, grupoDe, cogsEstimadoPorMes, anio, mes, mode),
    [rowsAnioFiltrado, grupoDe, cogsEstimadoPorMes, anio, mes],
  );

  const categoriasConDatos = CATEGORIAS.filter((c) => serie.some((s: any) => Math.abs(s[c]) > 0.009));
  const leyendaUtilidadMensual = useMemo(
    () => construirLeyendaUtilidadMensual(categoriasConDatos, serie, COLOR_INGRESOS, COLOR_CAT),
    [categoriasConDatos, serie],
  );

  const desglose = useMemo(
    () => construirDesglose(rowsAnioFiltrado, cuentas, ytd ? mesesYtd : [mes], totalesActual),
    [rowsAnioFiltrado, cuentas, ytd, mesesYtd, mes, totalesActual],
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

  const serieMargenes = useMemo(
    () => construirSerieMargenes(rowsAnioFiltrado, grupoDe, cogsEstimadoPorMes, anio, mes, mode),
    [rowsAnioFiltrado, grupoDe, cogsEstimadoPorMes, anio, mes],
  );

  const ingresos = totalesActual.t["Ingresos"] ?? 0;
  const cogs = totalesActual.t["COGS"] ?? 0;
  const gastosTotales = CATEGORIAS.filter((c) => c !== "Ingresos").reduce((s, c) => s + (totalesActual.t[c] ?? 0), 0);
  const margenBruto = ingresos - cogs;
  const utilidadNeta = ingresos - gastosTotales;

  // Cuanto de los ingresos del mes corresponde a Operaciones de IVA (cuenta
  // 1.8), para la frase comparativa en el analisis -- se calcula siempre
  // sobre las filas SIN filtrar, porque el monto que queremos mostrar es
  // justamente el de esa cuenta, sin importar si el toggle esta prendido o
  // apagado.
  const ingresosIvaActual = useMemo(
    () => (rowsAnio ?? []).filter((r) => r.cuenta_codigo === CUENTA_VENTA_IVA && r.mes === mes).reduce((s, r) => s + r.base_usd, 0),
    [rowsAnio, mes],
  );
  const ingresosIvaAnterior = useMemo(
    () => (mes === 1 ? (rowsPrev ?? []) : (rowsAnio ?? []))
      .filter((r) => r.cuenta_codigo === CUENTA_VENTA_IVA && r.mes === mesAnterior)
      .reduce((s, r) => s + r.base_usd, 0),
    [rowsAnio, rowsPrev, mes, mesAnterior],
  );
  // Mismas cifras pero acumuladas Enero-hasta-el-mes-de-corte, para la frase
  // comparativa cuando el switch YTD esta prendido.
  const ingresosIvaActualYtd = useMemo(
    () => (rowsAnio ?? []).filter((r) => r.cuenta_codigo === CUENTA_VENTA_IVA && mesesYtd.includes(r.mes)).reduce((s, r) => s + r.base_usd, 0),
    [rowsAnio, mesesYtd],
  );
  const ingresosIvaAnioPasadoYtd = useMemo(
    () => (rowsPrev ?? []).filter((r) => r.cuenta_codigo === CUENTA_VENTA_IVA && mesesYtd.includes(r.mes)).reduce((s, r) => s + r.base_usd, 0),
    [rowsPrev, mesesYtd],
  );

  // "Insight" de Operaciones de IVA para el analisis del mes: cuanta
  // utilidad neta hubiera habido SIN esos ingresos, para que quede claro
  // que tanto depende el resultado del mes/periodo de esa partida --
  // con una advertencia si esa utilidad "limpia" sale muy baja o negativa.
  // Como el toggle "Incluir Ingresos IVA" solo filtra la cuenta 1.8 (no
  // tiene COGS/costos propios asociados), quitar ese ingreso resta directo
  // de la utilidad neta ya calculada, sin tener que re-sumar nada mas.
  const ingresosIvaParaAnalisis = ytd ? ingresosIvaActualYtd : ingresosIvaActual;
  const utilidadSinIva = utilidadNeta - ingresosIvaParaAnalisis;
  const ingresosSinIva = ingresos - ingresosIvaParaAnalisis;
  const margenSinIva = ingresosSinIva > 0 ? (utilidadSinIva / ingresosSinIva) * 100 : null;
  // Umbral de "muy baja": perdida, o margen neto por debajo de 5%.
  const utilidadSinIvaBaja = utilidadSinIva <= 0 || (margenSinIva !== null && margenSinIva < 5);

  const { pagoPrestamos, dividendos } = useMemo(
    () => calcularPrestamosYDividendos(rowsAnio ?? [], ytd ? mesesYtd : mes),
    [rowsAnio, mes, ytd, mesesYtd],
  );
  // Opcional y apagado por defecto: el PDF solo menciona préstamos/dividendos
  // si el usuario lo marca acá antes de imprimir.
  const [incluirPrestamosDividendos, setIncluirPrestamosDividendos] = useState(false);

  // La pantalla ya es visible para cualquier usuario autenticado. Esta lista
  // ahora solo controla quién puede ver/incluir préstamos y dividendos (dato
  // sensible), acá y en la versión imprimible.
  const autorizado = !!user?.email && PERMITIDOS_RESUMEN_MENSUAL.includes(user.email.toLowerCase());

  const labelMes = `${MESES[mes - 1]} ${anio}`;
  const labelMesAnt = `${MESES[mesAnterior - 1]} ${anioMesAnterior}`;
  const labelAnioAnt = `${MESES[mes - 1]} ${anio - 1}`;
  const labelYtd = `Ene–${MESES[mes - 1]} ${anio}`;
  const labelAnioAntYtd = `Ene–${MESES[mes - 1]} ${anio - 1}`;
  const labelPeriodo = ytd ? labelYtd : labelMes;

  // Qué pestaña está activa -- así el botón "Imprimir / PDF" manda la misma
  // versión (detallado o visual) que la persona está viendo en pantalla.
  const [vistaActiva, setVistaActiva] = useState<"detallado" | "visual">("detallado");

  const abrirImpresion = () => {
    const params = new URLSearchParams({
      anio: String(anio),
      mes: String(mes),
      modo: mode,
      incluirPrestamosDividendos: incluirPrestamosDividendos ? "1" : "0",
      incluirIva: incluirIva ? "1" : "0",
      ytd: ytd ? "1" : "0",
      vista: vistaActiva,
    });
    window.open(`/reporte-mensual-imprimir?${params.toString()}`, "_blank");
  };

  const currencyBannerClass = mode === "bcv"
    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";

  // --- Datos derivados solo para la pestaña "Resumen visual" ---

  // Mismo desglose por cuenta que ya usa "Desglose G&P", sin la categoría
  // Ingresos (esta tabla es solo de costos).
  const desgloseCostos = useMemo(() => desglose.filter((g) => g.cat !== "Ingresos"), [desglose]);
  const totalCostos = useMemo(() => desgloseCostos.reduce((s, g) => s + g.subtotal, 0), [desgloseCostos]);
  // Seleccion de celdas tipo Excel (clic y arrastra) para "Desglose de
  // costos" -- mismo patron que seleccionGp en "Desglose G&P".
  const valoresCostosSeleccion = useMemo(
    () => desgloseCostos.flatMap((g) => [g.subtotal, ...g.items.map((i) => i.total)]).map((v) => [v]),
    [desgloseCostos],
  );
  const seleccionCostos = useExcelCellSelection(valoresCostosSeleccion);

  // Ingresos vs. utilidad neta, mes a mes -- mismos números que el gráfico
  // de categorías de arriba, solo que consolidados en dos líneas.
  const serieTrend = useMemo(
    () => serie.map((s: any) => ({
      mesLabel: s.mesLabel,
      ingresos: Number((s.ingresosConvencional + s.ingresosOffBalance + s.ingresosIva).toFixed(2)),
      utilidad: s.utilidad,
    })),
    [serie],
  );

  // Egresos del período de corte por categoría grande, para el gráfico de barras.
  const desgloseChart = useMemo(
    () => CATEGORIAS.filter((c) => c !== "Ingresos" && Math.abs(totalesActual.t[c] ?? 0) > 0.009)
      .map((c) => ({ cat: c, monto: totalesActual.t[c] ?? 0 })),
    [totalesActual],
  );

  // Racha de meses seguidos (terminando en el mes de corte) con margen bruto > 60%.
  const rachaMargenBruto = useMemo(() => {
    let n = 0;
    for (let i = serieMargenes.length - 1; i >= 0; i--) {
      if (serieMargenes[i].margenBrutoPct != null && (serieMargenes[i].margenBrutoPct as number) > 60) n++;
      else break;
    }
    return n;
  }, [serieMargenes]);

  // Variación de costos fijos vs. el período comparable anterior (mes
  // anterior si se ve un mes individual, mismo rango del año pasado si se ve YTD).
  const costosFijosPrevLabel = ytd ? labelAnioAntYtd : labelMesAnt;
  const costosFijosPrevValor = ytd ? (anioPasadoYtd.t["Costos Fijos"] ?? 0) : (anterior.t["Costos Fijos"] ?? 0);
  const costosFijosPct = pct(totalesActual.t["Costos Fijos"] ?? 0, costosFijosPrevValor);

  // Gastos financieros bancarios (cuenta 4.8) como % de Costos Variables (operativos).
  const grupoCostosVariables = desgloseCostos.find((g) => g.cat === "Costos Variables (operativos)");
  const gastosBancarios = grupoCostosVariables?.items.find((i) => i.codigo === "4.8");
  const gastosBancariosPct = gastosBancarios && grupoCostosVariables && grupoCostosVariables.subtotal > 0
    ? (gastosBancarios.total / grupoCostosVariables.subtotal) * 100
    : null;

  return (
    <div className="space-y-6">
      <QueryErrorBanner show={conError} label="los datos del resumen mensual" />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resumen IPA Mensual</h1>
          <p className="text-base text-muted-foreground mt-1">Informe ejecutivo de <b>{labelMes}</b></p>
          <div className={`mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${currencyBannerClass}`}>
            <span className={`h-2 w-2 rounded-full ${mode === "bcv" ? "bg-blue-500" : "bg-emerald-500"}`} />
            Todos los montos de este informe están en <span className="uppercase tracking-wide">{label}</span>
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
          <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={ytd} onCheckedChange={setYtd} id="ver-ytd" />
            Ver acumulado (YTD)
          </label>
          <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={incluirIva} onCheckedChange={setIncluirIva} id="incluir-iva" />
            Incluir Ingresos IVA
          </label>
          {autorizado && (pagoPrestamos > 0.01 || dividendos > 0.01) && (
            <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-muted-foreground cursor-pointer">
              <Checkbox
                checked={incluirPrestamosDividendos}
                onCheckedChange={(v) => setIncluirPrestamosDividendos(v === true)}
              />
              Incluir préstamos/dividendos en el PDF
            </label>
          )}
          <Button variant="outline" onClick={abrirImpresion} className="self-end">
            <Printer className="h-4 w-4 mr-2" />
            Imprimir / PDF
          </Button>
        </div>
      </div>

      <Tabs value={vistaActiva} onValueChange={(v) => setVistaActiva(v as "detallado" | "visual")}>
        <TabsList>
          <TabsTrigger value="detallado">Detallado</TabsTrigger>
          <TabsTrigger value="visual">Resumen visual</TabsTrigger>
        </TabsList>

        <TabsContent value="detallado" className="space-y-6">
      {cargando ? (
        <div className="space-y-6">
          <KpiSkeletons count={4} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <TableSkeleton rows={8} />
        </div>
      ) : (
      <>

      {totalesActual.estimado && (
        <div className="text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded px-2 py-1.5">
          ⚠ El COGS de {totalesActual.mesesEstimados.map((m: number) => MESES[m - 1]).join(", ")} es <b>estimado</b> — {totalesActual.mesesEstimados.length > 1 ? "esos meses siguen abiertos" : "el mes sigue abierto"} (sin cierre formal). Se calculó con el inventario y las compras ya cargados.
        </div>
      )}

      <div className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-1.5">
        ℹ Los ingresos <b>no incluyen</b> el 10% de servicio ni la propina — ambos se registran como pasivo por pagar al personal, no como venta.
      </div>

      {incluirIva ? (
        <div className="text-xs bg-red-50 text-red-700 border border-red-300 rounded px-2 py-1.5 font-medium">
          ⚠ Estas cifras <b>SÍ incluyen</b> las operaciones de Venta de IVA (cuenta 1.8).
        </div>
      ) : (
        <div className="text-xs bg-slate-100 text-slate-600 border border-slate-300 rounded px-2 py-1.5">
          ℹ Estas cifras <b>no incluyen</b> las operaciones de Venta de IVA (cuenta 1.8).
        </div>
      )}

      {(ytd ? islrRetenidoYtd : islrRetenidoMes) > 0.01 ? (
        <div className="text-xs bg-red-50 text-red-700 border border-red-300 rounded px-2 py-1.5 font-medium">
          ⚠ El banco retuvo <b>{fmtUsd(ytd ? islrRetenidoYtd : islrRetenidoMes)}</b> por ISLR en {labelPeriodo} (5% de las transacciones con tarjeta de crédito).
        </div>
      ) : (
        <div className="text-xs bg-slate-100 text-slate-600 border border-slate-300 rounded px-2 py-1.5">
          ℹ Retención ISLR en {labelPeriodo}: <b>$0.00</b> — todavía no se ha registrado {ytd ? "en este rango" : "este mes"} (no significa que el banco no haya retenido nada).
        </div>
      )}

      {/* Análisis del mes — primero lo que se lee, antes de los números en detalle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            Análisis del mes
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${currencyBannerClass}`}>{label}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            {ytd ? (
              <>Así se comportó el negocio acumulado de {labelYtd} <b>(en {label})</b>{hayAnioPasadoYtd ? `, comparado con ${labelAnioAntYtd}` : ""}:</>
            ) : (
              <>Así se comportó el negocio en {labelMes} <b>(en {label})</b>, comparado con {labelMesAnt}{hayAnioPasado ? ` y con ${labelAnioAnt}` : ""}:</>
            )}
          </p>
          <p>
            <ConNegritas>{ytd
              ? frase("Los ingresos acumulados fueron", ingresos, hayAnioPasadoYtd ? anioPasadoYtd.t["Ingresos"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("Los ingresos fueron", ingresos, anterior.t["Ingresos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Ingresos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          {incluirIva && (
            <p>
              <ConNegritas>{ytd
                ? frase("De eso, Operaciones de IVA representaron", ingresosIvaActualYtd, hayAnioPasadoYtd ? ingresosIvaAnioPasadoYtd : 0, labelAnioAntYtd, null, "", fmtUsd)
                : frase("De eso, Operaciones de IVA representaron", ingresosIvaActual, ingresosIvaAnterior, labelMesAnt, null, labelAnioAnt, fmtUsd)}</ConNegritas>
            </p>
          )}
          <p>
            <ConNegritas>{ytd
              ? frase("El COGS fue", cogs, hayAnioPasadoYtd ? anioPasadoYtd.t["COGS"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("El COGS fue", cogs, anterior.t["COGS"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["COGS"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p>
            <ConNegritas>{ytd
              ? frase("Los costos fijos fueron", totalesActual.t["Costos Fijos"] ?? 0, hayAnioPasadoYtd ? anioPasadoYtd.t["Costos Fijos"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("Los costos fijos fueron", actual.t["Costos Fijos"] ?? 0, anterior.t["Costos Fijos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Fijos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p>
            <ConNegritas>{ytd
              ? frase("Los costos variables (operativos) fueron", totalesActual.t["Costos Variables (operativos)"] ?? 0, hayAnioPasadoYtd ? anioPasadoYtd.t["Costos Variables (operativos)"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("Los costos variables (operativos) fueron", actual.t["Costos Variables (operativos)"] ?? 0, anterior.t["Costos Variables (operativos)"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Variables (operativos)"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p className="text-muted-foreground">
            La utilidad neta {ytd ? "acumulada" : "del mes"} fue de <b>{fmtUsd(utilidadNeta)}</b>
            {ingresos > 0 ? ` (${((utilidadNeta / ingresos) * 100).toFixed(1)}% de los ingresos)` : ""}.
          </p>
          {autorizado && (pagoPrestamos > 0.01 || dividendos > 0.01) && (
            <p className="text-muted-foreground">
              Además, en {ytd ? labelYtd : labelMes}
              {pagoPrestamos > 0.01 && <> se pagó un total de <b>{fmtUsd(pagoPrestamos)}</b> en préstamos</>}
              {pagoPrestamos > 0.01 && dividendos > 0.01 && " y"}
              {dividendos > 0.01 && <> se repartieron <b>{fmtUsd(dividendos)}</b> en dividendos</>}.
            </p>
          )}
          {incluirIva && (
            <p className="text-blue-700 dark:text-blue-400">
              Sin los ingresos de Operaciones de IVA, la utilidad neta {ytd ? "acumulada" : "del mes"} hubiera sido de{" "}
              <b>{fmtUsd(utilidadSinIva)}</b>
              {ingresosSinIva > 0 ? ` (${margenSinIva!.toFixed(1)}% de los ingresos)` : ""} en vez de {fmtUsd(utilidadNeta)}.
              {utilidadSinIvaBaja && (
                <> <b>⚠ {utilidadSinIva <= 0 ? "Sería pérdida" : "Muy ajustada"}</b> -- vale la pena revisar qué tanto depende el resultado de las operaciones de IVA.</>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <NotasResumenMensual periodo={`${anio}-${String(mes).padStart(2, "0")}`} />

      <p className={`text-sm font-bold text-center ${incluirIva ? "text-red-700" : "text-slate-600"}`}>
        {incluirIva
          ? "⚠ Los números de abajo SÍ incluyen Ingresos por Venta de IVA."
          : "ℹ Los números de abajo NO incluyen Ingresos por Venta de IVA."}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard icon={TrendingUp} label="Ingresos" value={fmtUsd(ingresos)} sub={`${labelPeriodo} · ${label}`} />
        <KpiCard icon={TrendingDown} label="COGS" value={fmtUsd(cogs)} sub={totalesActual.estimado ? `Estimado (${ytd ? "meses abiertos" : "mes abierto"}) · ${label}` : label} />
        <KpiCard icon={TrendingUp} label="Margen bruto" value={fmtUsd(margenBruto)} sub={ingresos > 0 ? `${((margenBruto / ingresos) * 100).toFixed(1)}% de ingresos · ${label}` : label} />
        <KpiCard
          icon={Wallet}
          label="Utilidad neta"
          value={fmtUsd(utilidadNeta)}
          tone={utilidadNeta >= 0 ? "pos" : "neg"}
          sub={ingresos > 0 ? `${((utilidadNeta / ingresos) * 100).toFixed(1)}% de ingresos · ${label}` : label}
        />
      </div>

      {/* Tres gráficos: utilidad por categorías, márgenes operativos e inventario mensual */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">Utilidad mensual por categorías — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
          <CardContent className="h-[400px] flex flex-col">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="mesLabel" fontSize={11} />
                  <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                  <ReferenceLine y={0} stroke="#111827" strokeWidth={1} />
                  <Tooltip formatter={(v: number) => fmtUsd(v)} />
                  {categoriasConDatos.includes("Ingresos") && (
                    <Bar dataKey="ingresosConvencional" name="Ingresos convencionales" stackId="a" fill={COLOR_INGRESOS.convencional} />
                  )}
                  {categoriasConDatos.includes("Ingresos") && serie.some((s: any) => Math.abs(s.ingresosOffBalance) > 0.009) && (
                    <Bar dataKey="ingresosOffBalance" name="Ingresos off-balance (ajuste)" stackId="a" fill={COLOR_INGRESOS.offBalance} />
                  )}
                  {categoriasConDatos.includes("Ingresos") && serie.some((s: any) => Math.abs(s.ingresosIva) > 0.009) && (
                    <Bar dataKey="ingresosIva" name="Ingresos Venta de IVA" stackId="a" fill={COLOR_INGRESOS.iva} />
                  )}
                  {categoriasConDatos.filter((c) => c !== "Ingresos").map((c) => (
                    <Bar key={c} dataKey={c} name={c} stackId="a" fill={COLOR_CAT[c]} />
                  ))}
                  <Line type="monotone" dataKey="utilidad" name="Utilidad neta" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <LeyendaUtilidadMensual ingresos={leyendaUtilidadMensual.ingresos} egresos={leyendaUtilidadMensual.egresos} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Márgenes operativos — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serieMargenes}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mesLabel" fontSize={11} />
                <YAxis tickFormatter={(v) => `${v}%`} fontSize={11} width={45} />
                <ReferenceLine y={0} stroke="#000000" strokeDasharray="4 4" strokeWidth={1} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Legend />
                <Line type="monotone" dataKey="margenBrutoPct" name="Margen bruto %" stroke="#0F6E56" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="utilidadNetaPct" name="Utilidad neta %" stroke="#00BFFF" strokeWidth={4} dot={{ r: 4, fill: "#00BFFF", stroke: "#00BFFF", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#00BFFF", stroke: "#00BFFF" }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Nivel de inventario mensual — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serieInventario}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mesLabel" fontSize={11} />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Legend />
                <Bar dataKey="inventario" name="Inventario final" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Comparativo mensual — Enero hasta el mes de corte */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose mensual — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
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
        <CardHeader><CardTitle className="text-lg">Desglose G&P — {labelPeriodo} · {label}</CardTitle></CardHeader>
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

      </>
      )}
        </TabsContent>

        <TabsContent value="visual" className="space-y-6">
      {cargando ? (
        <div className="space-y-6">
          <KpiSkeletons count={4} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <TableSkeleton rows={8} />
        </div>
      ) : (
      <>

      <div className="flex flex-wrap gap-2">
        {totalesActual.estimado && (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-300">
            ⚠ COGS {totalesActual.mesesEstimados.length > 1 ? "de varios meses" : "del mes"} estimado (mes abierto)
          </span>
        )}
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          ℹ Ingresos no incluyen servicio (10%) ni propina.
        </span>
        {incluirIva ? (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-300">
            ⚠ Incluye operaciones de Venta de IVA (cuenta 1.8).
          </span>
        ) : (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-300">
            ℹ No incluye operaciones de Venta de IVA (cuenta 1.8).
          </span>
        )}
        {(ytd ? islrRetenidoYtd : islrRetenidoMes) > 0.01 ? (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-300">
            ⚠ Retención ISLR: {fmtUsd(ytd ? islrRetenidoYtd : islrRetenidoMes)}
          </span>
        ) : (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-300">
            ℹ Retención ISLR: $0.00 — aún no se registra {ytd ? "en este rango" : "este mes"}.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard icon={TrendingUp} label="Ingresos" value={fmtUsd(ingresos)} sub={`${labelPeriodo} · ${label}`} />
        <KpiCard icon={TrendingDown} label="COGS" value={fmtUsd(cogs)} sub={totalesActual.estimado ? `Estimado · ${label}` : label} />
        <KpiCard icon={TrendingUp} label="Margen bruto" value={fmtUsd(margenBruto)} sub={ingresos > 0 ? `${((margenBruto / ingresos) * 100).toFixed(1)}% de ingresos` : label} />
        <KpiCard
          icon={Wallet}
          label="Utilidad neta"
          value={fmtUsd(utilidadNeta)}
          tone={utilidadNeta >= 0 ? "pos" : "neg"}
          sub={ingresos > 0 ? `${((utilidadNeta / ingresos) * 100).toFixed(1)}% de ingresos` : label}
        />
      </div>

      {/* Análisis del mes -- mismo texto que en la pestaña Detallado */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            Análisis del mes
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${currencyBannerClass}`}>{label}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            {ytd ? (
              <>Así se comportó el negocio acumulado de {labelYtd} <b>(en {label})</b>{hayAnioPasadoYtd ? `, comparado con ${labelAnioAntYtd}` : ""}:</>
            ) : (
              <>Así se comportó el negocio en {labelMes} <b>(en {label})</b>, comparado con {labelMesAnt}{hayAnioPasado ? ` y con ${labelAnioAnt}` : ""}:</>
            )}
          </p>
          <p>
            <ConNegritas>{ytd
              ? frase("Los ingresos acumulados fueron", ingresos, hayAnioPasadoYtd ? anioPasadoYtd.t["Ingresos"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("Los ingresos fueron", ingresos, anterior.t["Ingresos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Ingresos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          {incluirIva && (
            <p>
              <ConNegritas>{ytd
                ? frase("De eso, Operaciones de IVA representaron", ingresosIvaActualYtd, hayAnioPasadoYtd ? ingresosIvaAnioPasadoYtd : 0, labelAnioAntYtd, null, "", fmtUsd)
                : frase("De eso, Operaciones de IVA representaron", ingresosIvaActual, ingresosIvaAnterior, labelMesAnt, null, labelAnioAnt, fmtUsd)}</ConNegritas>
            </p>
          )}
          <p>
            <ConNegritas>{ytd
              ? frase("El COGS fue", cogs, hayAnioPasadoYtd ? anioPasadoYtd.t["COGS"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("El COGS fue", cogs, anterior.t["COGS"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["COGS"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p>
            <ConNegritas>{ytd
              ? frase("Los costos fijos fueron", totalesActual.t["Costos Fijos"] ?? 0, hayAnioPasadoYtd ? anioPasadoYtd.t["Costos Fijos"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("Los costos fijos fueron", actual.t["Costos Fijos"] ?? 0, anterior.t["Costos Fijos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Fijos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p>
            <ConNegritas>{ytd
              ? frase("Los costos variables (operativos) fueron", totalesActual.t["Costos Variables (operativos)"] ?? 0, hayAnioPasadoYtd ? anioPasadoYtd.t["Costos Variables (operativos)"] ?? 0 : 0, labelAnioAntYtd, null, "", fmtUsd)
              : frase("Los costos variables (operativos) fueron", actual.t["Costos Variables (operativos)"] ?? 0, anterior.t["Costos Variables (operativos)"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Variables (operativos)"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas>
          </p>
          <p className="text-muted-foreground">
            La utilidad neta {ytd ? "acumulada" : "del mes"} fue de <b>{fmtUsd(utilidadNeta)}</b>
            {ingresos > 0 ? ` (${((utilidadNeta / ingresos) * 100).toFixed(1)}% de los ingresos)` : ""}.
          </p>
          {autorizado && (pagoPrestamos > 0.01 || dividendos > 0.01) && (
            <p className="text-muted-foreground">
              Además, en {ytd ? labelYtd : labelMes}
              {pagoPrestamos > 0.01 && <> se pagó un total de <b>{fmtUsd(pagoPrestamos)}</b> en préstamos</>}
              {pagoPrestamos > 0.01 && dividendos > 0.01 && " y"}
              {dividendos > 0.01 && <> se repartieron <b>{fmtUsd(dividendos)}</b> en dividendos</>}.
            </p>
          )}
          {incluirIva && (
            <p className="text-blue-700 dark:text-blue-400">
              Sin los ingresos de Operaciones de IVA, la utilidad neta {ytd ? "acumulada" : "del mes"} hubiera sido de{" "}
              <b>{fmtUsd(utilidadSinIva)}</b>
              {ingresosSinIva > 0 ? ` (${margenSinIva!.toFixed(1)}% de los ingresos)` : ""} en vez de {fmtUsd(utilidadNeta)}.
              {utilidadSinIvaBaja && (
                <> <b>⚠ {utilidadSinIva <= 0 ? "Sería pérdida" : "Muy ajustada"}</b> -- vale la pena revisar qué tanto depende el resultado de las operaciones de IVA.</>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">Ingresos vs. utilidad neta — Enero a {MESES[mes - 1]} {anio} · {label}</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serieTrend}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mesLabel" fontSize={11} />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Legend />
                <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke={COLOR_INGRESOS.convencional} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="utilidad" name="Utilidad neta" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">¿En qué se fue la plata? — {labelPeriodo} · {label}</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={desgloseChart} margin={{ top: 24, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
                <XAxis dataKey="cat" fontSize={11} interval={0} angle={-12} textAnchor="end" height={60} />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Bar dataKey="monto" radius={[4, 4, 0, 0]}>
                  {desgloseChart.map((d) => <Cell key={d.cat} fill={COLOR_CAT[d.cat]} />)}
                  <LabelList dataKey="monto" position="top" formatter={(v: number) => fmtUsd(v)} fontSize={11} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Desglose de costos -- las mismas cuentas del Desglose G&P, sin Ingresos */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Desglose de costos — {labelPeriodo} · {label}</CardTitle></CardHeader>
        <CardContent className="select-none">
          <table className="w-full text-sm">
            <tbody>
              {desgloseCostos.map((g, gi) => {
                const rowBase = desgloseCostos.slice(0, gi).reduce((n, x) => n + 1 + x.items.length, 0);
                return (
                <Fragment key={g.cat}>
                  <tr className="bg-muted/50">
                    <td className="py-1.5 px-2 text-xs font-semibold uppercase tracking-wide">{g.cat}</td>
                    <td
                      onMouseDown={seleccionCostos.startSelection(rowBase, 0)}
                      onMouseEnter={seleccionCostos.overSelection(rowBase, 0)}
                      className={`py-1.5 px-2 text-right mono font-semibold cursor-cell select-none ${seleccionCostos.isSelected(rowBase, 0) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                    >{fmtUsd(g.subtotal)}</td>
                  </tr>
                  {g.items.map((i, ii) => (
                    <tr key={`${g.cat}-${i.codigo}`} className="border-b last:border-0">
                      <td className="py-1 px-2 pl-6 text-muted-foreground">{i.codigo} · {i.nombre}</td>
                      <td
                        onMouseDown={seleccionCostos.startSelection(rowBase + 1 + ii, 0)}
                        onMouseEnter={seleccionCostos.overSelection(rowBase + 1 + ii, 0)}
                        className={`py-1 px-2 text-right mono cursor-cell select-none ${seleccionCostos.isSelected(rowBase + 1 + ii, 0) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                      >{fmtUsd(i.total)}</td>
                    </tr>
                  ))}
                </Fragment>
                );
              })}
              <tr className="border-t-2">
                <td className="py-2 px-2 font-bold">Total de costos</td>
                <td className="py-2 px-2 text-right mono font-bold">{fmtUsd(totalCostos)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
      {seleccionCostos.selection.count > 0 && (
        <div className="flex justify-end -mt-4">
          <div className="bg-foreground text-background text-xs rounded-md shadow-lg px-4 py-2 flex items-center gap-4 mono">
            <span>Celdas: <b>{seleccionCostos.selection.count}</b></span>
            <span>Promedio: <b>{fmtUsd(seleccionCostos.selection.average)}</b></span>
            <span>Suma: <b>{fmtUsd(seleccionCostos.selection.suma)}</b></span>
          </div>
        </div>
      )}

      {(rachaMargenBruto >= 2 || costosFijosPct != null || gastosBancariosPct != null) && (
        <div className="flex flex-wrap gap-2">
          {rachaMargenBruto >= 2 && (
            <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border bg-card">
              <span className="text-green-600">●</span> Margen bruto arriba de 60% por {rachaMargenBruto}.º mes seguido
            </span>
          )}
          {costosFijosPct != null && (
            <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border bg-card">
              <span className={costosFijosPct <= 0 ? "text-green-600" : "text-amber-600"}>●</span>
              {" "}Costos fijos {costosFijosPct >= 0 ? "+" : "−"}{Math.abs(costosFijosPct).toFixed(1)}% vs {costosFijosPrevLabel}
            </span>
          )}
          {gastosBancariosPct != null && (
            <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border bg-amber-50 border-amber-200">
              <span className="text-amber-600">●</span> Gastos bancarios: {gastosBancariosPct.toFixed(1)}% de costos variables
            </span>
          )}
        </div>
      )}

      <div className="border-t pt-3 text-xs text-muted-foreground">
        Generado automáticamente a partir del plan de cuentas · Montos en {label} · No incluye servicio (10%) ni propina.
      </div>

      </>
      )}
        </TabsContent>
      </Tabs>

    </div>
  );
}
