import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/activos-transitorios")({
  component: ActivosTransitoriosPage,
});

type TabKey = "prestamos" | "anticipos_nomina" | "prestaciones";

const TAB_CONFIG: Record<TabKey, { label: string; cuenta: string; hasRecovery: boolean; recoveryLabel: string }> = {
  prestamos:         { label: "Préstamos al personal",      cuenta: "14.1", hasRecovery: true,  recoveryLabel: "Total recuperado" },
  anticipos_nomina:  { label: "Anticipos de nómina",        cuenta: "14.3", hasRecovery: true,  recoveryLabel: "Total aplicado" },
  prestaciones:      { label: "Anticipos de prestaciones",  cuenta: "3.22", hasRecovery: false, recoveryLabel: "" },
};

function parseDetalle(d: string | null): { cco: string; empleado: string } {
  const parts = String(d || "").split("·").map((x) => x.trim());
  return { cco: parts[0] || "—", empleado: parts.slice(1).join(" · ") || "" };
}

function ActivosTransitoriosPage() {
  const [tab, setTab] = useState<TabKey>("prestamos");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activos transitorios</h1>
        <p className="text-sm text-muted-foreground">Préstamos y anticipos al personal</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto gap-1 p-1">
          <TabsTrigger value="prestamos" className="text-xs sm:text-sm">Préstamos al personal</TabsTrigger>
          <TabsTrigger value="anticipos_nomina" className="text-xs sm:text-sm">Anticipos de nómina</TabsTrigger>
          <TabsTrigger value="prestaciones" className="text-xs sm:text-sm">Anticipos de prestaciones</TabsTrigger>
          <TabsTrigger value="anticipos_proveedores" className="text-xs sm:text-sm">Anticipos a proveedores</TabsTrigger>
        </TabsList>
        <TabsContent value="prestamos"><TabBody tabKey="prestamos" /></TabsContent>
        <TabsContent value="anticipos_nomina"><TabBody tabKey="anticipos_nomina" /></TabsContent>
        <TabsContent value="prestaciones"><TabBody tabKey="prestaciones" /></TabsContent>
        <TabsContent value="anticipos_proveedores"><ProveedoresTabBody /></TabsContent>
      </Tabs>
    </div>
  );
}

function TabBody({ tabKey }: { tabKey: TabKey }) {
  const cfg = TAB_CONFIG[tabKey];
  const qc = useQueryClient();
  const anio = new Date().getFullYear();
  const [empFiltro, setEmpFiltro] = useState("");
  const [desde, setDesde] = useState<string>(`${anio}-01-01`);
  const [hasta, setHasta] = useState<string>(`${anio}-12-31`);
  const [sortKey, setSortKey] = useState<string>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["act-trans-rows", cfg.cuenta, desde, hasta],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, centro_costo, cuenta_codigo, monto_bs, monto_usd, tasa_paralela, tasa_bcv, detalle, notas, cuenta_bancaria_id, metodo_pago")
        .eq("cuenta_codigo", cfg.cuenta)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      return data ?? [];
    },
  });
  const { data: bancos } = useCuentasBancarias();
  const bancoName = (id: string | null) => {
    if (!id) return "—";
    const b = (bancos ?? []).find((x: any) => x.id === id);
    if (!b) return "—";
    const last4 = (b.numero || "").slice(-4);
    return `${b.nombre} ****${last4}`;
  };

  const enriched = useMemo(() => (rows ?? []).map((r: any) => {
    const { cco, empleado } = parseDetalle(r.detalle);
    const monto = Number(r.monto_usd || 0);
    return {
      ...r,
      cco,
      empleado,
      banco: bancoName(r.cuenta_bancaria_id),
      tipoMov: monto >= 0 ? "Salida" : "Entrada",
      ageDays: Math.floor((Date.now() - new Date(r.fecha).getTime()) / (1000 * 60 * 60 * 24)),
    };
  }), [rows, bancos]);

  // Saldos por empleado (para flag 30 días)
  const saldosEmp = useMemo(() => {
    const m = new Map<string, { saldo: number; oldestOpen: number | null }>();
    enriched.forEach((r) => {
      if (!r.empleado) return;
      const cur = m.get(r.empleado) ?? { saldo: 0, oldestOpen: null };
      cur.saldo += Number(r.monto_usd || 0);
      if (Number(r.monto_usd || 0) > 0) {
        cur.oldestOpen = cur.oldestOpen === null ? r.ageDays : Math.max(cur.oldestOpen, r.ageDays);
      }
      m.set(r.empleado, cur);
    });
    return m;
  }, [enriched]);

  const filtered = useMemo(() => enriched.filter((r) => !empFiltro || r.empleado.toLowerCase().includes(empFiltro.toLowerCase())), [enriched, empFiltro]);

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

  const totalSalidas = useMemo(() => enriched.filter((r) => Number(r.monto_usd) > 0).reduce((s, r) => s + Number(r.monto_usd || 0), 0), [enriched]);
  const totalEntradas = useMemo(() => enriched.filter((r) => Number(r.monto_usd) < 0).reduce((s, r) => s + Math.abs(Number(r.monto_usd || 0)), 0), [enriched]);
  const saldoPendiente = totalSalidas - totalEntradas;
  const algunVencido = useMemo(() => Array.from(saldosEmp.values()).some((v) => v.saldo > 0.01 && (v.oldestOpen ?? 0) > 30), [saldosEmp]);

  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("transacciones").delete().eq("id", deleting.id);
    if (error) return toast.error(error.message);
    await logAudit("transacciones", "DELETE", deleting.id, deleting, null);
    toast.success("Registro eliminado");
    setDeleting(null);
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-6 mt-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total dado (USD)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalSalidas)}</div></CardContent>
        </Card>
        {cfg.hasRecovery && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{cfg.recoveryLabel} (USD)</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalEntradas)}</div></CardContent>
          </Card>
        )}
        {cfg.hasRecovery ? (
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs text-muted-foreground">Saldo pendiente (USD)</CardTitle>
              {algunVencido && <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-50">&gt; 30 días</Badge>}
            </CardHeader>
            <CardContent><div className="text-2xl font-bold mono">{fmtUsd(saldoPendiente)}</div></CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Empleados beneficiados</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold mono">{saldosEmp.size}</div></CardContent>
          </Card>
        )}
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Empleado</Label><Input value={empFiltro} onChange={(e) => setEmpFiltro(e.target.value)} placeholder="Buscar…" /></div>
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
                  ["fecha", "Fecha"],
                  ["empleado", "Empleado"],
                  ["cco", "Centro"],
                  ["monto_bs", "Monto Bs"],
                  ["tasa_paralela", "Tasa"],
                  ["monto_usd", "Monto USD"],
                  ["tipoMov", "Tipo"],
                  ["banco", "Banco"],
                ] as [string, string][]).map(([k, label]) => (
                  <th key={k} className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort(k)}>
                    {label} {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </th>
                ))}
                <th className="py-2 px-2">Notas</th>
                <th className="py-2 px-2">Estado</th>
                <th className="py-2 px-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={11} className="py-6 text-center text-muted-foreground">Sin registros</td></tr>
              )}
              {sorted.map((r: any) => {
                const empSaldo = saldosEmp.get(r.empleado);
                const flagOpen = cfg.hasRecovery && (empSaldo?.saldo ?? 0) > 0.01 && r.tipoMov === "Salida" && r.ageDays > 30;
                const tasaShown = Number(r.tasa_paralela) || Number(r.tasa_bcv) || 0;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-1.5 px-2 mono">{fmtDate(r.fecha)}</td>
                    <td className="py-1.5 px-2">{r.empleado || "—"}</td>
                    <td className="py-1.5 px-2">{r.cco}</td>
                    <td className="py-1.5 px-2 mono text-right">{fmtBs(Number(r.monto_bs))}</td>
                    <td className="py-1.5 px-2 mono text-right">{tasaShown ? tasaShown.toFixed(4) : "—"}</td>
                    <td className="py-1.5 px-2 mono text-right font-semibold">{fmtUsd(Number(r.monto_usd))}</td>
                    <td className="py-1.5 px-2">
                      <span className={r.tipoMov === "Entrada" ? "text-green-700" : "text-foreground"}>{r.tipoMov}</span>
                    </td>
                    <td className="py-1.5 px-2 text-xs">{r.banco}</td>
                    <td className="py-1.5 px-2 text-xs text-muted-foreground max-w-[220px] truncate" title={r.notas}>{r.notas}</td>
                    <td className="py-1.5 px-2">
                      {flagOpen
                        ? <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-50">+{r.ageDays}d</Badge>
                        : <span className="text-xs text-muted-foreground">{r.ageDays}d</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Editar</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(r)}>Borrar</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editing && <EditDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries(); }} />}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar registro?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
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

const CCO_OPTS = ["YV", "Bocú", "Administración", "Cocina"] as const;
const CCO_TO_CENTRO: Record<string, string> = { "YV": "YV", "Bocú": "Bocu", "Administración": "Compartido", "Cocina": "Compartido" };

function EditDialog({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const parsed = parseDetalle(row.detalle);
  const [fecha, setFecha] = useState<string>(row.fecha);
  const [empleado, setEmpleado] = useState<string>(parsed.empleado);
  const [cco, setCco] = useState<string>(CCO_OPTS.includes(parsed.cco as any) ? parsed.cco : "Bocú");
  const [montoBs, setMontoBs] = useState<string>(String(Math.abs(Number(row.monto_bs ?? 0))));
  const [tasa, setTasa] = useState<string>(String(row.tasa_paralela ?? row.tasa_bcv ?? ""));
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>(row.cuenta_bancaria_id ?? "");
  const [notas, setNotas] = useState<string>(row.notas ?? "");
  const [busy, setBusy] = useState(false);

  const esEntrada = Number(row.monto_usd) < 0;
  const signo = esEntrada ? -1 : 1;
  const montoBsN = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0;
  const montoUsd = tasaN > 0 ? montoBsN / tasaN : 0;

  const save = async () => {
    if (!empleado.trim() || !montoBsN || !tasaN) return toast.error("Completa los campos");
    setBusy(true);
    const update = {
      fecha,
      centro_costo: CCO_TO_CENTRO[cco] as any,
      monto_bs: signo * montoBsN,
      monto_base_bs: signo * montoBsN,
      tasa_bcv: tasaN,
      tasa_paralela: row.tasa_paralela ? tasaN : null,
      monto_usd: +(signo * montoUsd).toFixed(2),
      cuenta_bancaria_id: cuentaBancariaId || null,
      detalle: `${cco} · ${empleado.trim()}`,
      notas,
    };
    const { error, data } = await supabase.from("transacciones").update(update as any).eq("id", row.id).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (data) await logAudit("transacciones", "UPDATE", row.id, row, data);
    setBusy(false);
    toast.success("Registro actualizado");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Editar registro</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div>
            <Label>Centro de costo</Label>
            <Select value={cco} onValueChange={setCco}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CCO_OPTS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><Label>Empleado</Label><Input value={empleado} onChange={(e) => setEmpleado(e.target.value)} /></div>
          <div><Label>Monto Bs (positivo)</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} className="mono" /></div>
          <div><Label>Tasa</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} className="mono" /></div>
          <div className="md:col-span-2">
            <Label>Monto USD</Label>
            <Input readOnly value={`${esEntrada ? "-" : ""}${fmtUsd(montoUsd).replace("$", "$")}`} className="mono bg-muted" />
          </div>
          <div className="md:col-span-2">
            <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
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
