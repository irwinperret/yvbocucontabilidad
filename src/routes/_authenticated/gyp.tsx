import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fmtUsd } from "@/lib/format";
import { CENTROS, MESES } from "@/lib/account-helpers";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { exportGyP } from "@/lib/excel-export";
import { UsdRateBadge } from "@/components/usd-rate-badge";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";

export const Route = createFileRoute("/_authenticated/gyp")({ component: GyPPage });

type Row = { periodo: string; anio: number; mes: number; cuenta_codigo: string; centro_costo: string; modo: string; base_usd: number };

function GyPPage() {
  const { mode, label } = useUsdView();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [centro, setCentro] = useState<string>("Consolidado");
  const [incluirOff, setIncluirOff] = useState(false);
  const [mesSel, setMesSel] = useState(new Date().getMonth() + 1);
  const [hastaMes, setHastaMes] = useState(new Date().getMonth() + 1);

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-gyp"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("*").eq("afecta_gyp", true).order("orden");
      return data ?? [];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["gyp-rows", anio, centro, incluirOff, mode],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<Row>(async (from, to) => {
        let q = (supabase as any).from(mensualView(mode)).select("*").eq("anio", anio).range(from, to);
        if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
        if (!incluirOff) q = q.eq("modo", "on_balance");
        return await q;
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ganancias y Pérdidas</h1>
          <div className="mt-1"><UsdRateBadge /></div>
          <p className="text-sm text-muted-foreground">Todos los montos en {label} · base sin IVA</p>
        </div>
        <UsdViewToggle />
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div><Label className="text-xs">Año</Label><Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[2024,2025,2026,2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Centro de costo</Label><Select value={centro} onValueChange={setCentro}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Consolidado">Consolidado</SelectItem>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-2"><Switch checked={incluirOff} onCheckedChange={setIncluirOff} id="off" /><Label htmlFor="off" className="text-xs">Incluir off-balance</Label></div>
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
            <Button size="sm" variant="outline" onClick={() => exportGyP({ tab: "mes", anio, mes: mesSel, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteMes rows={rows ?? []} cuentas={cuentas ?? []} mes={mesSel} />
        </TabsContent>

        <TabsContent value="ytd">
          <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-xs">Hasta el mes</Label>
              <Select value={String(hastaMes)} onValueChange={(v) => setHastaMes(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{MESES.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{hastaMes} meses — Ene a {MESES[hastaMes-1]} {anio}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => exportGyP({ tab: "ytd", anio, hastaMes, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteYTD rows={rows ?? []} cuentas={cuentas ?? []} hastaMes={hastaMes} />
        </TabsContent>

        <TabsContent value="comp">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => exportGyP({ tab: "comp", anio, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteComparativo rows={rows ?? []} cuentas={cuentas ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function buildGroups(cuentas: any[], filter: (codigo: string) => boolean, rows: Row[], sumFn: (r: Row) => boolean) {
  const grupos: Record<string, { cuenta: any; total: number }[]> = {};
  cuentas.filter((c) => filter(c.codigo)).forEach((c) => {
    const total = rows.filter((r) => r.cuenta_codigo === c.codigo && sumFn(r)).reduce((s, r) => s + Number(r.base_usd || 0), 0);
    if (total !== 0) (grupos[c.grupo] ||= []).push({ cuenta: c, total });
  });
  return grupos;
}

function ReporteMes({ rows, cuentas, mes }: { rows: Row[]; cuentas: any[]; mes: number }) {
  const ingGrupos = buildGroups(cuentas, (c) => c.startsWith("1."), rows, (r) => r.mes === mes);
  const cogsGrupos = buildGroups(cuentas, (c) => c.startsWith("2."), rows, (r) => r.mes === mes);
  const opGrupos = buildGroups(cuentas, (c) => /^[3-9]\./.test(c) && !c.startsWith("12."), rows, (r) => r.mes === mes);
  const impGrupos = buildGroups(cuentas, (c) => c.startsWith("12."), rows, (r) => r.mes === mes);

  const totalIng = Object.values(ingGrupos).flat().reduce((s, i) => s + i.total, 0);
  const totalCogs = Object.values(cogsGrupos).flat().reduce((s, i) => s + i.total, 0);
  const totalOp = Object.values(opGrupos).flat().reduce((s, i) => s + i.total, 0);
  const totalImp = Object.values(impGrupos).flat().reduce((s, i) => s + i.total, 0);
  const margenBruto = totalIng - totalCogs;
  const utilOp = margenBruto - totalOp;
  const utilidad = utilOp - totalImp;

  return (
    <Card>
      <CardContent className="pt-4">
        <Seccion titulo="Ingresos" grupos={ingGrupos} />
        <Total label="TOTAL INGRESOS" value={totalIng} positive />
        <Seccion titulo="COGS" grupos={cogsGrupos} negativo />
        <Total label="TOTAL COGS" value={-totalCogs} />
        <Total label={`MARGEN BRUTO · ${totalIng ? ((margenBruto/totalIng)*100).toFixed(1) : "0"}%`} value={margenBruto} bold />
        <Seccion titulo="Gastos operativos" grupos={opGrupos} negativo />
        <Total label="TOTAL GASTOS OPERATIVOS" value={-totalOp} />
        <Total label={`UTILIDAD OPERATIVA · ${totalIng ? ((utilOp/totalIng)*100).toFixed(1) : "0"}%`} value={utilOp} bold />
        {Object.keys(impGrupos).length > 0 && (
          <>
            <Seccion titulo="Impuestos" grupos={impGrupos} negativo />
            <Total label="TOTAL IMPUESTOS" value={-totalImp} />
          </>
        )}
        <Total label={`UTILIDAD / PÉRDIDA NETA · ${totalIng ? ((utilidad/totalIng)*100).toFixed(1) : "0"}%`} value={utilidad} bold big />
      </CardContent>
    </Card>
  );
}

function ReporteYTD({ rows, cuentas, hastaMes }: { rows: Row[]; cuentas: any[]; hastaMes: number }) {
  const filtro = (r: Row) => r.mes <= hastaMes;
  const ing = buildGroups(cuentas, (c) => c.startsWith("1."), rows, filtro);
  const cogs = buildGroups(cuentas, (c) => c.startsWith("2."), rows, filtro);
  const op = buildGroups(cuentas, (c) => /^[3-9]\./.test(c) && !c.startsWith("12."), rows, filtro);
  const imp = buildGroups(cuentas, (c) => c.startsWith("12."), rows, filtro);
  const totalIng = Object.values(ing).flat().reduce((s, i) => s + i.total, 0);
  const totalCogs = Object.values(cogs).flat().reduce((s, i) => s + i.total, 0);
  const totalOp = Object.values(op).flat().reduce((s, i) => s + i.total, 0);
  const totalImp = Object.values(imp).flat().reduce((s, i) => s + i.total, 0);
  const mb = totalIng - totalCogs;
  const uo = mb - totalOp;
  const ut = uo - totalImp;
  return (
    <Card>
      <CardContent className="pt-4">
        <Seccion titulo="Ingresos" grupos={ing} />
        <Total label="TOTAL INGRESOS" value={totalIng} positive />
        <Seccion titulo="COGS" grupos={cogs} negativo />
        <Total label={`MARGEN BRUTO · ${totalIng ? ((mb/totalIng)*100).toFixed(1) : "0"}%`} value={mb} bold />
        <Seccion titulo="Gastos operativos" grupos={op} negativo />
        <Total label={`UTILIDAD OPERATIVA · ${totalIng ? ((uo/totalIng)*100).toFixed(1) : "0"}%`} value={uo} bold />
        {Object.keys(imp).length > 0 && (
          <>
            <Seccion titulo="Impuestos" grupos={imp} negativo />
            <Total label="TOTAL IMPUESTOS" value={-totalImp} />
          </>
        )}
        <Total label={`UTILIDAD NETA · ${totalIng ? ((ut/totalIng)*100).toFixed(1) : "0"}%`} value={ut} bold big />
      </CardContent>
    </Card>
  );
}

function ReporteComparativo({ rows, cuentas }: { rows: Row[]; cuentas: any[] }) {
  const cuentasActivas = useMemo(() => cuentas.filter((c) => rows.some((r) => r.cuenta_codigo === c.codigo)), [cuentas, rows]);
  const valor = (codigo: string, mes: number) => rows.filter((r) => r.cuenta_codigo === codigo && r.mes === mes).reduce((s, r) => s + Number(r.base_usd || 0), 0);
  const ahora = new Date();
  const mesActual = ahora.getMonth() + 1;
  const anioActual = ahora.getFullYear();
  const anioRows = rows[0]?.anio ?? anioActual;
  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2 px-2 sticky left-0 bg-background">Cuenta</th>
              {MESES.map((m, i) => <th key={i} className="text-right py-2 px-2">{m}</th>)}
              <th className="text-right py-2 px-2 font-semibold">Año</th>
            </tr>
          </thead>
          <tbody>
            {cuentasActivas.map((c) => {
              const valores = MESES.map((_, i) => valor(c.codigo, i + 1));
              const total = valores.reduce((s, v) => s + v, 0);
              return (
                <tr key={c.codigo} className="border-b last:border-0">
                  <td className="py-1.5 px-2 sticky left-0 bg-background">
                    <span className="text-muted-foreground">{c.codigo}</span> {c.nombre}
                  </td>
                  {valores.map((v, i) => {
                    const futuro = anioRows >= anioActual && i + 1 > mesActual;
                    return <td key={i} className={`py-1.5 px-2 text-right mono ${futuro ? "text-muted-foreground/40" : ""}`}>{v === 0 ? "—" : fmtUsd(v)}</td>;
                  })}
                  <td className="py-1.5 px-2 text-right mono font-semibold">{fmtUsd(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Seccion({ titulo, grupos, negativo }: { titulo: string; grupos: Record<string, any[]>; negativo?: boolean }) {
  return (
    <div className="mb-3">
      <div className="bg-muted/50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide rounded">{titulo}</div>
      {Object.entries(grupos).map(([g, items]) => (
        <div key={g}>
          {items.map((i: any) => (
            <div key={i.cuenta.codigo} className="flex justify-between py-1 px-2 text-sm border-b last:border-0">
              <span><span className="text-muted-foreground mono">{i.cuenta.codigo}</span> {i.cuenta.nombre}</span>
              <span className={`mono ${negativo ? "negative" : ""}`}>{negativo ? `(${fmtUsd(i.total).replace("$ ", "")})` : fmtUsd(i.total)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Total({ label, value, positive, bold, big }: { label: string; value: number; positive?: boolean; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-2 px-2 border-t-2 ${bold ? "border-foreground bg-muted/30" : ""} ${big ? "text-base font-bold" : "text-sm font-semibold"}`}>
      <span>{label}</span>
      <span className={`mono ${value >= 0 ? "positive" : "negative"}`}>{value >= 0 ? fmtUsd(value) : `(${fmtUsd(Math.abs(value)).replace("$ ", "")})`}</span>
    </div>
  );
}
