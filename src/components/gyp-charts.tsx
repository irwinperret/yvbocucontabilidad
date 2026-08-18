import { useMemo } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend,
  type Plugin,
} from "chart.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtUsd } from "@/lib/format";

ChartJS.register(BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend);

type Row = { cuenta_codigo: string; mes: number; base_usd: number; [k: string]: any };
type Cuenta = { codigo: string; nombre: string; grupo: string; [k: string]: any };

const CATS = ["COGS", "Nómina", "Administrativos", "Operativos", "Generales", "Impuestos", "Otros"] as const;
type Cat = (typeof CATS)[number];

const CAT_COLORS: Record<Cat, string> = {
  COGS: "#0ea5e9",
  "Nómina": "#f59e0b",
  Administrativos: "#8b5cf6",
  Operativos: "#ec4899",
  Generales: "#10b981",
  Impuestos: "#ef4444",
  Otros: "#64748b",
};

const INGRESOS_COLOR = "#22c55e";
const UTILIDAD_POSITIVE = "#22c55e";
const UTILIDAD_NEGATIVE = "#ef4444";

function catDeCuenta(c: Cuenta): Cat | null {
  if (c.codigo.startsWith("1.")) return null;
  if (c.codigo.startsWith("2.")) return "COGS";
  const g = (c.grupo || "").toLowerCase();
  if (g.startsWith("nomina") || g.startsWith("nómina")) return "Nómina";
  if (g.startsWith("administrativo")) return "Administrativos";
  if (g.startsWith("operativo")) return "Operativos";
  if (g.startsWith("general")) return "Generales";
  if (g.startsWith("impuesto")) return "Impuestos";
  return "Otros";
}

export function GyPCharts({ rows, cuentas, sumFn, titulo }: {
  rows: Row[]; cuentas: Cuenta[]; sumFn: (r: any) => boolean; titulo: string;
}) {
  const { ingresos, cats, utilidad } = useMemo(() => {
    const mapC = new Map<string, Cuenta>();
    cuentas.forEach((c) => mapC.set(c.codigo, c));
    let ing = 0;
    const acc = new Map<Cat, number>();
    rows.filter(sumFn).forEach((r) => {
      const c = mapC.get(r.cuenta_codigo);
      if (!c) return;
      const v = Number(r.base_usd || 0);
      if (c.codigo.startsWith("1.")) { ing += v; return; }
      const cat = catDeCuenta(c);
      if (!cat) return;
      acc.set(cat, (acc.get(cat) ?? 0) + v);
    });
    const list = CATS.map((k) => ({ cat: k, value: acc.get(k) ?? 0 })).filter((d) => d.value > 0);
    const total = list.reduce((s, d) => s + d.value, 0);
    return { ingresos: ing, cats: list, utilidad: ing - total };
  }, [rows, cuentas, sumFn]);

  const pct = (v: number) => (ingresos ? `${((v / ingresos) * 100).toFixed(1)}%` : "—");

  // ----- Waterfall (floating bars) -----
  const labels = ["Ingresos", ...cats.map((c) => c.cat), "Utilidad Neta"];
  const bars: [number, number][] = [];
  const colors: string[] = [];
  let cursor = ingresos;
  bars.push([0, ingresos]);
  colors.push("#10b981");
  cats.forEach((c) => {
    const next = cursor - c.value;
    bars.push([next, cursor]);
    colors.push(CAT_COLORS[c.cat]);
    cursor = next;
  });
  bars.push([Math.min(0, utilidad), Math.max(0, utilidad)]);
  colors.push(utilidad >= 0 ? "#10b981" : "#ef4444");
  const netos = [ingresos, ...cats.map((c) => -c.value), utilidad];

  const labelPlugin: Plugin<"bar"> = {
    id: "wf-labels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = "600 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = getComputedStyle(chart.canvas).color || "#111";
      meta.data.forEach((el, i) => {
        const v = netos[i];
        const txt = `${v < 0 ? "-" : ""}${fmtUsd(Math.abs(v))}`;
        ctx.fillText(txt, el.x, (el as any).y - 12);
        ctx.font = "400 9px sans-serif";
        ctx.fillText(pct(Math.abs(v)), el.x, (el as any).y - 3);
        ctx.font = "600 10px sans-serif";
      });
      ctx.restore();
    },
  };

  const totalGastos = cats.reduce((s, c) => s + c.value, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2 mb-4">
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Waterfall de resultados · {titulo}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div style={{ height: 260 }}>
            <Bar
              key={labels.join("|")}
              data={{ labels, datasets: [{ data: bars as any, backgroundColor: colors, borderRadius: 3, barPercentage: 0.7 }] }}
              plugins={[labelPlugin]}
              options={{
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 22 } },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (c) => `${netos[c.dataIndex] < 0 ? "-" : ""}${fmtUsd(Math.abs(netos[c.dataIndex]))} · ${pct(Math.abs(netos[c.dataIndex]))}`,
                    },
                  },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                  y: { ticks: { font: { size: 10 }, callback: (v) => fmtUsd(Number(v)) }, grid: { color: "rgba(120,120,120,0.15)" } },
                },
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Distribución de costos · {titulo}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-4" style={{ height: 260 }}>
            <div className="relative shrink-0" style={{ width: 230, height: 230 }}>
              <Doughnut
                data={{
                  labels: cats.map((c) => c.cat),
                  datasets: [{ data: cats.map((c) => c.value), backgroundColor: cats.map((c) => CAT_COLORS[c.cat]), borderWidth: 0 }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: "68%",
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtUsd(Number(c.raw))} · ${pct(Number(c.raw))}` } },
                  },
                }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] text-muted-foreground">Utilidad Neta</span>
                <span className={`mono text-sm font-bold ${utilidad >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {utilidad < 0 ? `(${fmtUsd(Math.abs(utilidad)).replace("$ ", "$")})` : fmtUsd(utilidad)}
                </span>
                <span className={`text-[10px] ${utilidad >= 0 ? "text-emerald-600" : "text-red-600"}`}>{pct(utilidad)}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[240px] space-y-1 pr-1">
              {cats.map((c) => (
                <div key={c.cat} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: CAT_COLORS[c.cat] }} />
                  <span className="flex-1 truncate">{c.cat}</span>
                  <span className="mono">{fmtUsd(c.value)}</span>
                  <span className="mono text-muted-foreground w-12 text-right">{pct(c.value)}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs border-t pt-1 font-semibold">
                <span className="flex-1">Total costos</span>
                <span className="mono">{fmtUsd(totalGastos)}</span>
                <span className="mono text-muted-foreground w-12 text-right">{pct(totalGastos)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
