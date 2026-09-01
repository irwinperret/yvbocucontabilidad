import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtUsd } from "@/lib/format";
import { MESES, ordenarPorCodigo } from "@/lib/account-helpers";
import { useAuth } from "@/lib/auth-context";
import { mensualView } from "@/lib/usd-view-context";
import { estimarCogsMesesAbiertos } from "@/lib/cierre-mes";
import { Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ComposedChart, ReferenceLine } from "recharts";
import { Wrench } from "lucide-react";
import {
  CATEGORIAS, COLOR_CAT, type Cuenta, type Row, grupoDeCuentas, calcularTotalesMes,
  mesSinOperaciones, frase, construirSerieCategorias, construirSerieMargenes, construirComparativoMensual,
  construirDesglose, calcularCxpSaldos, calcularPrestamosYDividendos, fmtUsdContable,
} from "@/lib/resumen-mensual-calc";
import { PERMITIDOS_RESUMEN_MENSUAL } from "@/routes/_authenticated/resumen-ejecutivo-mensual";

export const Route = createFileRoute("/reporte-mensual-imprimir")({
  component: ReporteMensualImprimirPage,
  validateSearch: (search: Record<string, unknown>) => ({
    anio: Number(search.anio) || new Date().getFullYear(),
    mes: Number(search.mes) || new Date().getMonth() + 1,
    modo: search.modo === "paralela" ? ("paralela" as const) : ("bcv" as const),
  }),
});

const ANCHO_GRAFICO = 560;
const ALTO_GRAFICO = 250;

/** Convierte los **negrita** de frase() en <b> reales dentro de un <p>. */
function ConNegritas({ children }: { children: string }) {
  const partes = children.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {partes.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

/** Celda de tabla histórica: "—" para meses sin actividad real (en vez de $0.00). */
function celdaHistorica(v: number) {
  return Math.abs(v) < 0.005 ? "—" : fmtUsdContable(fmtUsd, v);
}

function ReporteMensualImprimirPage() {
  const { user } = useAuth();
  const { anio, mes, modo } = Route.useSearch();
  const mode = modo;
  const [listoParaImprimir, setListoParaImprimir] = useState(false);

  const { data: cuentas } = useQuery({
    queryKey: ["rie-print-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo").eq("afecta_gyp", true);
      return ordenarPorCodigo((data ?? []) as Cuenta[]);
    },
  });

  const { data: rowsAnio } = useQuery({
    queryKey: ["rie-print-rows", anio, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode))
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd").eq("anio", anio);
      return (data ?? []) as Row[];
    },
  });
  const { data: rowsPrev } = useQuery({
    queryKey: ["rie-print-rows", anio - 1, mode],
    queryFn: async () => {
      const { data } = await (supabase as any).from(mensualView(mode))
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd").eq("anio", anio - 1);
      return (data ?? []) as Row[];
    },
  });

  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["rie-print-cogs-est", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
  });
  const { data: cogsEstimadoPrev } = useQuery({
    queryKey: ["rie-print-cogs-est", anio - 1],
    queryFn: () => estimarCogsMesesAbiertos(anio - 1),
  });

  const { data: cxp } = useQuery({
    queryKey: ["rie-print-cxp", mode],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<any>(async (from, to) =>
        await supabase.from("cuentas_por_pagar")
          .select("created_at, pagada_at, estado, monto_usd, usd_bcv_factura, usd_paralelo_factura")
          .range(from, to),
      );
    },
  });

  const cargando = !cuentas || !rowsAnio || !rowsPrev || !cogsEstimadoPorMes || !cogsEstimadoPrev || !cxp;

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
  const { pagoPrestamos, dividendos } = useMemo(() => calcularPrestamosYDividendos(rowsAnio ?? [], mes), [rowsAnio, mes]);
  const sinOperaciones = mesSinOperaciones(actual.t);

  const autorizado = !!user?.email && PERMITIDOS_RESUMEN_MENSUAL.includes(user.email.toLowerCase());

  // Auto-imprimir una vez que los datos ya cargaron y los gráficos (tamaño
  // fijo, sin ResponsiveContainer) ya tuvieron tiempo de pintarse.
  useEffect(() => {
    if (cargando || !autorizado) return;
    const t = setTimeout(() => {
      setListoParaImprimir(true);
      window.print();
    }, 400);
    return () => clearTimeout(t);
  }, [cargando, autorizado]);

  if (!autorizado) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3 font-sans">
        <Wrench className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-medium">En Construcción</p>
        <p className="text-sm text-muted-foreground max-w-sm">Esta pantalla todavía no está disponible.</p>
      </div>
    );
  }

  if (cargando) {
    return <div className="p-10 text-center text-sm text-muted-foreground font-sans">Preparando el reporte para imprimir…</div>;
  }

  const labelMes = `${MESES[mes - 1]} ${anio}`;
  const labelMesAnt = `${MESES[mesAnterior - 1]} ${anioMesAnterior}`;
  const labelAnioAnt = `${MESES[mes - 1]} ${anio - 1}`;
  const modoLabel = mode === "bcv" ? "USD BCV" : "USD paralelo";

  return (
    <div className="reporte-print bg-white text-[#1a1a2e]" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      {/* 1. Encabezado */}
      <header className="flex items-baseline justify-between border-b-2 pb-2 mb-3" style={{ borderColor: "#1e3a5f" }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#1e3a5f" }}>Resumen IPA Mensual</h1>
          <p className="text-sm text-gray-600 mt-0.5">Informe ejecutivo de <b>{labelMes}</b> · montos en {modoLabel}</p>
        </div>
        {actual.estimado && (
          <div className="text-[10px] bg-amber-50 text-amber-800 border border-amber-300 rounded px-2 py-1 max-w-[260px]">
            ⚠ COGS estimado — mes abierto, sin cierre formal.
          </div>
        )}
      </header>

      {/* 2. KPIs */}
      <section className="grid grid-cols-4 gap-3 mb-3">
        {[
          { label: "Ingresos", value: fmtUsdContable(fmtUsd, ingresos), sub: labelMes },
          { label: "COGS", value: fmtUsdContable(fmtUsd, cogs), sub: actual.estimado ? "Estimado (mes abierto)" : undefined },
          { label: "Margen bruto", value: fmtUsdContable(fmtUsd, margenBruto), sub: ingresos > 0 ? `${((margenBruto / ingresos) * 100).toFixed(1)}% de ingresos` : undefined },
          { label: "Utilidad neta", value: fmtUsdContable(fmtUsd, utilidadNeta), sub: ingresos > 0 ? `${((utilidadNeta / ingresos) * 100).toFixed(1)}% de ingresos` : undefined, neg: utilidadNeta < 0 },
        ].map((k) => (
          <div key={k.label} className="rounded-md border px-3 py-2" style={{ backgroundColor: "#F7F8FA", borderColor: "#E2E5EA" }}>
            <p className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold">{k.label}</p>
            <p className={`text-lg font-bold ${k.neg ? "text-red-700" : ""}`} style={!k.neg ? { color: "#1e3a5f" } : undefined}>{k.value}</p>
            {k.sub && <p className="text-[9px] text-gray-500">{k.sub}</p>}
          </div>
        ))}
      </section>

      {/* 3. Gráficos — tamaño fijo, SVG, colores y leyendas conservados */}
      <section className="flex gap-3 mb-3" style={{ breakInside: "avoid" }}>
        <div className="flex-1 rounded-md border p-2" style={{ borderColor: "#E2E5EA" }}>
          <p className="text-[11px] font-semibold mb-1" style={{ color: "#1e3a5f" }}>Utilidad mensual por categorías — Enero a {MESES[mes - 1]} {anio}</p>
          <ComposedChart width={ANCHO_GRAFICO} height={ALTO_GRAFICO} data={serie} stackOffset="sign">
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="mesLabel" fontSize={10} />
            <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={10} />
            <ReferenceLine y={0} stroke="#1e3a5f" strokeWidth={1} />
            <Tooltip formatter={(v: number) => fmtUsd(v)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {categoriasConDatos.map((c) => (
              <Bar key={c} dataKey={c} name={c} stackId="a" fill={COLOR_CAT[c]} />
            ))}
            <Line type="monotone" dataKey="utilidad" name="Utilidad neta" stroke="#00BFFF" strokeWidth={3} dot={{ r: 3, fill: "#00BFFF" }} />
          </ComposedChart>
        </div>
        <div className="flex-1 rounded-md border p-2" style={{ borderColor: "#E2E5EA" }}>
          <p className="text-[11px] font-semibold mb-1" style={{ color: "#1e3a5f" }}>Márgenes operativos — Enero a {MESES[mes - 1]} {anio}</p>
          <ComposedChart width={ANCHO_GRAFICO} height={ALTO_GRAFICO} data={serieMargenes}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="mesLabel" fontSize={10} />
            <YAxis tickFormatter={(v) => `${v}%`} fontSize={10} width={40} />
            <Tooltip formatter={(v: number) => `${v}%`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="margenBrutoPct" name="Margen bruto %" stroke="#0F6E56" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="utilidadNetaPct" name="Utilidad neta %" stroke="#00BFFF" strokeWidth={3} dot={{ r: 3, fill: "#00BFFF" }} connectNulls />
          </ComposedChart>
        </div>
      </section>

      {/* 4. Análisis del mes */}
      <section className="rounded-md border p-3 mb-3" style={{ backgroundColor: "#F7F8FA", borderColor: "#E2E5EA", breakInside: "avoid" }}>
        <p className="text-[13px] font-bold mb-1.5" style={{ color: "#1e3a5f" }}>Análisis del mes</p>
        <div className="text-[13px] leading-relaxed space-y-1.5">
          {sinOperaciones ? (
            <p className="font-medium">{labelMes} no registra operaciones a la fecha.</p>
          ) : (
            <>
              <p className="text-gray-600">
                Así se comportó el negocio en {labelMes}, comparado con {labelMesAnt}{hayAnioPasado ? ` y con ${labelAnioAnt}` : ""}:
              </p>
              <p><ConNegritas>{frase("Los ingresos fueron", ingresos, anterior.t["Ingresos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Ingresos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas></p>
              <p><ConNegritas>{frase("El COGS fue", cogs, anterior.t["COGS"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["COGS"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas></p>
              <p><ConNegritas>{frase("Los costos fijos fueron", actual.t["Costos Fijos"] ?? 0, anterior.t["Costos Fijos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Fijos"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas></p>
              <p><ConNegritas>{frase("Los costos variables (operativos) fueron", actual.t["Costos Variables (operativos)"] ?? 0, anterior.t["Costos Variables (operativos)"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Variables (operativos)"] ?? 0 : null, labelAnioAnt, fmtUsd)}</ConNegritas></p>
              <p className="text-gray-600">
                La utilidad neta del mes fue de <b>{fmtUsdContable(fmtUsd, utilidadNeta)}</b>
                {ingresos > 0 ? ` (${((utilidadNeta / ingresos) * 100).toFixed(1)}% de los ingresos)` : ""} y la deuda con
                proveedores <b>{cxpSaldos.cambio > 0 ? "aumentó" : cxpSaldos.cambio < 0 ? "disminuyó" : "no cambió"}</b> en {fmtUsd(Math.abs(cxpSaldos.cambio))}.
              </p>
              {(pagoPrestamos > 0.01 || dividendos > 0.01) && (
                <p className="text-gray-600">
                  Además, en {labelMes}
                  {pagoPrestamos > 0.01 && <> se pagó un total de <b>{fmtUsd(pagoPrestamos)}</b> en préstamos</>}
                  {pagoPrestamos > 0.01 && dividendos > 0.01 && " y"}
                  {dividendos > 0.01 && <> se repartieron <b>{fmtUsd(dividendos)}</b> en dividendos</>}.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* 5. Desglose G&P — tabla nativa, paginación automática del navegador */}
      <section className="mb-3">
        <p className="text-[13px] font-bold mb-1.5" style={{ color: "#1e3a5f" }}>Desglose G&P — {labelMes}</p>
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#1e3a5f" }}>
              <th className="text-left py-1.5 px-2 text-white font-semibold">Cuenta</th>
              <th className="text-right py-1.5 px-2 text-white font-semibold">Monto</th>
            </tr>
          </thead>
          <tbody>
            {desglose.map((g) => (
              <Fragment key={g.cat}>
                <tr style={{ backgroundColor: "#E2E5EA", breakInside: "avoid" }}>
                  <td className="py-1 px-2 font-semibold uppercase tracking-wide text-[10px]">{g.cat}</td>
                  <td className="py-1 px-2 text-right font-semibold mono">{fmtUsdContable(fmtUsd, g.subtotal)}</td>
                </tr>
                {g.items.map((i, ii) => (
                  <tr key={`${g.cat}-${i.codigo}`} style={{ breakInside: "avoid", backgroundColor: ii % 2 === 1 ? "#FAFBFC" : "white" }}>
                    <td className="py-1 px-2 pl-6 text-gray-600 border-b" style={{ borderColor: "#EEE" }}>{i.codigo} · {i.nombre}</td>
                    <td className="py-1 px-2 text-right mono border-b" style={{ borderColor: "#EEE" }}>{fmtUsdContable(fmtUsd, i.total)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr style={{ breakInside: "avoid", borderTop: "2px solid #1e3a5f" }}>
              <td className="py-1.5 px-2 font-semibold">Margen bruto {ingresos > 0 ? `· ${((margenBruto / ingresos) * 100).toFixed(1)}%` : ""}</td>
              <td className="py-1.5 px-2 text-right font-semibold mono">{fmtUsdContable(fmtUsd, margenBruto)}</td>
            </tr>
            <tr style={{ breakInside: "avoid", backgroundColor: utilidadNeta < 0 ? "#FEE2E2" : "#DCFCE7" }}>
              <td className={`py-2 px-2 font-bold text-[13px] ${utilidadNeta < 0 ? "text-red-800" : "text-green-800"}`}>
                {utilidadNeta < 0 ? "Pérdida neta" : "Utilidad neta"} {ingresos > 0 ? `· ${((utilidadNeta / ingresos) * 100).toFixed(1)}%` : ""}
              </td>
              <td className={`py-2 px-2 text-right font-bold text-[13px] mono ${utilidadNeta < 0 ? "text-red-800" : "text-green-800"}`}>
                {fmtUsdContable(fmtUsd, utilidadNeta)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Desglose mensual histórico — Enero al mes de corte */}
      <section className="mb-3">
        <p className="text-[13px] font-bold mb-1.5" style={{ color: "#1e3a5f" }}>Desglose mensual — Enero a {MESES[mes - 1]} {anio}</p>
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#1e3a5f" }}>
              <th className="text-left py-1 px-1.5 text-white font-semibold">Categoría</th>
              {comparativoMensual.map((c) => (
                <th key={c.mesLabel} className="text-right py-1 px-1.5 text-white font-semibold whitespace-nowrap">
                  {c.mesLabel}{c.estimado ? " *" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categoriasComparativo.map((cat, ci) => (
              <tr key={cat} style={{ breakInside: "avoid", backgroundColor: ci % 2 === 1 ? "#FAFBFC" : "white" }}>
                <td className="py-1 px-1.5 border-b" style={{ borderColor: "#EEE" }}>{cat}</td>
                {comparativoMensual.map((c) => (
                  <td key={c.mesLabel} className="py-1 px-1.5 text-right mono border-b" style={{ borderColor: "#EEE" }}>{celdaHistorica(c.t[cat])}</td>
                ))}
              </tr>
            ))}
            <tr style={{ breakInside: "avoid", borderTop: "2px solid #1e3a5f", backgroundColor: "#F7F8FA" }}>
              <td className="py-1.5 px-1.5 font-bold">{comparativoMensual.some((c) => c.utilidad < 0) ? "Utilidad / pérdida neta" : "Utilidad neta"}</td>
              {comparativoMensual.map((c) => (
                <td key={c.mesLabel} className={`py-1.5 px-1.5 text-right mono font-bold ${c.utilidad < 0 ? "text-red-700" : "text-green-700"}`}>
                  {fmtUsdContable(fmtUsd, c.utilidad)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {comparativoMensual.some((c) => c.estimado) && (
          <p className="text-[9px] text-amber-700 mt-1">* Mes abierto — COGS estimado con el inventario y las compras ya cargados.</p>
        )}
      </section>

      {/* 7. Cuentas por pagar */}
      <section className="rounded-md border p-3" style={{ backgroundColor: "#F7F8FA", borderColor: "#E2E5EA", breakInside: "avoid" }}>
        <p className="text-[13px] font-bold mb-1" style={{ color: "#1e3a5f" }}>Cuentas por pagar — cambio vs. {labelMesAnt}</p>
        <p className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold">Cambio neto en la deuda con proveedores</p>
        <p className={`text-xl font-bold mono ${cxpSaldos.cambio > 0 ? "text-red-700" : "text-green-700"}`}>
          {cxpSaldos.cambio >= 0 ? "+" : "−"}{fmtUsd(Math.abs(cxpSaldos.cambio)).replace("$ ", "$")}
        </p>
        <p className="text-[11px] text-gray-600 mt-1">
          La deuda con proveedores <b>{cxpSaldos.cambio > 0 ? "aumentó" : cxpSaldos.cambio < 0 ? "disminuyó" : "no cambió"}</b> respecto a {labelMesAnt}.
        </p>
      </section>
    </div>
  );
}
