import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Info, ArrowUpDown, Plus, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmtUsd, fmtDate } from "@/lib/format";
import { MESES } from "@/lib/account-helpers";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { logAudit } from "@/lib/audit";
import { useCuentasBancarias } from "@/components/bank-account-select";
import {
  Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, Line,
} from "recharts";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView } from "@/lib/usd-view-context";
import { tasaBcvQuery } from "@/lib/tasas";

export const Route = createFileRoute("/_authenticated/bono-propina")({ component: BonoPropinaPage });

type Bono10 = {
  id: string;
  fecha: string;
  monto_usd: number;
  monto_bs: number | null;
  tasa_paralela: number | null;
  centro_costo: string | null;
  concepto: string | null;
  notas: string | null;
  transaccion_entrada_id: string | null;
  transaccion_salida_id: string | null;
  fecha_distribucion: string | null;
  monto_distribuido_usd: number | null;
  notas_distribucion: string | null;
};

type Propina = Bono10;

type Tipo = "bono" | "propina";

type ItemCombinado = Bono10 & { tipo: Tipo };

type SortKey = "fecha" | "tipo" | "centro_costo" | "monto_usd" | "concepto" | "estado";
type TipoFiltro = "todos" | Tipo;

function BonoPropinaPage() {
  const { mode, label } = useUsdView();
  const now = new Date();
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState<number | "all">(now.getMonth() + 1);
  const [centroFiltro, setCentroFiltro] = useState<string>("Consolidado");
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>("todos");
  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [registrandoBono, setRegistrandoBono] = useState(false);
  const [registrandoPropina, setRegistrandoPropina] = useState(false);
  const [editandoBono, setEditandoBono] = useState<Bono10 | null>(null);
  const [editandoPropina, setEditandoPropina] = useState<Propina | null>(null);
  const [eliminandoBono, setEliminandoBono] = useState<Bono10 | null>(null);
  const [eliminandoPropina, setEliminandoPropina] = useState<Propina | null>(null);

  const { data: bonos } = useQuery({
    queryKey: ["bonos10", anio],
    queryFn: async () => {
      const ini = `${anio}-01-01`;
      const fin = `${anio}-12-31`;
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<Bono10>(async (from, to) =>
        await supabase
          .from("bonos_10")
          .select("id,fecha,monto_usd,monto_bs,tasa_paralela,centro_costo,concepto,notas,transaccion_entrada_id,transaccion_salida_id,fecha_distribucion,monto_distribuido_usd,notas_distribucion")
          .gte("fecha", ini)
          .lte("fecha", fin)
          .order("fecha", { ascending: false })
          .range(from, to),
      );
    },
  });

  const { data: propinas } = useQuery({
    queryKey: ["propinas", anio],
    queryFn: async () => {
      const ini = `${anio}-01-01`;
      const fin = `${anio}-12-31`;
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<Propina>(async (from, to) =>
        await supabase
          .from("propinas")
          .select("id,fecha,monto_usd,monto_bs,tasa_paralela,centro_costo,concepto,notas,transaccion_entrada_id,transaccion_salida_id,fecha_distribucion,monto_distribuido_usd,notas_distribucion")
          .gte("fecha", ini)
          .lte("fecha", fin)
          .order("fecha", { ascending: false })
          .range(from, to),
      );
    },
  });

  const { data: ventasMensual } = useQuery({
    queryKey: ["ventas-netas-mensual-bono-propina", anio, mode],
    queryFn: async () => {
      const view = mode === "bcv" ? "v_transacciones_mensual_bcv" : "v_transacciones_mensual";
      const { data } = await (supabase as any)
        .from(view)
        .select("mes,cuenta_codigo,base_usd")
        .eq("anio", anio)
        .eq("modo", "on_balance")
        .in("cuenta_codigo", ["1.1", "1.2", "1.3", "1.4", "1.6", "1.7"]);
      return (data ?? []) as { mes: number; cuenta_codigo: string; base_usd: number }[];
    },
  });

  const { data: tasasBcv } = useQuery({
    queryKey: ["tasas-bcv-bono-propina", anio],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("fecha,tasa")
        .gte("fecha", `${anio}-01-01`).lte("fecha", `${anio}-12-31`);
      return (data ?? []) as { fecha: string; tasa: number }[];
    },
  });

  // Saldos de los pasivos al personal: 8.1 propinas por pagar y 8.3 bono 10%.
  // Devengo (+) desde ventas, pago bancario (−). El saldo es lo que aún se debe.
  const { data: saldosPersonal } = useQuery({
    queryKey: ["saldos-pasivos-personal", anio],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const data = await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("cuenta_codigo,monto_usd")
          .in("cuenta_codigo", ["8.1", "8.3"])
          .eq("standby", false)
          .gte("fecha", `${anio}-01-01`)
          .lte("fecha", `${anio}-12-31`)
          .range(from, to),
      );
      const acc = { "8.1": 0, "8.3": 0 } as Record<string, number>;
      for (const r of (data ?? []) as any[]) acc[r.cuenta_codigo] += Number(r.monto_usd) || 0;
      return acc;
    },
  });

  const bcvByFecha = useMemo(() => {
    const m: Record<string, number> = {};
    (tasasBcv ?? []).forEach((r) => { m[r.fecha] = Number(r.tasa) || 0; });
    return m;
  }, [tasasBcv]);
  const usdOf = (p: { fecha: string; monto_usd: number; monto_bs: number | null }) => {
    if (mode !== "bcv") return Number(p.monto_usd ?? 0);
    const bs = Number(p.monto_bs ?? 0);
    const rate = bcvByFecha[p.fecha] || 0;
    if (rate > 0 && bs > 0) return bs / rate;
    return Number(p.monto_usd ?? 0);
  };

  // Todos los registros combinados (para pendientes/totales del año, sin filtros de mes/centro/tipo)
  const combinado: ItemCombinado[] = useMemo(() => {
    const b = (bonos ?? []).map((x) => ({ ...x, tipo: "bono" as Tipo }));
    const p = (propinas ?? []).map((x) => ({ ...x, tipo: "propina" as Tipo }));
    return [...b, ...p];
  }, [bonos, propinas]);

  const filtered = useMemo(() => {
    return combinado.filter((p) => {
      const m = Number(p.fecha.slice(5, 7));
      if (mes !== "all" && m !== mes) return false;
      if (centroFiltro !== "Consolidado" && (p.centro_costo ?? "") !== centroFiltro) return false;
      if (tipoFiltro !== "todos" && p.tipo !== tipoFiltro) return false;
      return true;
    });
  }, [combinado, mes, centroFiltro, tipoFiltro]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: any; let bv: any;
      if (sortKey === "estado") {
        av = a.transaccion_salida_id ? 1 : 0;
        bv = b.transaccion_salida_id ? 1 : 0;
      } else {
        av = (a as any)[sortKey] ?? "";
        bv = (b as any)[sortKey] ?? "";
      }
      let cmp = 0;
      if (sortKey === "monto_usd" || sortKey === "estado") cmp = Number(av) - Number(bv);
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const total = filtered.reduce((s, p) => s + usdOf(p), 0);
  const totalYV = filtered.filter((p) => p.centro_costo === "YV").reduce((s, p) => s + usdOf(p), 0);
  const totalBocu = filtered.filter((p) => p.centro_costo === "Bocu").reduce((s, p) => s + usdOf(p), 0);
  const dias = new Set(filtered.map((p) => p.fecha)).size;
  const promedio = dias > 0 ? total / dias : 0;

  // Pendientes de distribuir = todo el año (no del filtro de mes/centro/tipo) sin transacción de salida
  const pendientesBono = combinado.filter((p) => p.tipo === "bono" && !p.transaccion_salida_id);
  const pendientesPropina = combinado.filter((p) => p.tipo === "propina" && !p.transaccion_salida_id);
  const pendientesBonoUsd = pendientesBono.reduce((s, p) => s + usdOf(p), 0);
  const pendientesPropinaUsd = pendientesPropina.reduce((s, p) => s + usdOf(p), 0);
  const pendientesUsd = pendientesBonoUsd + pendientesPropinaUsd;
  const pendientesCount = pendientesBono.length + pendientesPropina.length;

  const chartData = useMemo(() => {
    const out: Record<number, { mes: number; mesLabel: string; Bono10: number; Propina: number; total: number }> = {};
    for (let m = 1; m <= 12; m++) {
      out[m] = { mes: m, mesLabel: MESES[m - 1], Bono10: 0, Propina: 0, total: 0 };
    }
    combinado.forEach((p) => {
      const m = Number(p.fecha.slice(5, 7));
      const amt = usdOf(p);
      if (p.tipo === "bono") out[m].Bono10 += amt;
      else out[m].Propina += amt;
      out[m].total += amt;
    });
    const ventasPorMes: Record<number, number> = {};
    (ventasMensual ?? []).forEach((v) => {
      // Descuentos (1.6) y devoluciones/NC (1.7) ya vienen con signo negativo
      // desde el origen (import), así que sumar directo ya resta correctamente.
      ventasPorMes[v.mes] = (ventasPorMes[v.mes] ?? 0) + Number(v.base_usd ?? 0);
    });
    return Object.values(out).map((r) => {
      const ventas = ventasPorMes[r.mes] ?? 0;
      const pct = ventas > 0 ? (r.total / ventas) * 100 : 0;
      return { ...r, ventas, pctVentas: Number(pct.toFixed(2)) };
    });
  }, [combinado, ventasMensual, mode, bcvByFecha]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bono 10% + Propina</h1>
          <p className="text-sm text-muted-foreground">Control conjunto del bono 10% de servicio y las propinas · devengo y distribución al personal</p>
        </div>
        <div className="flex items-center gap-2">
          <UsdViewToggle />
          <Button variant="outline" onClick={() => setRegistrandoPropina(true)}>
            <Plus className="h-4 w-4 mr-2" /> Registrar propina
          </Button>
          <Button onClick={() => setRegistrandoBono(true)}>
            <Plus className="h-4 w-4 mr-2" /> Registrar bono
          </Button>
        </div>
      </div>

      <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/30">
        <Info className="h-4 w-4" />
        <AlertDescription className="font-bold text-sm leading-relaxed">
          Ni el bono 10% de servicio (pasivo 8.3) ni las propinas adicionales (pasivo 8.1) son gasto de nómina ni
          afectan el G&P. Ninguno de los dos viene incluido en la nómina general — en la realidad, el negocio paga
          ambos juntos, al personal, en una sola transferencia bancaria aparte. Por eso esta pantalla los muestra
          unificados: cada fila indica su Tipo, pero ambos se descargan contra el mismo pago real. La distribución se
          marca automáticamente solo cuando se importa ese movimiento bancario (concepto con "bono" o "propina") desde
          Importar Movimientos — ya no existe un botón manual para marcarla.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div>
            <Label className="text-xs">Año</Label>
            <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mes</Label>
            <Select value={String(mes)} onValueChange={(v) => setMes(v === "all" ? "all" : Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el año</SelectItem>
                {MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Centro de costo</Label>
            <Select value={centroFiltro} onValueChange={setCentroFiltro}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Consolidado">Consolidado</SelectItem>
                <SelectItem value="YV">YV</SelectItem>
                <SelectItem value="Bocu">Bocú</SelectItem>
                <SelectItem value="Compartido">Compartido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoFiltro} onValueChange={(v) => setTipoFiltro(v as TipoFiltro)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="bono">Bono 10%</SelectItem>
                <SelectItem value="propina">Propina</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total del período</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmtUsd(total)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Por centro de costo</CardTitle></CardHeader>
          <CardContent>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">YV</span><span className="font-semibold">{fmtUsd(totalYV)}</span></div>
            <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Bocú</span><span className="font-semibold">{fmtUsd(totalBocu)}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Promedio por día</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtUsd(promedio)}</div>
            <div className="text-xs text-muted-foreground mt-1">{dias} día{dias === 1 ? "" : "s"} con movimiento</div>
          </CardContent>
        </Card>
        <Card className={pendientesUsd > 0.01 ? "border-orange-400 bg-orange-50/60 dark:bg-orange-950/20" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-xs uppercase ${pendientesUsd > 0.01 ? "text-orange-700 dark:text-orange-300" : "text-muted-foreground"}`}>
              Pendientes de distribuir
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${pendientesUsd > 0.01 ? "text-orange-700 dark:text-orange-300" : ""}`}>{fmtUsd(pendientesUsd)}</div>
            <div className="text-xs text-muted-foreground mt-1">{pendientesCount} registro{pendientesCount === 1 ? "" : "s"} sin distribuir (todo el año)</div>
            <div className="text-[11px] text-muted-foreground mt-1 flex justify-between">
              <span>Bono 10%: {fmtUsd(pendientesBonoUsd)} ({pendientesBono.length})</span>
              <span>Propina: {fmtUsd(pendientesPropinaUsd)} ({pendientesPropina.length})</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">8.3 · Bonos 10% por pagar (saldo {anio})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtUsd(saldosPersonal?.["8.3"] ?? 0)}</div>
            <div className="text-xs text-muted-foreground mt-1">Devengado en ventas menos lo pagado por banco</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">8.1 · Propinas por pagar (saldo {anio})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtUsd(saldosPersonal?.["8.1"] ?? 0)}</div>
            <div className="text-xs text-muted-foreground mt-1">Devengado en ventas menos lo pagado por banco</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Bono 10% + Propina mensual · {anio}</CardTitle></CardHeader>
        <CardContent style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mesLabel" />
              <YAxis yAxisId="left" tickFormatter={(v) => `$${v}`} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number, name) => name === "% sobre ventas" ? `${v}%` : fmtUsd(v)} />
              <Legend />
              <Bar yAxisId="left" dataKey="Bono10" stackId="a" fill="#534AB7" name="Bono 10%" />
              <Bar yAxisId="left" dataKey="Propina" stackId="a" fill="#0F6E56" name="Propina" />
              <Line yAxisId="right" type="monotone" dataKey="pctVentas" stroke="#E11D48" strokeWidth={2} name="% sobre ventas" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle ({sorted.length} registros)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  {([
                    ["fecha", "Fecha"],
                    ["tipo", "Tipo"],
                    ["centro_costo", "Centro"],
                    ["monto_usd", `Monto ${label}`],
                    ["concepto", "Método/Concepto"],
                    ["estado", "Estado"],
                  ] as [SortKey, string][]).map(([k, lbl]) => (
                    <th key={k} className="text-left py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort(k)}>
                      <span className="inline-flex items-center gap-1">{lbl} <ArrowUpDown className="h-3 w-3 opacity-50" />{sortKey === k && <span className="text-[10px]">{sortDir}</span>}</span>
                    </th>
                  ))}
                  <th className="text-left py-2 px-2">Notas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const distribuida = !!p.transaccion_salida_id;
                  return (
                    <tr key={`${p.tipo}-${p.id}`} className="border-b last:border-0">
                      <td className="py-1.5 px-2 mono">{fmtDate(p.fecha)}</td>
                      <td className="py-1.5 px-2">
                        {p.tipo === "bono" ? (
                          <Badge variant="outline" className="border-[#534AB7] text-[#534AB7]">Bono 10%</Badge>
                        ) : (
                          <Badge variant="outline" className="border-[#0F6E56] text-[#0F6E56]">Propina</Badge>
                        )}
                      </td>
                      <td className="py-1.5 px-2">{p.centro_costo ?? "—"}</td>
                      <td className="py-1.5 px-2 mono">{fmtUsd(usdOf(p))}</td>
                      <td className="py-1.5 px-2">{p.concepto ?? "—"}</td>
                      <td className="py-1.5 px-2">
                        {distribuida ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-300">
                            Distribuida {p.fecha_distribucion ? `· ${fmtDate(p.fecha_distribucion)}` : ""}
                          </Badge>
                        ) : (
                          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-orange-300">
                            Pendiente de distribuir
                          </Badge>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground text-xs">{p.notas ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Editar"
                            onClick={() => (p.tipo === "bono" ? setEditandoBono(p) : setEditandoPropina(p))}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Eliminar"
                            onClick={() => (p.tipo === "bono" ? setEliminandoBono(p) : setEliminandoPropina(p))}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Sin registros en este período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {registrandoBono && <RegistrarBonoDialog onClose={() => setRegistrandoBono(false)} />}
      {registrandoPropina && <RegistrarPropinaDialog onClose={() => setRegistrandoPropina(false)} />}
      {editandoBono && <EditarBonoDialog bono={editandoBono} onClose={() => setEditandoBono(null)} />}
      {editandoPropina && <EditarPropinaDialog propina={editandoPropina} onClose={() => setEditandoPropina(null)} />}
      {eliminandoBono && <EliminarBonoDialog bono={eliminandoBono} onClose={() => setEliminandoBono(null)} />}
      {eliminandoPropina && <EliminarPropinaDialog propina={eliminandoPropina} onClose={() => setEliminandoPropina(null)} />}
    </div>
  );
}

// ──────────────────────────── Registrar bono (devengado) ────────────────────────────
function RegistrarBonoDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [centro, setCentro] = useState<"YV" | "Bocu">("YV");
  const [montoUsd, setMontoUsd] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(montoUsd);
    if (!n || n <= 0) return toast.error("Monto inválido");
    if (!user) return toast.error("Sin sesión");
    setBusy(true);

    const [{ data: rateBcv }, { data: rateP }] = await Promise.all([
      supabase.from("tasas_bcv").select("tasa"),
      supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const tBcv = Number((rateBcv as any)?.tasa) || 0;
    const tPar = Number((rateP as any)?.tasa) || tBcv;
    const montoBs = n * (tPar || tBcv || 0);

    // 1) Transacción 8.3 (pasivo devengado, no afecta G&P)
    const { data: txEntrada, error: e1 } = await supabase.from("transacciones").insert({
      fecha, cuenta_codigo: "8.3", centro_costo: centro as any,
      monto_bs: montoBs, monto_base_bs: montoBs, iva_bs: 0,
      iva_aplica: false, tipo_iva: null,
      tasa_bcv: tBcv || tPar, tasa_paralela: tPar,
      monto_usd: n,
      metodo_pago: "pendiente" as any,
      notas: `Bono 10% devengado — ${fecha} — ${centro}`,
      modo: "on_balance" as any,
      created_by: user.id,
    } as any).select().single();

    if (e1 || !txEntrada) { setBusy(false); return toast.error(e1?.message ?? "Falló crear transacción de entrada"); }
    await logAudit("transacciones", "INSERT", txEntrada.id, null, txEntrada);

    // 2) Registro en bonos_10
    const { error: e2 } = await supabase.from("bonos_10").insert({
      fecha, centro_costo: centro as any,
      monto_usd: n, monto_bs: montoBs,
      tasa_paralela: tPar,
      concepto: "Bono 10% manual",
      notas: notas || null,
      transaccion_entrada_id: txEntrada.id,
      created_by: user.id,
    } as any);

    setBusy(false);
    if (e2) return toast.error("Transacción creada pero falló registrar el bono: " + e2.message);
    toast.success("Bono 10% registrado · pendiente de distribuir");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar bono 10% devengado</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Crea una transacción de entrada en la cuenta <b>8.3 Bonos 10% por pagar al personal</b>. Úsalo solo para
            casos que no vengan de una venta ya importada. Se marcará como distribuido automáticamente cuando se
            importe el movimiento bancario real de pago (bono + propina juntos).
          </p>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div>
              <Label>Centro de costo</Label>
              <Select value={centro} onValueChange={(v) => setCentro(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YV">YV</SelectItem>
                  <SelectItem value="Bocu">Bocú</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Monto USD</Label>
            <Input type="number" step="0.01" min="0" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar entrada"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────── Editar bono ────────────────────────────
function EditarBonoDialog({ bono, onClose }: { bono: Bono10; onClose: () => void }) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(bono.fecha);
  const [centro, setCentro] = useState<string>(bono.centro_costo ?? "YV");
  const [montoUsd, setMontoUsd] = useState(String(bono.monto_usd ?? ""));
  const [notas, setNotas] = useState(bono.notas ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(montoUsd);
    if (!n || n <= 0) return toast.error("Monto inválido");
    setBusy(true);

    const [{ data: rateBcv }, { data: rateP }] = await Promise.all([
      tasaBcvQuery(fecha, "tasa"),
      supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const tBcv = Number((rateBcv as any)?.tasa) || Number(bono.tasa_paralela) || 0;
    const tPar = Number((rateP as any)?.tasa) || Number(bono.tasa_paralela) || tBcv;
    const montoBs = +(n * (tPar || tBcv || 0)).toFixed(2);

    const { error: ePr } = await supabase.from("bonos_10").update({
      fecha, centro_costo: centro as any,
      monto_usd: n, monto_bs: montoBs, tasa_paralela: tPar,
      notas: notas || null,
    } as any).eq("id", bono.id);
    if (ePr) { setBusy(false); return toast.error("Falló actualizar el bono: " + ePr.message); }
    await logAudit("bonos_10", "UPDATE", bono.id, bono, { ...bono, fecha, centro_costo: centro, monto_usd: n, monto_bs: montoBs });

    if (bono.transaccion_entrada_id) {
      const { error: eTx } = await supabase.from("transacciones").update({
        fecha, centro_costo: centro as any,
        monto_bs: montoBs, monto_base_bs: montoBs,
        monto_usd: n, tasa_bcv: tBcv || tPar, tasa_paralela: tPar,
      } as any).eq("id", bono.transaccion_entrada_id);
      if (eTx) toast.error("Bono actualizado, pero falló sync de transacción de entrada: " + eTx.message);
    }
    if (bono.transaccion_salida_id) {
      const montoSalUsd = Number(bono.monto_distribuido_usd ?? n);
      const montoSalBs = +(montoSalUsd * (tPar || tBcv || 0)).toFixed(2);
      const { error: eTx2 } = await supabase.from("transacciones").update({
        centro_costo: centro as any,
        monto_bs: -montoSalBs, monto_base_bs: -montoSalBs,
        monto_usd: -montoSalUsd, tasa_bcv: tBcv || tPar, tasa_paralela: tPar,
      } as any).eq("id", bono.transaccion_salida_id);
      if (eTx2) toast.error("Bono actualizado, pero falló sync de transacción de salida: " + eTx2.message);
    }

    setBusy(false);
    toast.success("Bono actualizado");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar bono 10%</DialogTitle>
          <p className="text-xs text-muted-foreground">Los cambios sincronizan la(s) transacción(es) vinculada(s) en 8.3.</p>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div>
              <Label>Centro de costo</Label>
              <Select value={centro} onValueChange={setCentro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YV">YV</SelectItem>
                  <SelectItem value="Bocu">Bocú</SelectItem>
                  <SelectItem value="Compartido">Compartido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Monto USD</Label>
            <Input type="number" step="0.01" min="0" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────── Eliminar bono ────────────────────────────
function EliminarBonoDialog({ bono, onClose }: { bono: Bono10; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const eliminar = async () => {
    setBusy(true);
    const txIds = [bono.transaccion_entrada_id, bono.transaccion_salida_id].filter(Boolean) as string[];
    const { error: eP } = await supabase.from("bonos_10").delete().eq("id", bono.id);
    if (eP) { setBusy(false); return toast.error("Falló eliminar el bono: " + eP.message); }
    await logAudit("bonos_10", "DELETE", bono.id, bono, null);
    if (txIds.length) {
      const { error: eT } = await supabase.from("transacciones").delete().in("id", txIds);
      if (eT) {
        setBusy(false);
        return toast.error("Bono eliminado, pero falló eliminar transacción(es): " + eT.message);
      }
      for (const id of txIds) await logAudit("transacciones", "DELETE", id, { id }, null);
    }
    setBusy(false);
    toast.success("Bono y transacciones asociadas eliminadas");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar bono 10%</AlertDialogTitle>
          <AlertDialogDescription>
            Esto eliminará el bono del {fmtDate(bono.fecha)} por {fmtUsd(bono.monto_usd)} y su(s) transacción(es)
            asociada(s) en el sistema. ¿Confirmar?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); eliminar(); }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Eliminando…" : "Eliminar todo"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ──────────────────────────── Registrar propina (recibida) ────────────────────────────
function RegistrarPropinaDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: bancos } = useCuentasBancarias();
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [centro, setCentro] = useState<"YV" | "Bocu">("YV");
  const [montoUsd, setMontoUsd] = useState("");
  const [metodo, setMetodo] = useState<string>("transferencia");
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(montoUsd);
    if (!n || n <= 0) return toast.error("Monto inválido");
    if (!user) return toast.error("Sin sesión");
    if (!cuentaBancariaId) return toast.error("Selecciona la cuenta bancaria donde se recibió la propina");
    setBusy(true);

    // tasas del día
    const [{ data: rateBcv }, { data: rateP }] = await Promise.all([
      supabase.from("tasas_bcv").select("tasa"),
      supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const tBcv = Number((rateBcv as any)?.tasa) || 0;
    const tPar = Number((rateP as any)?.tasa) || tBcv;
    const montoBs = n * (tPar || tBcv || 0);

    const grupoPropina = crypto.randomUUID();

    // 1) Transacción 8.1 entrada
    const { data: txEntrada, error: e1 } = await supabase.from("transacciones").insert({
      fecha, cuenta_codigo: "8.1", centro_costo: centro as any,
      monto_bs: montoBs, monto_base_bs: montoBs, iva_bs: 0,
      iva_aplica: false, tipo_iva: null,
      tasa_bcv: tBcv || tPar, tasa_paralela: tPar,
      monto_usd: n,
      metodo_pago: metodo as any,
      cuenta_bancaria_id: cuentaBancariaId,
      notas: `Propina recibida — ${fecha} — ${centro}`,
      modo: "on_balance" as any,
      grupo_transaccion_id: grupoPropina,
      created_by: user.id,
    } as any).select().single();

    if (e1 || !txEntrada) { setBusy(false); return toast.error(e1?.message ?? "Falló crear transacción de entrada"); }
    await logAudit("transacciones", "INSERT", txEntrada.id, null, txEntrada);

    // 2) Registro propinas
    const { error: e2 } = await supabase.from("propinas").insert({
      fecha, centro_costo: centro as any,
      monto_usd: n, monto_bs: montoBs,
      tasa_paralela: tPar,
      concepto: `Propina ${metodo}`,
      notas: notas || null,
      transaccion_entrada_id: txEntrada.id,
      created_by: user.id,
    } as any);

    setBusy(false);
    if (e2) return toast.error("Transacción creada pero falló registrar propina: " + e2.message);
    toast.success("Propina registrada · pendiente de distribuir");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar propina recibida</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Crea una transacción de entrada en la cuenta <b>8.1 Propinas por pagar al personal</b>. Se marcará como
            distribuida automáticamente cuando se importe el movimiento bancario real de pago (bono + propina juntos).
          </p>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div>
              <Label>Centro de costo</Label>
              <Select value={centro} onValueChange={(v) => setCentro(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YV">YV</SelectItem>
                  <SelectItem value="Bocu">Bocú</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Monto USD</Label>
              <Input type="number" step="0.01" min="0" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} required className="mono" />
            </div>
            <div>
              <Label>Método de pago</Label>
              <Select value={metodo} onValueChange={setMetodo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="pago_movil">Pago móvil</SelectItem>
                  <SelectItem value="zelle">Zelle</SelectItem>
                  <SelectItem value="efectivo_usd">Efectivo USD</SelectItem>
                  <SelectItem value="efectivo_bs">Efectivo Bs</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Cuenta bancaria de destino</Label>
            <Select value={cuentaBancariaId} onValueChange={setCuentaBancariaId}>
              <SelectTrigger><SelectValue placeholder="Selecciona…" /></SelectTrigger>
              <SelectContent>
                {(bancos ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nombre} — {b.banco} ({b.moneda})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar entrada"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────── Editar propina ────────────────────────────
function EditarPropinaDialog({ propina, onClose }: { propina: Propina; onClose: () => void }) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(propina.fecha);
  const [centro, setCentro] = useState<string>(propina.centro_costo ?? "YV");
  const [montoUsd, setMontoUsd] = useState(String(propina.monto_usd ?? ""));
  const [notas, setNotas] = useState(propina.notas ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(montoUsd);
    if (!n || n <= 0) return toast.error("Monto inválido");
    setBusy(true);

    // Tasas a la fecha (recalculamos por si cambió)
    const [{ data: rateBcv }, { data: rateP }] = await Promise.all([
      tasaBcvQuery(fecha, "tasa"),
      supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const tBcv = Number((rateBcv as any)?.tasa) || Number(propina.tasa_paralela) || 0;
    const tPar = Number((rateP as any)?.tasa) || Number(propina.tasa_paralela) || tBcv;
    const montoBs = +(n * (tPar || tBcv || 0)).toFixed(2);

    const { error: ePr } = await supabase.from("propinas").update({
      fecha, centro_costo: centro as any,
      monto_usd: n, monto_bs: montoBs, tasa_paralela: tPar,
      notas: notas || null,
    } as any).eq("id", propina.id);
    if (ePr) { setBusy(false); return toast.error("Falló actualizar propina: " + ePr.message); }
    await logAudit("propinas", "UPDATE", propina.id, propina, { ...propina, fecha, centro_costo: centro, monto_usd: n, monto_bs: montoBs });

    // Sync transacción de entrada
    if (propina.transaccion_entrada_id) {
      const { error: eTx } = await supabase.from("transacciones").update({
        fecha, centro_costo: centro as any,
        monto_bs: montoBs, monto_base_bs: montoBs,
        monto_usd: n, tasa_bcv: tBcv || tPar, tasa_paralela: tPar,
      } as any).eq("id", propina.transaccion_entrada_id);
      if (eTx) toast.error("Propina actualizada, pero falló sync de transacción de entrada: " + eTx.message);
    }
    // Sync transacción de salida (si existe) — mantenemos negativos
    if (propina.transaccion_salida_id) {
      const montoSalUsd = Number(propina.monto_distribuido_usd ?? n);
      const montoSalBs = +(montoSalUsd * (tPar || tBcv || 0)).toFixed(2);
      const { error: eTx2 } = await supabase.from("transacciones").update({
        centro_costo: centro as any,
        monto_bs: -montoSalBs, monto_base_bs: -montoSalBs,
        monto_usd: -montoSalUsd, tasa_bcv: tBcv || tPar, tasa_paralela: tPar,
      } as any).eq("id", propina.transaccion_salida_id);
      if (eTx2) toast.error("Propina actualizada, pero falló sync de transacción de salida: " + eTx2.message);
    }

    setBusy(false);
    toast.success("Propina actualizada");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar propina</DialogTitle>
          <p className="text-xs text-muted-foreground">Los cambios sincronizan la(s) transacción(es) vinculada(s) en 8.1.</p>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div>
              <Label>Centro de costo</Label>
              <Select value={centro} onValueChange={setCentro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YV">YV</SelectItem>
                  <SelectItem value="Bocu">Bocú</SelectItem>
                  <SelectItem value="Compartido">Compartido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Monto USD</Label>
            <Input type="number" step="0.01" min="0" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────── Eliminar propina ────────────────────────────
function EliminarPropinaDialog({ propina, onClose }: { propina: Propina; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const eliminar = async () => {
    setBusy(true);
    const txIds = [propina.transaccion_entrada_id, propina.transaccion_salida_id].filter(Boolean) as string[];
    // 1) Borrar propina (libera FKs por ON DELETE SET NULL pero igual la quitamos)
    const { error: eP } = await supabase.from("propinas").delete().eq("id", propina.id);
    if (eP) { setBusy(false); return toast.error("Falló eliminar propina: " + eP.message); }
    await logAudit("propinas", "DELETE", propina.id, propina, null);
    // 2) Borrar transacciones vinculadas
    if (txIds.length) {
      const { error: eT } = await supabase.from("transacciones").delete().in("id", txIds);
      if (eT) {
        setBusy(false);
        return toast.error("Propina eliminada, pero falló eliminar transacción(es): " + eT.message);
      }
      for (const id of txIds) await logAudit("transacciones", "DELETE", id, { id }, null);
    }
    setBusy(false);
    toast.success("Propina y transacciones asociadas eliminadas");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar propina</AlertDialogTitle>
          <AlertDialogDescription>
            Esto eliminará la propina del {fmtDate(propina.fecha)} por {fmtUsd(propina.monto_usd)} y su(s) transacción(es)
            asociada(s) en el sistema. ¿Confirmar?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); eliminar(); }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Eliminando…" : "Eliminar todo"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
