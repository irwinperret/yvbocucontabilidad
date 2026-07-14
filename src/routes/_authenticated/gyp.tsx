import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fmtUsd } from "@/lib/format";
import { CENTROS, MESES } from "@/lib/account-helpers";
import { Button } from "@/components/ui/button";
import { Download, ChevronRight, ChevronDown } from "lucide-react";
import { exportGyP } from "@/lib/excel-export";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";

export const Route = createFileRoute("/_authenticated/gyp")({ component: GyPPage });

type Row = { periodo: string; anio: number; mes: number; cuenta_codigo: string; centro_costo: string; modo: string; base_usd: number };

type Cuenta = { codigo: string; nombre: string; grupo: string; orden?: number };

type GrupoData = { grupo: string; subtotal: number; items: { cuenta: Cuenta; total: number }[] };

// ---------- Expand/collapse context (page-level) ----------
type ExpandCtx = {
  expanded: Set<string>;
  toggle: (k: string) => void;
  isExpanded: (k: string) => boolean;
  centro: string;
  rows: Row[];
};

function GyPPage() {
  const { mode, label } = useUsdView();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [centro, setCentro] = useState<string>("Consolidado");
  const [incluirOff, setIncluirOff] = useState(false);
  const [mesSel, setMesSel] = useState(new Date().getMonth() + 1);
  const [hastaMes, setHastaMes] = useState(new Date().getMonth() + 1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((k: string) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });
  }, []);
  const isExpanded = useCallback((k: string) => expanded.has(k), [expanded]);

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-gyp"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("*").eq("afecta_gyp", true).order("orden");
      return (data ?? []) as Cuenta[];
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

  const allGroupKeys = useMemo(() => {
    const s = new Set<string>();
    (cuentas ?? []).forEach((c) => { if (c.grupo) s.add(`grp::${c.grupo}`); });
    return s;
  }, [cuentas]);

  const expandAll = () => setExpanded(new Set(allGroupKeys));
  const collapseAll = () => setExpanded(new Set());

  const ctx: ExpandCtx = { expanded, toggle, isExpanded, centro, rows: rows ?? [] };

  const ExpandControls = () => (
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" onClick={expandAll}>Expandir todo</Button>
      <Button size="sm" variant="ghost" onClick={collapseAll}>Colapsar todo</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ganancias y Pérdidas</h1>
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
            <div className="flex items-center gap-2">
              <ExpandControls />
              <Button size="sm" variant="outline" onClick={() => exportGyP({ tab: "mes", anio, mes: mesSel, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
                <Download className="h-4 w-4 mr-2" /> Exportar a Excel
              </Button>
            </div>
          </div>
          <ReporteMes rows={rows ?? []} cuentas={cuentas ?? []} mes={mesSel} ctx={ctx} />
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
            <div className="flex items-center gap-2">
              <ExpandControls />
              <Button size="sm" variant="outline" onClick={() => exportGyP({ tab: "ytd", anio, hastaMes, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
                <Download className="h-4 w-4 mr-2" /> Exportar a Excel
              </Button>
            </div>
          </div>
          <ReporteYTD rows={rows ?? []} cuentas={cuentas ?? []} hastaMes={hastaMes} ctx={ctx} />
        </TabsContent>

        <TabsContent value="comp">
          <div className="mb-3 flex justify-end gap-2">
            <ExpandControls />
            <Button size="sm" variant="outline" onClick={() => exportGyP({ tab: "comp", anio, centro, incluirOff, rows: rows ?? [], cuentas: cuentas ?? [] })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteComparativo rows={rows ?? []} cuentas={cuentas ?? []} ctx={ctx} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Helpers ----------
function buildGrupos(cuentas: Cuenta[], filterCodigo: (codigo: string) => boolean, rows: Row[], sumFn: (r: Row) => boolean): GrupoData[] {
  const map: Record<string, GrupoData> = {};
  cuentas.filter((c) => filterCodigo(c.codigo)).forEach((c) => {
    const total = rows.filter((r) => r.cuenta_codigo === c.codigo && sumFn(r)).reduce((s, r) => s + Number(r.base_usd || 0), 0);
    if (total !== 0) {
      (map[c.grupo] ||= { grupo: c.grupo, subtotal: 0, items: [] });
      map[c.grupo].items.push({ cuenta: c, total });
      map[c.grupo].subtotal += total;
    }
  });
  return Object.values(map);
}

// ---------- Mes individual ----------
function ReporteMes({ rows, cuentas, mes, ctx }: { rows: Row[]; cuentas: Cuenta[]; mes: number; ctx: ExpandCtx }) {
  const sumFn = (r: Row) => r.mes === mes;
  const ing = buildGrupos(cuentas, (c) => c.startsWith("1."), rows, sumFn);
  const cogs = buildGrupos(cuentas, (c) => c.startsWith("2."), rows, sumFn);
  const op = buildGrupos(cuentas, (c) => /^[3-9]\./.test(c) && !c.startsWith("12."), rows, sumFn);
  const imp = buildGrupos(cuentas, (c) => c.startsWith("12."), rows, sumFn);

  const sum = (g: GrupoData[]) => g.reduce((s, x) => s + x.subtotal, 0);
  const totalIng = sum(ing), totalCogs = sum(cogs), totalOp = sum(op), totalImp = sum(imp);
  const mb = totalIng - totalCogs;
  const uo = mb - totalOp;
  const ut = uo - totalImp;

  return (
    <Card>
      <CardContent className="pt-4">
        <Seccion titulo="Ingresos" grupos={ing} totalIng={totalIng} ctx={ctx} sumFn={sumFn} />
        <Total label="TOTAL INGRESOS" value={totalIng} positive />
        <Seccion titulo="COGS" grupos={cogs} totalIng={totalIng} negativo ctx={ctx} sumFn={sumFn} />
        <Total label="TOTAL COGS" value={-totalCogs} />
        <Total label={`MARGEN BRUTO · ${totalIng ? ((mb/totalIng)*100).toFixed(1) : "0"}%`} value={mb} bold />
        <Seccion titulo="Gastos operativos" grupos={op} totalIng={totalIng} negativo ctx={ctx} sumFn={sumFn} />
        <Total label="TOTAL GASTOS OPERATIVOS" value={-totalOp} />
        <Total label={`UTILIDAD OPERATIVA · ${totalIng ? ((uo/totalIng)*100).toFixed(1) : "0"}%`} value={uo} bold />
        {imp.length > 0 && (
          <>
            <Seccion titulo="Impuestos" grupos={imp} totalIng={totalIng} negativo ctx={ctx} sumFn={sumFn} />
            <Total label="TOTAL IMPUESTOS" value={-totalImp} />
          </>
        )}
        <Total label={`UTILIDAD / PÉRDIDA NETA · ${totalIng ? ((ut/totalIng)*100).toFixed(1) : "0"}%`} value={ut} bold big />
      </CardContent>
    </Card>
  );
}

function ReporteYTD({ rows, cuentas, hastaMes, ctx }: { rows: Row[]; cuentas: Cuenta[]; hastaMes: number; ctx: ExpandCtx }) {
  const sumFn = (r: Row) => r.mes <= hastaMes;
  const ing = buildGrupos(cuentas, (c) => c.startsWith("1."), rows, sumFn);
  const cogs = buildGrupos(cuentas, (c) => c.startsWith("2."), rows, sumFn);
  const op = buildGrupos(cuentas, (c) => /^[3-9]\./.test(c) && !c.startsWith("12."), rows, sumFn);
  const imp = buildGrupos(cuentas, (c) => c.startsWith("12."), rows, sumFn);
  const sum = (g: GrupoData[]) => g.reduce((s, x) => s + x.subtotal, 0);
  const totalIng = sum(ing), totalCogs = sum(cogs), totalOp = sum(op), totalImp = sum(imp);
  const mb = totalIng - totalCogs;
  const uo = mb - totalOp;
  const ut = uo - totalImp;
  return (
    <Card>
      <CardContent className="pt-4">
        <Seccion titulo="Ingresos" grupos={ing} totalIng={totalIng} ctx={ctx} sumFn={sumFn} />
        <Total label="TOTAL INGRESOS" value={totalIng} positive />
        <Seccion titulo="COGS" grupos={cogs} totalIng={totalIng} negativo ctx={ctx} sumFn={sumFn} />
        <Total label={`MARGEN BRUTO · ${totalIng ? ((mb/totalIng)*100).toFixed(1) : "0"}%`} value={mb} bold />
        <Seccion titulo="Gastos operativos" grupos={op} totalIng={totalIng} negativo ctx={ctx} sumFn={sumFn} />
        <Total label={`UTILIDAD OPERATIVA · ${totalIng ? ((uo/totalIng)*100).toFixed(1) : "0"}%`} value={uo} bold />
        {imp.length > 0 && (
          <>
            <Seccion titulo="Impuestos" grupos={imp} totalIng={totalIng} negativo ctx={ctx} sumFn={sumFn} />
            <Total label="TOTAL IMPUESTOS" value={-totalImp} />
          </>
        )}
        <Total label={`UTILIDAD NETA · ${totalIng ? ((ut/totalIng)*100).toFixed(1) : "0"}%`} value={ut} bold big />
      </CardContent>
    </Card>
  );
}

// ---------- Seccion (drill-down) ----------
function fmtSigned(v: number, negativo?: boolean) {
  const s = fmtUsd(Math.abs(v)).replace("$ ", "");
  if (negativo) return `($${s})`;
  return v < 0 ? `($${s})` : `$${s}`;
}

function pctIng(value: number, totalIng: number) {
  if (!totalIng) return "";
  return `${((value / totalIng) * 100).toFixed(1)}%`;
}

function Seccion({ titulo, grupos, totalIng, negativo, ctx, sumFn }: {
  titulo: string;
  grupos: GrupoData[];
  totalIng: number;
  negativo?: boolean;
  ctx: ExpandCtx;
  sumFn: (r: Row) => boolean;
}) {
  if (grupos.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="bg-muted/50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide rounded">{titulo}</div>
      {grupos.map((g) => {
        const key = `grp::${g.grupo}`;
        const isOpen = ctx.isExpanded(key);
        return (
          <div key={g.grupo}>
            {/* Group header row — siempre visible, colapsable */}
            <button
              type="button"
              onClick={() => ctx.toggle(key)}
              className="w-full flex items-center justify-between py-1.5 px-2 text-sm border-b last:border-0 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <span className="flex items-center gap-1.5 font-medium">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {g.grupo}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground mono">{pctIng(g.subtotal, totalIng)}</span>
                <span className={`mono font-medium ${negativo || g.subtotal < 0 ? "negative" : "positive"}`}>
                  {fmtSigned(g.subtotal, negativo)}
                </span>
              </span>
            </button>
            {/* Account rows */}
            {isOpen && g.items.map((i) => (
              <CuentaRow key={i.cuenta.codigo} cuenta={i.cuenta} total={i.total} totalIng={totalIng} negativo={negativo} ctx={ctx} sumFn={sumFn} single={false} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CuentaRow({ cuenta, total, totalIng, negativo, ctx, sumFn, single }: {
  cuenta: Cuenta; total: number; totalIng: number; negativo?: boolean; ctx: ExpandCtx; sumFn: (r: Row) => boolean; single: boolean;
}) {
  // Level 3: centro_costo breakdown available only in Consolidado
  const centrosBreakdown = useMemo(() => {
    if (ctx.centro !== "Consolidado") return [];
    const map: Record<string, number> = {};
    ctx.rows.filter((r) => r.cuenta_codigo === cuenta.codigo && sumFn(r)).forEach((r) => {
      map[r.centro_costo] = (map[r.centro_costo] || 0) + Number(r.base_usd || 0);
    });
    return Object.entries(map).filter(([, v]) => v !== 0).map(([centro, val]) => ({ centro, val }));
  }, [ctx.centro, ctx.rows, cuenta.codigo, sumFn]);

  const canDrill = centrosBreakdown.length > 1;
  const key = `acc::${cuenta.codigo}`;
  const open = canDrill && ctx.isExpanded(key);
  const indent = single ? "pl-2" : "pl-8";

  return (
    <div>
      <div className={`flex justify-between items-center py-1 pr-2 ${indent} text-sm border-b last:border-0`}>
        <span className="flex items-center gap-1.5">
          {canDrill ? (
            <button type="button" onClick={() => ctx.toggle(key)} className="hover:bg-muted rounded p-0.5">
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <span className="text-muted-foreground mono text-xs">{cuenta.codigo}</span>
          <span>{cuenta.nombre}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground mono">{pctIng(total, totalIng)}</span>
          <span className={`mono ${negativo ? "negative" : ""}`}>{fmtSigned(total, negativo)}</span>
        </span>
      </div>
      {open && centrosBreakdown.map((b) => (
        <div key={b.centro} className="flex justify-between py-1 pr-2 pl-14 text-xs border-b last:border-0 bg-muted/10">
          <span className="text-muted-foreground">{b.centro}</span>
          <span className={`mono ${negativo ? "negative" : ""}`}>{fmtSigned(b.val, negativo)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Comparativo mensual (drill-down + sticky first col) ----------
function ReporteComparativo({ rows, cuentas, ctx }: { rows: Row[]; cuentas: Cuenta[]; ctx: ExpandCtx }) {
  const ahora = new Date();
  const mesActual = ahora.getMonth() + 1;
  const anioActual = ahora.getFullYear();
  const anioRows = rows[0]?.anio ?? anioActual;

  // Build grupos: for each account, values per month
  type CuentaMes = { cuenta: Cuenta; valores: number[]; total: number };
  type Grupo = { grupo: string; items: CuentaMes[]; subtotales: number[]; totalAnio: number };

  const grupos = useMemo(() => {
    const map: Record<string, Grupo> = {};
    cuentas.forEach((c) => {
      const valores = MESES.map((_, i) => rows.filter((r) => r.cuenta_codigo === c.codigo && r.mes === i + 1).reduce((s, r) => s + Number(r.base_usd || 0), 0));
      const total = valores.reduce((s, v) => s + v, 0);
      if (total === 0 && valores.every((v) => v === 0)) return;
      (map[c.grupo] ||= { grupo: c.grupo, items: [], subtotales: Array(12).fill(0), totalAnio: 0 });
      map[c.grupo].items.push({ cuenta: c, valores, total });
      valores.forEach((v, i) => { map[c.grupo].subtotales[i] += v; });
      map[c.grupo].totalAnio += total;
    });
    return Object.values(map);
  }, [cuentas, rows]);

  const cellCls = (i: number, v: number) => {
    const futuro = anioRows >= anioActual && i + 1 > mesActual;
    return `py-1.5 px-2 text-right mono ${futuro ? "text-muted-foreground/40" : ""} ${v === 0 ? "text-muted-foreground/60" : ""}`;
  };

  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2 px-2 sticky left-0 bg-background z-10 min-w-[240px] border-b">Cuenta</th>
              {MESES.map((m, i) => <th key={i} className="text-right py-2 px-2 border-b">{m}</th>)}
              <th className="text-right py-2 px-2 font-semibold border-b">Año</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => {
              const key = `grp::${g.grupo}`;
              const isOpen = ctx.isExpanded(key);
              return (
                <>
                  <tr key={`h-${g.grupo}`} className="bg-muted/30">
                    <td className="py-1.5 px-2 sticky left-0 bg-muted/30 z-10 font-medium border-b">
                      <button type="button" onClick={() => ctx.toggle(key)} className="flex items-center gap-1.5 w-full text-left">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {g.grupo}
                      </button>
                    </td>
                    {g.subtotales.map((v, i) => (
                      <td key={i} className={`${cellCls(i, v)} font-medium border-b`}>{v === 0 ? "—" : fmtUsd(v)}</td>
                    ))}
                    <td className="py-1.5 px-2 text-right mono font-semibold border-b">{fmtUsd(g.totalAnio)}</td>
                  </tr>
                  {isOpen && g.items.map((it) => (
                    <tr key={it.cuenta.codigo} className="hover:bg-muted/10">
                      <td className="py-1.5 px-2 sticky left-0 bg-background z-10 border-b pl-8">
                        <span className="text-muted-foreground">{it.cuenta.codigo}</span> {it.cuenta.nombre}
                      </td>
                      {it.valores.map((v, i) => (
                        <td key={i} className={`${cellCls(i, v)} border-b`}>{v === 0 ? "—" : fmtUsd(v)}</td>
                      ))}
                      <td className="py-1.5 px-2 text-right mono font-semibold border-b">{fmtUsd(it.total)}</td>
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Total({ label, value, positive: _positive, bold, big }: { label: string; value: number; positive?: boolean; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-2 px-2 border-t-2 ${bold ? "border-foreground bg-muted/30" : ""} ${big ? "text-base font-bold" : "text-sm font-semibold"}`}>
      <span>{label}</span>
      <span className={`mono ${value >= 0 ? "positive" : "negative"}`}>{value >= 0 ? fmtUsd(value) : `(${fmtUsd(Math.abs(value)).replace("$ ", "")})`}</span>
    </div>
  );
}
