import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtUsd } from "@/lib/format";
import { MESES, ordenarPorCodigo } from "@/lib/account-helpers";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart,
  AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView, usdVisual } from "@/lib/usd-view-context";
import { TrendingUp, Wallet, HandCoins, Target, PencilLine, Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/resumen-ejecutivo")({ component: ResumenEjecutivoPage });

const PALETTE = ["#534AB7", "#0F6E56", "#E8A87C", "#C38D9E", "#41B3A3", "#F39C12", "#3498DB", "#E74C3C"];

type Cuenta = { codigo: string; nombre: string; grupo: string };
type Row = { periodo: string; anio: number; mes: number; cuenta_codigo: string; modo: string; base_usd: number };

function KpiCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}

function ResumenEjecutivoPage() {
  const { mode, label } = useUsdView();
  const qc = useQueryClient();
  const { user } = useAuth();
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [proyDialog, setProyDialog] = useState<{ periodo: string; ingresos: string; margen: string; notas: string } | null>(null);

  // ---------- Capital / financiamiento / dividendos (histórico completo, todas las fechas) ----------
  const { data: movsCapital } = useQuery({
    queryKey: ["resumen-ejecutivo-capital"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("fecha, cuenta_codigo, monto_bs, monto_usd, tasa_bcv, tasa_paralela, detalle")
        .in("cuenta_codigo", ["5.1", "5.4", "5.5"])
        .neq("standby", true)
        .order("fecha");
      return data ?? [];
    },
  });

  const capitalTotal = useMemo(
    () => (movsCapital ?? []).filter((t: any) => t.cuenta_codigo === "5.5").reduce((s, t: any) => s + (usdVisual(t, mode) ?? 0), 0),
    [movsCapital, mode],
  );
  const financiamientoTotal = useMemo(
    () => (movsCapital ?? []).filter((t: any) => t.cuenta_codigo === "5.1").reduce((s, t: any) => s + (usdVisual(t, mode) ?? 0), 0),
    [movsCapital, mode],
  );
  const dividendosTotal = useMemo(
    () => (movsCapital ?? []).filter((t: any) => t.cuenta_codigo === "5.4").reduce((s, t: any) => s + (usdVisual(t, mode) ?? 0), 0),
    [movsCapital, mode],
  );
  const porAportante = useMemo(() => {
    const m = new Map<string, number>();
    (movsCapital ?? [])
      .filter((t: any) => t.cuenta_codigo === "5.5")
      .forEach((t: any) => {
        const k = t.detalle?.trim() || "—Sin nombre—";
        m.set(k, (m.get(k) ?? 0) + (usdVisual(t, mode) ?? 0));
      });
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [movsCapital, mode]);

  // Capital acumulado por mes (suma corrida) para el gráfico de área
  const capitalAcumuladoPorMes = useMemo(() => {
    const porMes = new Map<string, number>();
    (movsCapital ?? [])
      .filter((t: any) => t.cuenta_codigo === "5.5")
      .forEach((t: any) => {
        const key = String(t.fecha).slice(0, 7);
        porMes.set(key, (porMes.get(key) ?? 0) + (usdVisual(t, mode) ?? 0));
      });
    const meses = Array.from(porMes.keys()).sort();
    let acumulado = 0;
    return meses.map((m) => {
      acumulado += porMes.get(m) ?? 0;
      return { periodo: m, acumulado: Number(acumulado.toFixed(2)) };
    });
  }, [movsCapital, mode]);

  // ---------- Cuentas del plan (para agrupar Ingresos / COGS / Gastos) ----------
  const { data: cuentas } = useQuery({
    queryKey: ["resumen-ejecutivo-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo").eq("afecta_gyp", true);
      return ordenarPorCodigo((data ?? []) as Cuenta[]);
    },
  });

  // ---------- Vista mensual (misma que usa G&P) ----------
  const { data: rows } = useQuery({
    queryKey: ["resumen-ejecutivo-mensual", anio, mode],
    queryFn: async () => {
      const view = mensualView(mode);
      const { data } = await (supabase as any)
        .from(view)
        .select("periodo,anio,mes,cuenta_codigo,modo,base_usd")
        .eq("anio", anio)
        .eq("modo", "on_balance");
      return (data ?? []) as Row[];
    },
  });

  const { data: proyecciones } = useQuery({
    queryKey: ["proyecciones-mensuales"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("proyecciones_mensuales").select("*");
      return (data ?? []) as { periodo: string; ingresos_proyectados: number | null; margen_neto_proyectado_pct: number | null; notas: string | null }[];
    },
  });
  const proyPorPeriodo = useMemo(() => {
    const m = new Map<string, { ingresos_proyectados: number | null; margen_neto_proyectado_pct: number | null }>();
    (proyecciones ?? []).forEach((p) => m.set(p.periodo, p));
    return m;
  }, [proyecciones]);

  const codigoGrupo = useMemo(() => {
    const m = new Map<string, string>();
    (cuentas ?? []).forEach((c) => m.set(c.codigo, c.grupo));
    return m;
  }, [cuentas]);

  const mensual = useMemo(() => {
    const porMes: Record<number, { ingresos: number; cogs: number; gastos: number }> = {};
    for (let m = 1; m <= 12; m++) porMes[m] = { ingresos: 0, cogs: 0, gastos: 0 };
    (rows ?? []).forEach((r) => {
      const grupo = codigoGrupo.get(r.cuenta_codigo);
      if (!grupo) return;
      const val = Number(r.base_usd) || 0;
      if (grupo === "Ingresos") porMes[r.mes].ingresos += val;
      else if (grupo === "COGS") porMes[r.mes].cogs += val;
      else porMes[r.mes].gastos += val;
    });
    return MESES.map((nombre, i) => {
      const mesNum = i + 1;
      const periodo = `${anio}-${String(mesNum).padStart(2, "0")}`;
      const { ingresos, cogs, gastos } = porMes[mesNum];
      const utilidad = ingresos - cogs - gastos;
      const margen = ingresos > 0 ? (utilidad / ingresos) * 100 : 0;
      const proy = proyPorPeriodo.get(periodo);
      const ingresosProy = proy?.ingresos_proyectados != null ? Number(proy.ingresos_proyectados) : null;
      const variacion = ingresosProy && ingresosProy > 0 ? ((ingresos - ingresosProy) / ingresosProy) * 100 : null;
      return {
        periodo, mesLabel: nombre, ingresos, cogs, gastos, utilidad,
        margen: Number(margen.toFixed(1)),
        ingresosProy, variacion: variacion != null ? Number(variacion.toFixed(1)) : null,
        tieneDatos: ingresos > 0 || cogs > 0 || gastos > 0,
      };
    });
  }, [rows, codigoGrupo, anio, proyPorPeriodo]);

  const conDatos = mensual.filter((m) => m.tieneDatos);
  const ingresosYTD = conDatos.reduce((s, m) => s + m.ingresos, 0);
  const cogsYTD = conDatos.reduce((s, m) => s + m.cogs, 0);
  const gastosYTD = conDatos.reduce((s, m) => s + m.gastos, 0);
  const margenBrutoYTD = ingresosYTD - cogsYTD;
  const margenNetoYTD = margenBrutoYTD - gastosYTD;
  const margenBrutoPct = ingresosYTD > 0 ? (margenBrutoYTD / ingresosYTD) * 100 : 0;
  const margenNetoPct = ingresosYTD > 0 ? (margenNetoYTD / ingresosYTD) * 100 : 0;

  // Utilidad neta acumulada histórica (no solo del año seleccionado) — aproximación
  // usando el año en curso como base, ya que es el dato disponible con más detalle.
  const multiploSobreCapital = capitalTotal > 0 ? (margenNetoYTD + dividendosTotal) / capitalTotal : null;

  const anios = useMemo(() => {
    const s = new Set<number>([anioActual]);
    (movsCapital ?? []).forEach((t: any) => s.add(new Date(t.fecha).getUTCFullYear()));
    return Array.from(s).sort((a, b) => b - a);
  }, [movsCapital, anioActual]);

  const abrirProyeccion = (periodo: string) => {
    const existente = proyPorPeriodo.get(periodo);
    setProyDialog({
      periodo,
      ingresos: existente?.ingresos_proyectados != null ? String(existente.ingresos_proyectados) : "",
      margen: existente?.margen_neto_proyectado_pct != null ? String(existente.margen_neto_proyectado_pct) : "",
      notas: "",
    });
  };

  const guardarProyeccion = async () => {
    if (!proyDialog || !user) return;
    const ingresos = proyDialog.ingresos ? Number(proyDialog.ingresos) : null;
    const margen = proyDialog.margen ? Number(proyDialog.margen) : null;
    const { error } = await (supabase as any).from("proyecciones_mensuales").upsert(
      { periodo: proyDialog.periodo, ingresos_proyectados: ingresos, margen_neto_proyectado_pct: margen, notas: proyDialog.notas || null, created_by: user.id },
      { onConflict: "periodo" },
    );
    if (error) return toast.error(error.message);
    toast.success("Proyección guardada");
    setProyDialog(null);
    qc.invalidateQueries({ queryKey: ["proyecciones-mensuales"] });
  };

  const PERMITIDOS = ["irwinperret@hotmail.com", "irwinperret@gmail.com", "cristobalperret@gmail.com", "marianaperret@gmail.com"];
  const autorizado = !!user?.email && PERMITIDOS.includes(user.email.toLowerCase());
  if (!autorizado) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Wrench className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-medium">En Construcción</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Esta pantalla todavía no está disponible.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resumen IPA</h1>
          <p className="text-sm text-muted-foreground">Capital aportado, desempeño del negocio y proyecciones</p>
        </div>
        <div className="flex items-center gap-2">
          <UsdViewToggle />
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{anios.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard icon={Wallet} label="Capital aportado (histórico)" value={fmtUsd(capitalTotal)} sub={`${porAportante.length} aportante${porAportante.length === 1 ? "" : "s"}`} />
        <KpiCard icon={HandCoins} label="Financiamiento recibido" value={fmtUsd(financiamientoTotal)} />
        <KpiCard icon={TrendingUp} label="Dividendos pagados" value={fmtUsd(dividendosTotal)} sub={dividendosTotal === 0 ? "Aún no se han distribuido" : undefined} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard icon={TrendingUp} label={`Ingresos ${anio} (YTD)`} value={fmtUsd(ingresosYTD)} />
        <KpiCard icon={TrendingUp} label={`Margen bruto ${anio}`} value={fmtUsd(margenBrutoYTD)} sub={`${margenBrutoPct.toFixed(1)}% de ingresos`} />
        <KpiCard icon={TrendingUp} label={`Margen neto ${anio}`} value={fmtUsd(margenNetoYTD)} sub={`${margenNetoPct.toFixed(1)}% de ingresos`} />
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        <strong>Margen bruto</strong>: lo que queda de los ingresos después de descontar solo el costo directo de la
        mercancía vendida (COGS), antes de restar nómina, alquiler y demás gastos operativos.
      </p>

      {/* Retorno para el inversionista */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2"><CardTitle className="text-base">Retorno sobre el capital aportado</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-bold">
              {multiploSobreCapital != null ? `${multiploSobreCapital.toFixed(2)}x` : "—"}
            </span>
            <span className="text-sm text-muted-foreground">
              (Utilidad neta {anio} + dividendos pagados) ÷ capital total aportado
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Indicador simple de referencia, no reemplaza un cálculo formal de TIR o VAN.
          </p>
        </CardContent>
      </Card>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Ingresos mensuales y margen neto — {anio}</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mensual}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mesLabel" fontSize={11} />
                <YAxis yAxisId="left" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} fontSize={11} />
                <Tooltip formatter={(v: number, name) => (name === "Margen neto %" ? `${v}%` : fmtUsd(v))} />
                <Legend />
                <Bar yAxisId="left" dataKey="ingresos" name="Ingresos" fill="#534AB7" />
                <Line yAxisId="right" type="monotone" dataKey="margen" name="Margen neto %" stroke="#E11D48" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Ingresos: real vs proyectado — {anio}</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mensual}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mesLabel" fontSize={11} />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Legend />
                <Bar dataKey="ingresos" name="Real" fill="#534AB7" />
                <Line type="monotone" dataKey="ingresosProy" name="Proyectado" stroke="#F39C12" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabla mensual */}
      <Card>
        <CardHeader><CardTitle className="text-base">Detalle mensual — {anio}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">Mes</th>
                  <th className="text-right py-2 px-2">Ingresos</th>
                  <th className="text-right py-2 px-2">COGS</th>
                  <th className="text-right py-2 px-2">Gastos Op.</th>
                  <th className="text-right py-2 px-2">Utilidad Neta</th>
                  <th className="text-right py-2 px-2">Margen %</th>
                  <th className="text-right py-2 px-2">Ingresos Proy.</th>
                  <th className="text-right py-2 px-2">Var. %</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {mensual.map((m) => (
                  <tr key={m.periodo} className="border-b last:border-0">
                    <td className="py-1.5 px-2">{m.mesLabel}</td>
                    <td className="py-1.5 px-2 text-right mono">{m.tieneDatos ? fmtUsd(m.ingresos) : "—"}</td>
                    <td className="py-1.5 px-2 text-right mono">{m.tieneDatos ? fmtUsd(m.cogs) : "—"}</td>
                    <td className="py-1.5 px-2 text-right mono">{m.tieneDatos ? fmtUsd(m.gastos) : "—"}</td>
                    <td className="py-1.5 px-2 text-right mono font-medium">{m.tieneDatos ? fmtUsd(m.utilidad) : "—"}</td>
                    <td className="py-1.5 px-2 text-right mono">{m.tieneDatos ? `${m.margen}%` : "—"}</td>
                    <td className="py-1.5 px-2 text-right mono text-muted-foreground">{m.ingresosProy != null ? fmtUsd(m.ingresosProy) : "—"}</td>
                    <td className={`py-1.5 px-2 text-right mono ${m.variacion != null && m.variacion < 0 ? "text-destructive" : m.variacion != null ? "text-green-600" : ""}`}>
                      {m.variacion != null ? `${m.variacion > 0 ? "+" : ""}${m.variacion}%` : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Editar proyección" onClick={() => abrirProyeccion(m.periodo)}>
                        <PencilLine className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {proyDialog && (
        <Dialog open onOpenChange={(o) => !o && setProyDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Target className="h-4 w-4" /> Proyección de {proyDialog.periodo}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Ingresos proyectados (USD)</Label>
                <Input type="number" step="0.01" value={proyDialog.ingresos} onChange={(e) => setProyDialog({ ...proyDialog, ingresos: e.target.value })} className="mono" />
              </div>
              <div>
                <Label>Margen neto esperado % (opcional)</Label>
                <Input type="number" step="0.1" value={proyDialog.margen} onChange={(e) => setProyDialog({ ...proyDialog, margen: e.target.value })} className="mono" />
              </div>
              <div>
                <Label>Notas</Label>
                <Input value={proyDialog.notas} onChange={(e) => setProyDialog({ ...proyDialog, notas: e.target.value })} placeholder="Opcional…" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProyDialog(null)}>Cancelar</Button>
              <Button onClick={guardarProyeccion}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
