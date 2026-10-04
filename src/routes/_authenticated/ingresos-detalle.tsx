import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtUsd } from "@/lib/format";
import { MESES, ordenarPorCodigo } from "@/lib/account-helpers";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView } from "@/lib/usd-view-context";
import {
  Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine,
} from "recharts";
import { TrendingUp, SlidersHorizontal, Receipt, Wallet } from "lucide-react";
import {
  construirSerieIngresos, construirDesgloseIngresos, calcularTotalesIngresosMes,
  type RowIngresoRaw, type CuentaIngreso,
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

// ---------- Tabla "tipo Excel": selección por clic-y-arrastre + suma/promedio ----------
// Mismo patrón que la tabla "Comparativo mensual" de Ganancias y Pérdidas (gyp.tsx).
type FilaExcel = { label: string; valores: number[]; extra?: string[]; bold?: boolean };

function TablaExcel({ columnas, filas, extraCols }: { columnas: string[]; filas: FilaExcel[]; extraCols?: string[] }) {
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ r: number; c: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ r: number; c: number } | null>(null);

  const enRango = (r: number, c: number) => {
    if (!selStart || !selEnd) return false;
    const r0 = Math.min(selStart.r, selEnd.r), r1 = Math.max(selStart.r, selEnd.r);
    const c0 = Math.min(selStart.c, selEnd.c), c1 = Math.max(selStart.c, selEnd.c);
    return r >= r0 && r <= r1 && c >= c0 && c <= c1;
  };
  const startSel = (r: number, c: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setSelecting(true);
    setSelStart({ r, c });
    setSelEnd({ r, c });
  };
  const overSel = (r: number, c: number) => () => { if (selecting) setSelEnd({ r, c }); };

  useEffect(() => {
    const stop = () => setSelecting(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const seleccion = useMemo(() => {
    if (!selStart || !selEnd) return { suma: 0, count: 0 };
    let suma = 0, count = 0;
    filas.forEach((f, r) => f.valores.forEach((v, c) => { if (enRango(r, c)) { suma += v; count++; } }));
    return { suma, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStart, selEnd, filas]);

  return (
    <div className="select-none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-2 sticky left-0 bg-background z-10 text-xs uppercase text-muted-foreground whitespace-nowrap">Tipo</th>
              {columnas.map((c) => (
                <th key={c} className="text-right py-2 px-2 text-xs uppercase text-muted-foreground whitespace-nowrap">{c}</th>
              ))}
              {(extraCols ?? []).map((c) => (
                <th key={c} className="text-right py-2 px-2 text-xs uppercase text-muted-foreground whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, r) => (
              <tr key={f.label} className={f.bold ? "border-t-2" : "border-b last:border-0"}>
                <td className={`py-1.5 px-2 sticky left-0 bg-background z-10 whitespace-nowrap ${f.bold ? "font-bold" : ""}`}>{f.label}</td>
                {f.valores.map((v, c) => (
                  <td
                    key={c}
                    onMouseDown={startSel(r, c)}
                    onMouseEnter={overSel(r, c)}
                    className={`py-1.5 px-2 text-right mono cursor-cell ${f.bold ? "font-bold text-green-600" : ""} ${enRango(r, c) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                  >
                    {fmtUsd(v)}
                  </td>
                ))}
                {(f.extra ?? []).map((txt, i) => (
                  <td key={i} className="py-1.5 px-2 text-right text-xs text-muted-foreground whitespace-nowrap">{txt}</td>
                ))}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr><td className="py-3 px-2 text-muted-foreground" colSpan={columnas.length + (extraCols?.length ?? 0) + 1}>Sin movimientos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {seleccion.count > 0 && (
        <div className="sticky bottom-0 z-20 flex justify-end">
          <div className="bg-foreground text-background text-xs rounded-md shadow-lg px-4 py-2 mt-2 flex items-center gap-4 mono">
            <span>Celdas: <b>{seleccion.count}</b></span>
            <span>Promedio: <b>{fmtUsd(seleccion.suma / seleccion.count)}</b></span>
            <span>Suma: <b>{fmtUsd(seleccion.suma)}</b></span>
          </div>
        </div>
      )}
    </div>
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
  const [incluirOff, setIncluirOff] = useState(true);

  const { data: cuentas } = useQuery({
    queryKey: ["ingresos-detalle-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre").like("codigo", "1.%");
      return ordenarPorCodigo((data ?? []) as CuentaIngreso[]);
    },
  });

  // Filas crudas de `transacciones` (no la vista agregada): necesitamos
  // `referencia` por fila para separar los ajustes de venta lista (ver
  // ingresos-detalle-calc.ts). El modo BCV/paralelo y el filtro on/off
  // balance se aplican en memoria, así que un solo fetch por año alcanza.
  const { data: rowsAnio } = useQuery({
    queryKey: ["ingresos-detalle-rows-raw", anio],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<RowIngresoRaw>(async (from, to) =>
        await (supabase as any)
          .from("transacciones")
          .select("fecha,cuenta_codigo,modo,referencia,notas,monto_bs,monto_base_bs,monto_usd,tasa_bcv")
          .like("cuenta_codigo", "1.%")
          .neq("standby", true)
          .gte("fecha", `${anio}-01-01`)
          .lte("fecha", `${anio}-12-31`)
          .range(from, to),
      );
    },
  });

  const serie = useMemo(() => construirSerieIngresos(rowsAnio ?? [], mes, mode, incluirOff), [rowsAnio, mes, mode, incluirOff]);
  const actual = useMemo(() => calcularTotalesIngresosMes(rowsAnio ?? [], mes, mode, incluirOff), [rowsAnio, mes, mode, incluirOff]);
  const desglose = useMemo(() => construirDesgloseIngresos(rowsAnio ?? [], cuentas, mes, mode, incluirOff), [rowsAnio, cuentas, mes, mode, incluirOff]);

  const labelMes = `${MESES[mes - 1]} ${anio}`;
  const currencyBannerClass = mode === "bcv"
    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";

  // ---------- Datos para las tablas tipo Excel ----------
  const columnasMeses = serie.map((s) => s.mesLabel);
  const sum = (arr: number[]) => Number(arr.reduce((a, b) => a + b, 0).toFixed(2));
  const filasTablaMensual: FilaExcel[] = [
    { label: "Ventas comunes", valores: [...serie.map((s) => s.ventasComunes), sum(serie.map((s) => s.ventasComunes))] },
    { label: "Ajustes de venta lista", valores: [...serie.map((s) => s.ajustes), sum(serie.map((s) => s.ajustes))] },
    { label: "Ingresos por IVA", valores: [...serie.map((s) => s.ingresosIva), sum(serie.map((s) => s.ingresosIva))] },
    { label: "Total ingresos", valores: [...serie.map((s) => s.total), sum(serie.map((s) => s.total))], bold: true },
  ];

  const filasDesglose: FilaExcel[] = desglose.map((d) => ({
    label: `${d.codigo} · ${d.nombre}`,
    valores: [d.total],
    extra: [actual.total !== 0 ? `${((d.total / actual.total) * 100).toFixed(1)}%` : "—"],
  }));
  filasDesglose.push({
    label: "Total",
    valores: [actual.total],
    extra: ["100.0%"],
    bold: true,
  });

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
        <div className="flex flex-wrap items-end gap-2">
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
          label="Ajustes de venta lista"
          value={fmtUsd(actual.ajustes)}
          tone={actual.ajustes < 0 ? "neg" : undefined}
          sub="Importados vía Importar Ajustes Ventas"
        />
        <KpiCard
          icon={Receipt}
          label="Ingresos por IVA"
          value={fmtUsd(actual.ingresosIva)}
          tone="muted"
          sub="Normalmente $0.00 (el IVA cobrado es pasivo con el SENIAT)"
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
              <Bar dataKey="ajustes" name="Ajustes de venta lista" stackId="a" fill="#D97706" />
              <Bar dataKey="ingresosIva" name="Ingresos por IVA" stackId="a" fill="#64748B" />
              <Line type="monotone" dataKey="total" name="Total ingresos" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} />
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
