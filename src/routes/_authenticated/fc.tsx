import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fmtUsd } from "@/lib/format";
import { CENTROS, MESES } from "@/lib/account-helpers";
import { useCuentasBancarias } from "@/components/bank-account-select";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { exportFC } from "@/lib/excel-export";
import { UsdRateBadge } from "@/components/usd-rate-badge";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";

export const Route = createFileRoute("/_authenticated/fc")({ component: FCPage });

type Row = { anio: number; mes: number; cuenta_codigo: string; centro_costo: string; modo: string; total_usd: number };

function FCPage() {
  const { mode, label } = useUsdView();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [centro, setCentro] = useState<string>("Consolidado");
  const [incluirOff, setIncluirOff] = useState(false);
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("todas");
  const [mesSel, setMesSel] = useState(new Date().getMonth() + 1);
  const [hastaMes, setHastaMes] = useState(new Date().getMonth() + 1);

  const { data: bancos } = useCuentasBancarias();

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-fc"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("*").eq("afecta_fc", true).order("orden");
      return data ?? [];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["fc-rows", anio, centro, incluirOff, cuentaBancariaId, mode],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      if (cuentaBancariaId !== "todas") {
        const data = await fetchAllRows<any>(async (from, to) => {
          let q = supabase.from("transacciones").select("fecha, cuenta_codigo, centro_costo, modo, monto_bs, monto_usd, tasa_bcv")
            .gte("fecha", `${anio}-01-01`).lte("fecha", `${anio}-12-31`)
            .eq("cuenta_bancaria_id" as any, cuentaBancariaId)
            .range(from, to);
          if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
          if (!incluirOff) q = q.eq("modo", "on_balance");
          return await q;
        });
        const map = new Map<string, Row>();
        for (const t of data) {
          const d = new Date(t.fecha);
          const k = `${d.getFullYear()}-${d.getMonth()+1}-${t.cuenta_codigo}-${t.centro_costo}-${t.modo}`;
          const bs = Number(t.monto_bs || 0);
          const tbcv = Number(t.tasa_bcv || 0);
          const usd = mode === "bcv"
            ? (tbcv > 0 ? bs / tbcv : 0)
            : Number(t.monto_usd || 0);
          const existing = map.get(k);
          if (existing) existing.total_usd += usd;
          else map.set(k, { anio: d.getFullYear(), mes: d.getMonth()+1, cuenta_codigo: t.cuenta_codigo, centro_costo: t.centro_costo, modo: t.modo, total_usd: usd });
        }
        return Array.from(map.values());
      }
      const rows = await fetchAllRows<Row>(async (from, to) => {
        let q = (supabase as any).from(mensualView(mode)).select("*").eq("anio", anio).range(from, to);
        if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
        if (!incluirOff) q = q.eq("modo", "on_balance");
        return await q;
      });
      return rows;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flujo de caja</h1>
          <div className="mt-1"><UsdRateBadge /></div>
          <p className="text-sm text-muted-foreground">Movimientos efectivos en {label}</p>
        </div>
        <UsdViewToggle />
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div><Label className="text-xs">Año</Label><Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[2024,2025,2026,2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Centro de costo</Label><Select value={centro} onValueChange={setCentro}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Consolidado">Consolidado</SelectItem>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-2"><Switch checked={incluirOff} onCheckedChange={setIncluirOff} id="off" /><Label htmlFor="off" className="text-xs">Incluir off-balance</Label></div>
          <div><Label className="text-xs">Cuenta bancaria</Label>
            <Select value={cuentaBancariaId} onValueChange={setCuentaBancariaId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las cuentas</SelectItem>
                {(bancos ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nombre} — {b.banco} ({b.moneda})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="mes">
        <TabsList>
          <TabsTrigger value="mes">Mes individual</TabsTrigger>
          <TabsTrigger value="ytd">Acumulado YTD</TabsTrigger>
          <TabsTrigger value="comp">Comparativo mensual</TabsTrigger>
        </TabsList>

        <TabsContent value="mes">
          <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-xs">Mes</Label>
              <Select value={String(mesSel)} onValueChange={(v) => setMesSel(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{MESES.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => exportFC({ tab: "mes", anio, mes: mesSel, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteFC rows={(rows ?? []).filter((r) => r.mes === mesSel)} cuentas={cuentas ?? []} />
        </TabsContent>

        <TabsContent value="ytd">
          <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-xs">Hasta el mes</Label>
              <Select value={String(hastaMes)} onValueChange={(v) => setHastaMes(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{MESES.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => exportFC({ tab: "ytd", anio, hastaMes, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteFC rows={(rows ?? []).filter((r) => r.mes <= hastaMes)} cuentas={cuentas ?? []} />
        </TabsContent>

        <TabsContent value="comp">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => exportFC({ tab: "comp", anio, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteFCComparativo rows={rows ?? []} cuentas={cuentas ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReporteFC({ rows, cuentas }: { rows: Row[]; cuentas: any[] }) {
  const sum = (filter: (c: any) => boolean) => cuentas.filter(filter).reduce((s, c) => s + rows.filter((r) => r.cuenta_codigo === c.codigo).reduce((a, r) => a + Number(r.total_usd || 0), 0), 0);

  const entOp = sum((c) => c.codigo.startsWith("1."));
  const salOp = sum((c) => /^[2-9]\./.test(c.codigo));
  const flujoOp = entOp - salOp;
  const entFin = sum((c) => ["10.1", "10.5"].includes(c.codigo));
  const salFin = sum((c) => ["10.2", "10.4", "10.6"].includes(c.codigo));
  const flujoFin = entFin - salFin;
  const neto = flujoOp + flujoFin;

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <Linea label="Actividades operativas — Entradas" v={entOp} positive />
        <Linea label="Actividades operativas — Salidas" v={-salOp} />
        <Total label="Flujo operativo neto" v={flujoOp} />
        <Linea label="Financiamiento — Entradas" v={entFin} positive />
        <Linea label="Financiamiento — Salidas" v={-salFin} />
        <Total label="Flujo financiamiento neto" v={flujoFin} />
        <Total label="VARIACIÓN NETA DE CAJA" v={neto} big />
      </CardContent>
    </Card>
  );
}

function ReporteFCComparativo({ rows, cuentas }: { rows: Row[]; cuentas: any[] }) {
  const cuentasActivas = useMemo(() => cuentas.filter((c) => rows.some((r) => r.cuenta_codigo === c.codigo)), [cuentas, rows]);
  const valor = (codigo: string, mes: number) => rows.filter((r) => r.cuenta_codigo === codigo && r.mes === mes).reduce((s, r) => s + Number(r.total_usd || 0), 0);
  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2 px-2 sticky left-0 bg-background">Cuenta</th>
              {MESES.map((m, i) => <th key={i} className="text-right py-2 px-2">{m}</th>)}
              <th className="text-right py-2 px-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {cuentasActivas.map((c) => {
              const vs = MESES.map((_, i) => valor(c.codigo, i + 1));
              const t = vs.reduce((s, v) => s + v, 0);
              return (
                <tr key={c.codigo} className="border-b last:border-0">
                  <td className="py-1.5 px-2 sticky left-0 bg-background"><span className="text-muted-foreground">{c.codigo}</span> {c.nombre}</td>
                  {vs.map((v, i) => <td key={i} className="py-1.5 px-2 text-right mono">{v === 0 ? "—" : fmtUsd(v)}</td>)}
                  <td className="py-1.5 px-2 text-right mono font-semibold">{fmtUsd(t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Linea({ label, v, positive }: { label: string; v: number; positive?: boolean }) {
  return (
    <div className="flex justify-between py-1.5 px-2 text-sm border-b">
      <span>{label}</span>
      <span className={`mono ${v >= 0 ? "positive" : "negative"}`}>{v >= 0 ? fmtUsd(v) : `(${fmtUsd(Math.abs(v)).replace("$ ","")})`}</span>
    </div>
  );
}

function Total({ label, v, big }: { label: string; v: number; big?: boolean }) {
  return (
    <div className={`flex justify-between py-2 px-2 border-t-2 ${big ? "text-base font-bold bg-muted/30" : "text-sm font-semibold"}`}>
      <span>{label}</span>
      <span className={`mono ${v >= 0 ? "positive" : "negative"}`}>{v >= 0 ? fmtUsd(v) : `(${fmtUsd(Math.abs(v)).replace("$ ","")})`}</span>
    </div>
  );
}
