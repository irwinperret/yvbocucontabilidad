import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtDate } from "@/lib/format";

export type TasaSeries = {
  key: string;
  label: string;
  color: string;
  data: { fecha: string; value: number | null }[];
};

type Preset = { label: string; days: number | "year" | "all" };
const PRESETS: Preset[] = [
  { label: "Último mes", days: 30 },
  { label: "Últimos 3 meses", days: 90 },
  { label: "Últimos 6 meses", days: 180 },
  { label: "Todo el año", days: "year" },
  { label: "Todo el historial", days: "all" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function shiftDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TasaTimeSeriesChart({
  title,
  series,
  defaultDays = 90,
}: {
  title: string;
  series: TasaSeries[];
  defaultDays?: number;
}) {
  const allFechas = useMemo(() => {
    const s = new Set<string>();
    series.forEach((sr) => sr.data.forEach((p) => s.add(p.fecha)));
    return Array.from(s).sort();
  }, [series]);
  const minAll = allFechas[0] ?? todayISO();
  const maxAll = allFechas[allFechas.length - 1] ?? todayISO();

  const [desde, setDesde] = useState<string>(() => shiftDays(todayISO(), -defaultDays));
  const [hasta, setHasta] = useState<string>(todayISO());

  const applyPreset = (p: Preset) => {
    const end = todayISO();
    setHasta(end);
    if (p.days === "all") setDesde(minAll);
    else if (p.days === "year") setDesde(`${new Date().getFullYear()}-01-01`);
    else setDesde(shiftDays(end, -p.days));
  };

  const merged = useMemo(() => {
    const map = new Map<string, any>();
    series.forEach((sr) => {
      sr.data.forEach((p) => {
        if (p.fecha < desde || p.fecha > hasta) return;
        if (!map.has(p.fecha)) map.set(p.fecha, { fecha: p.fecha });
        map.get(p.fecha)[sr.key] = p.value == null ? null : Number(p.value);
      });
    });
    return Array.from(map.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [series, desde, hasta]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={desde}
                min={minAll}
                max={maxAll}
                onChange={(e) => setDesde(e.target.value)}
                className="h-8 w-[140px]"
              />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={hasta}
                min={minAll}
                max={maxAll}
                onChange={(e) => setHasta(e.target.value)}
                className="h-8 w-[140px]"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          {merged.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Sin datos en el rango seleccionado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={merged} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="fecha"
                  tickFormatter={(v) => fmtDate(v)}
                  minTickGap={40}
                  fontSize={11}
                />
                <YAxis
                  tickFormatter={(v) => Number(v).toFixed(2)}
                  fontSize={11}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  labelFormatter={(v) => fmtDate(String(v))}
                  formatter={(v: any, name: any) => [
                    v == null ? "—" : Number(v).toFixed(4) + " Bs/USD",
                    name,
                  ]}
                />
                {series.map((sr) => (
                  <Line
                    key={sr.key}
                    type="monotone"
                    dataKey={sr.key}
                    name={sr.label}
                    stroke={sr.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
