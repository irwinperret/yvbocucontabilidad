import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { useCuentasBancarias, BankAccountSelect } from "@/components/bank-account-select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, usdVisual } from "@/lib/usd-view-context";

const SECCIONES = [
  { key: "Cocina",         cuenta: "3.3",  centro: "Compartido", color: "#0F6E56" },
  { key: "Bocú",           cuenta: "3.7",  centro: "Bocu",       color: "#534AB7" },
  { key: "YV",             cuenta: "3.12", centro: "YV",         color: "#E8A87C" },
  { key: "Administración", cuenta: "3.18", centro: "Compartido", color: "#3498DB" },
] as const;
const CUENTAS_LIQ = SECCIONES.map((s) => s.cuenta);

type SortKey = "fecha" | "empleado" | "seccion" | "cuenta_codigo" | "monto_bs" | "tasa_paralela" | "monto_usd" | "banco";

export const Route = createFileRoute("/_authenticated/liquidaciones")({
  component: LiquidacionesHistorialPage,
});

function seccionFromRow(row: any) {
  const def = SECCIONES.find((s) => s.cuenta === row.cuenta_codigo);
  return def?.key ?? "—";
}
function empleadoFromRow(row: any): string {
  if (row.detalle) {
    const parts = String(row.detalle).split("·");
    if (parts.length >= 2) return parts.slice(1).join("·").trim();
    return String(row.detalle).trim();
  }
  if (row.notas) {
    const m = /Liquidación\s+—\s+([^—]+?)\s+—/.exec(row.notas);
    if (m) return m[1].trim();
  }
  return "";
}

function LiquidacionesHistorialPage() {
  const { mode, label } = useUsdView();
  const qc = useQueryClient();
  const anioActual = new Date().getFullYear();
  const [seccionFiltro, setSeccionFiltro] = useState<string>("Todos");
  const [desde, setDesde] = useState<string>(`${anioActual}-01-01`);
  const [hasta, setHasta] = useState<string>(`${anioActual}-12-31`);
  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["liquidaciones-historial", desde, hasta],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, centro_costo, cuenta_codigo, monto_bs, monto_usd, tasa_paralela, tasa_bcv, detalle, notas, cuenta_bancaria_id, metodo_pago")
        .in("cuenta_codigo", CUENTAS_LIQ)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      return data ?? [];
    },
  });

  const { data: bancos } = useCuentasBancarias();
  const banco = (id: string | null) => {
    if (!id) return "—";
    const b = (bancos ?? []).find((x: any) => x.id === id);
    if (!b) return "—";
    const last4 = (b.numero || "").slice(-4);
    return `${b.nombre} ****${last4}`;
  };

  const enriched = useMemo(() => {
    return (rows ?? []).map((r: any) => ({
      ...r,
      seccion: seccionFromRow(r),
      empleado: empleadoFromRow(r),
      banco_nombre: banco(r.cuenta_bancaria_id),
    }));
  }, [rows, bancos]);

  const filtered = useMemo(() => {
    return enriched.filter((r) => seccionFiltro === "Todos" || r.seccion === seccionFiltro);
  }, [enriched, seccionFiltro]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a: any, b: any) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalYearUsd = useMemo(() => {
    return enriched
      .filter((r) => new Date(r.fecha).getUTCFullYear() === anioActual)
      .reduce((s, r) => s + (usdVisual(r as any, mode) ?? 0), 0);
  }, [enriched, anioActual, mode]);

  const totalesPorSeccion = useMemo(() => {
    const m: Record<string, number> = {};
    enriched
      .filter((r) => new Date(r.fecha).getUTCFullYear() === anioActual)
      .forEach((r) => { m[r.seccion] = (m[r.seccion] || 0) + (usdVisual(r as any, mode) ?? 0); });
    return m;
  }, [enriched, anioActual, mode]);

  const chartData = useMemo(() => {
    const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const base: any[] = meses.map((m, i) => {
      const row: any = { mes: m, _i: i };
      SECCIONES.forEach((s) => { row[s.key] = 0; });
      return row;
    });
    enriched.forEach((r: any) => {
      const d = new Date(r.fecha);
      if (d.getUTCFullYear() !== anioActual) return;
      const idx = d.getUTCMonth();
      base[idx][r.seccion] = (base[idx][r.seccion] || 0) + (usdVisual(r, mode) ?? 0);
    });
    return base;
  }, [enriched, anioActual, mode]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("transacciones").delete().eq("id", deleting.id);
    if (error) return toast.error(error.message);
    await logAudit("transacciones", "DELETE", deleting.id, deleting, null);
    toast.success("Liquidación eliminada");
    setDeleting(null);
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Liquidaciones</h1>
          <p className="text-sm text-muted-foreground">Historial de liquidaciones de personal · {label}</p>
        </div>
        <UsdViewToggle />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total {anioActual} ({label})</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalYearUsd)}</div></CardContent>
        </Card>
        {SECCIONES.map((s) => (
          <Card key={s.key}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{s.key} ({label})</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xl font-bold mono" style={{ color: s.color }}>{fmtUsd(totalesPorSeccion[s.key] || 0)}</div>
              <div className="text-[10px] text-muted-foreground">cuenta {s.cuenta}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bar chart */}
      <Card>
        <CardHeader><CardTitle className="text-base">Liquidaciones por mes — {anioActual} (USD)</CardTitle></CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mes" />
              <YAxis />
              <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
              <Legend />
              {SECCIONES.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Centro de costo</Label>
            <Select value={seccionFiltro} onValueChange={setSeccionFiltro}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Todos">Todos</SelectItem>
                {SECCIONES.map((s) => <SelectItem key={s.key} value={s.key}>{s.key}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader><CardTitle className="text-base">Registros ({sorted.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                {([
                  ["fecha","Fecha"],
                  ["empleado","Empleado"],
                  ["seccion","Centro"],
                  ["cuenta_codigo","Cuenta"],
                  ["monto_bs","Monto Bs"],
                  ["tasa_paralela","Tasa paralela"],
                  ["monto_usd", `Monto ${label}`],
                  ["banco","Banco"],
                ] as [SortKey, string][]).map(([k, hdr]) => (
                  <th key={k} className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort(k)}>
                    {hdr} {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </th>
                ))}
                <th className="py-2 px-2">Notas</th>
                <th className="py-2 px-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">Sin registros</td></tr>
              )}
              {sorted.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-1.5 px-2 mono">{fmtDate(r.fecha)}</td>
                  <td className="py-1.5 px-2">{r.empleado || "—"}</td>
                  <td className="py-1.5 px-2">{r.seccion}</td>
                  <td className="py-1.5 px-2 mono">{r.cuenta_codigo}</td>
                  <td className="py-1.5 px-2 mono text-right">{fmtBs(Number(r.monto_bs))}</td>
                  <td className="py-1.5 px-2 mono text-right">{r.tasa_paralela ? Number(r.tasa_paralela).toFixed(4) : "—"}</td>
                  <td className="py-1.5 px-2 mono text-right font-semibold">{fmtUsd(usdVisual(r, mode) ?? 0)}</td>
                  <td className="py-1.5 px-2 text-xs">{r.banco_nombre}</td>
                  <td className="py-1.5 px-2 text-xs text-muted-foreground max-w-[220px] truncate" title={r.notas}>{r.notas}</td>
                  <td className="py-1.5 px-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Editar</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(r)}>Borrar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      {editing && (
        <EditDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries(); }} />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar liquidación?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará la transacción {deleting?.id?.slice(0,8)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditDialog({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const [fecha, setFecha] = useState<string>(row.fecha);
  const [empleado, setEmpleado] = useState<string>(empleadoFromRow(row));
  const [seccionKey, setSeccionKey] = useState<string>(seccionFromRow(row));
  const [montoBs, setMontoBs] = useState<string>(String(row.monto_bs ?? ""));
  const [tasa, setTasa] = useState<string>(String(row.tasa_paralela ?? row.tasa_bcv ?? ""));
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>(row.cuenta_bancaria_id ?? "");
  const [notas, setNotas] = useState<string>(row.notas ?? "");
  const [busy, setBusy] = useState(false);

  const seccionDef = SECCIONES.find((s) => s.key === seccionKey) ?? SECCIONES[1];
  const montoBsN = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0;
  const montoUsd = tasaN > 0 ? montoBsN / tasaN : 0;

  const save = async () => {
    if (!empleado.trim()) return toast.error("Falta empleado");
    if (!montoBsN || !tasaN) return toast.error("Monto y tasa requeridos");
    if (!cuentaBancariaId) return toast.error("Selecciona banco");
    setBusy(true);
    const detalle = `${seccionDef.key} · ${empleado.trim()}`;
    const update = {
      fecha,
      cuenta_codigo: seccionDef.cuenta,
      centro_costo: seccionDef.centro as any,
      monto_bs: montoBsN,
      monto_base_bs: montoBsN,
      tasa_bcv: tasaN,
      tasa_paralela: tasaN,
      monto_usd: +montoUsd.toFixed(2),
      cuenta_bancaria_id: cuentaBancariaId,
      detalle,
      notas,
    };
    const { error, data } = await supabase.from("transacciones").update(update as any).eq("id", row.id).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (data) await logAudit("transacciones", "UPDATE", row.id, row, data);
    setBusy(false);
    toast.success("Liquidación actualizada");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Editar liquidación</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div>
            <Label>Centro de costo</Label>
            <Select value={seccionKey} onValueChange={setSeccionKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SECCIONES.map((s) => <SelectItem key={s.key} value={s.key}>{s.key} (cuenta {s.cuenta})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><Label>Empleado</Label><Input value={empleado} onChange={(e) => setEmpleado(e.target.value)} /></div>
          <div><Label>Monto Bs</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} className="mono" /></div>
          <div><Label>Tasa paralela</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} className="mono" /></div>
          <div className="md:col-span-2">
            <Label>Monto USD</Label>
            <Input readOnly value={fmtUsd(montoUsd)} className="mono bg-muted" />
          </div>
          <div className="md:col-span-2">
            <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
          </div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
