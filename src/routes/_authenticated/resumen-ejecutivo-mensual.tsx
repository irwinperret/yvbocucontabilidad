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
import { estimarCogsMesesAbiertos, ajusteCogsEstimado } from "@/lib/cierre-mes";
import {
  Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine,
} from "recharts";
import { Wrench, TrendingUp, TrendingDown, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/resumen-ejecutivo-mensual")({
  component: ResumenEjecutivoMensualPage,
});

const PERMITIDOS = [
  "irwinperret@hotmail.com",
  "irwinperret@gmail.com",
  "cristobalperret@gmail.com",
  "marianaperret@gmail.com",
];

type Cuenta = { codigo: string; nombre: string; grupo: string };
type Row = { periodo: string; anio: number; mes: number; cuenta_codigo: string; modo: string; base_usd: number };

/** Categorías grandes en el orden en que se presentan en el informe. */
const CATEGORIAS = [
  "Ingresos",
  "COGS",
  "Costos Fijos",
  "Costos Variables (operativos)",
  "Financiamiento",
  "Otros",
  "Impuestos",
] as const;

const COLOR_CAT: Record<string, string> = {
  Ingresos: "#0F6E56",
  COGS: "#E74C3C",
  "Costos Fijos": "#534AB7",
  "Costos Variables (operativos)": "#3498DB",
  Financiamiento: "#F39C12",
  Otros: "#C38D9E",
  Impuestos: "#7F8C8D",
};

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

const pct = (actual: number, previo: number) =>
  previo > 0 ? ((actual - previo) / previo) * 100 : null;

function frase(nombre: string, actual: number, prevMes: number, labelPrevMes: string, prevAnio: number | null, labelPrevAnio: string) {
  const pm = pct(actual, prevMes);
  const pa = prevAnio != null ? pct(actual, prevAnio) : null;
  let t = `${nombre} de ${fmtUsd(actual)}`;
  if (pm != null) t += `, un ${Math.abs(pm).toFixed(1)}% ${pm >= 0 ? "más" : "menos"} que ${labelPrevMes} (${fmtUsd(prevMes)})`;
  else t += `, sin cifra comparable en ${labelPrevMes}`;
  if (pa != null) t += ` y un ${Math.abs(pa).toFixed(1)}% ${pa >= 0 ? "más" : "menos"} que ${labelPrevAnio} (${fmtUsd(prevAnio as number)})`;
  return t + ".";
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

  const grupoDe = useMemo(() => {
    const m = new Map<string, string>();
    (cuentas ?? []).forEach((c) => m.set(c.codigo, c.grupo));
    return m;
  }, [cuentas]);

  /** Totales por categoría grande para un mes dado, con COGS estimado si el mes está abierto. */
  const totalesMes = useMemo(() => {
    const calc = (rows: Row[], m: number, estimados: Map<string, { cogsUsdBcv: number }> | undefined, y: number) => {
      const t: Record<string, number> = {};
      CATEGORIAS.forEach((c) => (t[c] = 0));
      rows.filter((r) => r.mes === m).forEach((r) => {
        const g = grupoDe.get(r.cuenta_codigo);
        if (!g || !(g in t)) return;
        t[g] += Number(r.base_usd) || 0;
      });
      const { ajuste, mesesEstimados } = ajusteCogsEstimado(rows, estimados, y, [m]);
      t["COGS"] += ajuste;
      return { t, estimado: mesesEstimados.length > 0 };
    };
    return { calc };
  }, [grupoDe]);

  const actual = useMemo(
    () => totalesMes.calc(rowsAnio ?? [], mes, cogsEstimadoPorMes, anio),
    [totalesMes, rowsAnio, mes, cogsEstimadoPorMes, anio],
  );
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const anioMesAnterior = mes === 1 ? anio - 1 : anio;
  const anterior = useMemo(
    () => totalesMes.calc(
      mes === 1 ? (rowsPrev ?? []) : (rowsAnio ?? []),
      mesAnterior,
      mes === 1 ? cogsEstimadoPrev : cogsEstimadoPorMes,
      anioMesAnterior,
    ),
    [totalesMes, rowsAnio, rowsPrev, mes, mesAnterior, anioMesAnterior, cogsEstimadoPorMes, cogsEstimadoPrev],
  );
  const anioPasado = useMemo(
    () => totalesMes.calc(rowsPrev ?? [], mes, cogsEstimadoPrev, anio - 1),
    [totalesMes, rowsPrev, mes, cogsEstimadoPrev, anio],
  );
  const hayAnioPasado = (rowsPrev ?? []).some((r) => r.mes === mes);

  // Serie mensual del año para el gráfico
  const serie = useMemo(() => {
    return MESES.map((nombre, i) => {
      const { t } = totalesMes.calc(rowsAnio ?? [], i + 1, cogsEstimadoPorMes, anio);
      const gastos = CATEGORIAS.filter((c) => c !== "Ingresos").reduce((s, c) => s + t[c], 0);
      return {
        mesLabel: nombre,
        ...Object.fromEntries(CATEGORIAS.map((c) => [c, Number((c === "Ingresos" ? t[c] : -t[c]).toFixed(2))])),
        utilidad: Number((t["Ingresos"] - gastos).toFixed(2)),
      } as any;
    });
  }, [totalesMes, rowsAnio, cogsEstimadoPorMes, anio]);

  const categoriasConDatos = CATEGORIAS.filter((c) => serie.some((s: any) => Math.abs(s[c]) > 0.009));

  // Desglose G&P del mes por cuenta dentro de cada categoría
  const desglose = useMemo(() => {
    const porCuenta = new Map<string, number>();
    (rowsAnio ?? []).filter((r) => r.mes === mes).forEach((r) => {
      porCuenta.set(r.cuenta_codigo, (porCuenta.get(r.cuenta_codigo) ?? 0) + (Number(r.base_usd) || 0));
    });
    return CATEGORIAS.map((cat) => {
      const items = (cuentas ?? [])
        .filter((c) => c.grupo === cat && Math.abs(porCuenta.get(c.codigo) ?? 0) > 0.009)
        .map((c) => ({ codigo: c.codigo, nombre: c.nombre, total: porCuenta.get(c.codigo) ?? 0 }));
      if (cat === "COGS" && actual.estimado) {
        const yaSumado = items.reduce((s, i) => s + i.total, 0);
        const dif = actual.t["COGS"] - yaSumado;
        if (Math.abs(dif) > 0.009) items.push({ codigo: "2.2*", nombre: "Ajuste estimado (mes abierto)", total: dif });
      }
      return { cat, items, subtotal: items.reduce((s, i) => s + i.total, 0) };
    }).filter((g) => g.items.length > 0);
  }, [rowsAnio, cuentas, mes, actual]);

  // CxP pendiente al cierre del mes vs mes anterior
  const cxpSaldos = useMemo(() => {
    const valor = (c: any) => {
      const v = mode === "bcv" ? c.usd_bcv_factura : c.usd_paralelo_factura;
      return Number(v ?? c.monto_usd) || 0;
    };
    const saldoAl = (y: number, m: number) => {
      const corte = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString();
      return (cxp ?? [])
        .filter((c) => String(c.created_at) < corte && (!c.pagada_at || String(c.pagada_at) >= corte))
        .reduce((s, c) => s + valor(c), 0);
    };
    const hoySaldo = saldoAl(anio, mes);
    const prevSaldo = saldoAl(anioMesAnterior, mesAnterior);
    return { hoySaldo, prevSaldo, cambio: hoySaldo - prevSaldo };
  }, [cxp, anio, mes, mesAnterior, anioMesAnterior, mode]);

  const ingresos = actual.t["Ingresos"] ?? 0;
  const cogs = actual.t["COGS"] ?? 0;
  const gastosTotales = CATEGORIAS.filter((c) => c !== "Ingresos").reduce((s, c) => s + (actual.t[c] ?? 0), 0);
  const margenBruto = ingresos - cogs;
  const utilidadNeta = ingresos - gastosTotales;

  const autorizado = !!user?.email && PERMITIDOS.includes(user.email.toLowerCase());
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resumen IPA Mensual</h1>
          <p className="text-sm text-muted-foreground">Informe ejecutivo de {labelMes} · montos en {label}</p>
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

      {actual.estimado && (
        <div className="text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded px-2 py-1.5">
          ⚠ El COGS de {labelMes} es <b>estimado</b> — el mes sigue abierto (sin cierre formal). Se calculó con el inventario y las compras ya cargados.
        </div>
      )}

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

      {/* a) Gráfico de utilidad mensual por categorías grandes */}
      <Card>
        <CardHeader><CardTitle className="text-base">Utilidad mensual por categorías — {anio}</CardTitle></CardHeader>
        <CardContent style={{ height: 360 }}>
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

      {/* b) Desglose mensual de G&P */}
      <Card>
        <CardHeader><CardTitle className="text-base">Desglose G&P — {labelMes}</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {desglose.map((g) => (
                <Fragment key={g.cat}>
                  <tr className="bg-muted/50">
                    <td className="py-1.5 px-2 text-xs font-semibold uppercase tracking-wide">{g.cat}</td>
                    <td className="py-1.5 px-2 text-right mono font-semibold">{fmtUsd(g.subtotal)}</td>
                  </tr>
                  {g.items.map((i) => (
                    <tr key={`${g.cat}-${i.codigo}`} className="border-b last:border-0">
                      <td className="py-1 px-2 pl-6 text-muted-foreground">{i.codigo} · {i.nombre}</td>
                      <td className="py-1 px-2 text-right mono">{fmtUsd(i.total)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-t-2">
                <td className="py-2 px-2 font-semibold">MARGEN BRUTO {ingresos > 0 ? `· ${((margenBruto / ingresos) * 100).toFixed(1)}%` : ""}</td>
                <td className="py-2 px-2 text-right mono font-semibold">{fmtUsd(margenBruto)}</td>
              </tr>
              <tr className="border-t">
                <td className="py-2 px-2 font-bold text-base">UTILIDAD / PÉRDIDA NETA {ingresos > 0 ? `· ${((utilidadNeta / ingresos) * 100).toFixed(1)}%` : ""}</td>
                <td className={`py-2 px-2 text-right mono font-bold text-base ${utilidadNeta < 0 ? "text-destructive" : "text-green-600"}`}>{fmtUsd(utilidadNeta)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* c) Cambio en cuentas por pagar */}
      <Card>
        <CardHeader><CardTitle className="text-base">Cuentas por pagar — cambio vs. {labelMesAnt}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Saldo al cierre de {labelMes}</p>
              <p className="text-2xl font-bold mono">{fmtUsd(cxpSaldos.hoySaldo)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Saldo al cierre de {labelMesAnt}</p>
              <p className="text-2xl font-bold mono">{fmtUsd(cxpSaldos.prevSaldo)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Cambio neto</p>
              <p className={`text-2xl font-bold mono ${cxpSaldos.cambio > 0 ? "text-destructive" : "text-green-600"}`}>
                {cxpSaldos.cambio >= 0 ? "+" : "−"}{fmtUsd(Math.abs(cxpSaldos.cambio)).replace("$ ", "$")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                La deuda con proveedores {cxpSaldos.cambio > 0 ? "aumentó" : cxpSaldos.cambio < 0 ? "disminuyó" : "no cambió"} respecto al mes anterior.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* d) Texto analítico */}
      <Card>
        <CardHeader><CardTitle className="text-base">Análisis del mes</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <p>
            En {labelMes}, {frase("los ingresos fueron", ingresos, anterior.t["Ingresos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Ingresos"] ?? 0 : null, labelAnioAnt)}
          </p>
          <p>
            {frase("El COGS fue", cogs, anterior.t["COGS"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["COGS"] ?? 0 : null, labelAnioAnt)}
          </p>
          <p>
            {frase("Los costos fijos fueron", actual.t["Costos Fijos"] ?? 0, anterior.t["Costos Fijos"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Fijos"] ?? 0 : null, labelAnioAnt)}
          </p>
          <p>
            {frase("Los costos variables (operativos) fueron", actual.t["Costos Variables (operativos)"] ?? 0, anterior.t["Costos Variables (operativos)"] ?? 0, labelMesAnt, hayAnioPasado ? anioPasado.t["Costos Variables (operativos)"] ?? 0 : null, labelAnioAnt)}
          </p>
          <p className="text-muted-foreground">
            La utilidad neta del mes fue de {fmtUsd(utilidadNeta)}
            {ingresos > 0 ? ` (${((utilidadNeta / ingresos) * 100).toFixed(1)}% de los ingresos)` : ""} y la deuda con
            proveedores {cxpSaldos.cambio > 0 ? "aumentó" : cxpSaldos.cambio < 0 ? "disminuyó" : "no cambió"} en {fmtUsd(Math.abs(cxpSaldos.cambio))}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
