import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { ArrowUpDown, AlertTriangle, Pencil, Trash2, X, Check } from "lucide-react";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView } from "@/lib/usd-view-context";

export const Route = createFileRoute("/_authenticated/anticipos-proveedores")({
  component: AnticiposProveedoresPage,
});

type Row = {
  id: string;
  fecha: string;
  tercero_id: string | null;
  proveedor: string;
  monto_bs: number;
  monto_usd: number; // USD paralelo (contable)
  monto_usd_bcv: number; // USD BCV (deuda congelada)
  aplicado_usd_bcv: number;
  tasa_bcv: number | null;
  tasa_paralela: number | null;
  anticipo_estado: "abierto" | "parcialmente_aplicado" | "aplicado" | null;
  anticipo_aplicado_usd: number;
  notas: string | null;
  grupo_transaccion_id: string | null;
  factura_vinculada: string | null;
};

type SortKey = "fecha" | "proveedor" | "monto_usd" | "saldo" | "estado";

function AnticiposProveedoresPage() {
  const { mode, label } = useUsdView();
  const qc = useQueryClient();
  const today = new Date();
  const defaultDesde = `${today.getFullYear()}-01-01`;
  const defaultHasta = today.toISOString().slice(0, 10);

  const [desde, setDesde] = useState(defaultDesde);
  const [hasta, setHasta] = useState(defaultHasta);
  const [filtroProv, setFiltroProv] = useState<string>("all");
  const [filtroEstado, setFiltroEstado] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editId, setEditId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<{ fecha: string; monto_bs: string; tasa_bcv: string; notas: string }>({
    fecha: "", monto_bs: "", tasa_bcv: "", notas: "",
  });

  const { data: anticipos, isLoading } = useQuery({
    queryKey: ["anticipos-proveedores-all", desde, hasta],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("transacciones")
        .select("id, fecha, tercero_id, monto_bs, monto_usd, anticipo_usd_bcv, anticipo_aplicado_usd_bcv, tasa_bcv, tasa_paralela, anticipo_estado, anticipo_aplicado_usd, notas, grupo_transaccion_id, terceros(razon_social)")
        .eq("cuenta_codigo", "14.2")
        .gt("monto_usd", 0)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      if (error) throw error;

      // Buscar facturas vinculadas por grupo_transaccion_id
      const grupos = Array.from(new Set((data ?? []).map((r: any) => r.grupo_transaccion_id).filter(Boolean)));
      let facturasMap = new Map<string, string>();
      if (grupos.length > 0) {
        const { data: facs } = await supabase
          .from("transacciones")
          .select("grupo_transaccion_id, numero_factura, cuenta_codigo")
          .in("grupo_transaccion_id", grupos)
          .neq("cuenta_codigo", "14.2")
          .not("numero_factura", "is", null);
        (facs ?? []).forEach((f: any) => {
          if (f.grupo_transaccion_id && f.numero_factura && !facturasMap.has(f.grupo_transaccion_id)) {
            facturasMap.set(f.grupo_transaccion_id, f.numero_factura);
          }
        });
      }

      return (data ?? []).map((r: any) => {
        const tasaBcv = r.tasa_bcv != null ? Number(r.tasa_bcv) : null;
        const usdBcv = r.anticipo_usd_bcv != null
          ? Number(r.anticipo_usd_bcv)
          : (tasaBcv ? +(Number(r.monto_bs) / tasaBcv).toFixed(2) : Number(r.monto_usd) || 0);
        const aplicadoBcv = r.anticipo_aplicado_usd_bcv != null
          ? Number(r.anticipo_aplicado_usd_bcv)
          : Number(r.anticipo_aplicado_usd) || 0;
        return {
          id: r.id,
          fecha: r.fecha,
          tercero_id: r.tercero_id,
          proveedor: r.terceros?.razon_social ?? "—",
          monto_bs: Number(r.monto_bs) || 0,
          monto_usd: Number(r.monto_usd) || 0,
          monto_usd_bcv: usdBcv,
          aplicado_usd_bcv: aplicadoBcv,
          tasa_bcv: tasaBcv,
          tasa_paralela: r.tasa_paralela != null ? Number(r.tasa_paralela) : null,
          anticipo_estado: r.anticipo_estado ?? "abierto",
          anticipo_aplicado_usd: Number(r.anticipo_aplicado_usd) || 0,
          notas: r.notas,
          grupo_transaccion_id: r.grupo_transaccion_id,
          factura_vinculada: r.grupo_transaccion_id ? facturasMap.get(r.grupo_transaccion_id) ?? null : null,
        };
      });
    },
  });

  const proveedores = useMemo(() => {
    const set = new Map<string, string>();
    (anticipos ?? []).forEach((a) => {
      if (a.tercero_id) set.set(a.tercero_id, a.proveedor);
    });
    return Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [anticipos]);

  const filtered = useMemo(() => {
    let rows = anticipos ?? [];
    if (filtroProv !== "all") rows = rows.filter((r) => r.tercero_id === filtroProv);
    if (filtroEstado !== "all") rows = rows.filter((r) => (r.anticipo_estado ?? "abierto") === filtroEstado);
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "fecha") cmp = a.fecha.localeCompare(b.fecha);
      else if (sortKey === "proveedor") cmp = a.proveedor.localeCompare(b.proveedor);
      else if (sortKey === "monto_usd") cmp = (mode === "bcv" ? a.monto_usd_bcv : a.monto_usd) - (mode === "bcv" ? b.monto_usd_bcv : b.monto_usd);
      else if (sortKey === "saldo") {
        const sa = (mode === "bcv" ? a.monto_usd_bcv - a.aplicado_usd_bcv : a.monto_usd - a.anticipo_aplicado_usd);
        const sb = (mode === "bcv" ? b.monto_usd_bcv - b.aplicado_usd_bcv : b.monto_usd - b.anticipo_aplicado_usd);
        cmp = sa - sb;
      }
      else if (sortKey === "estado") cmp = (a.anticipo_estado ?? "").localeCompare(b.anticipo_estado ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [anticipos, filtroProv, filtroEstado, sortKey, sortDir, mode]);

  const primaryUsd = (r: Row) => (mode === "bcv" ? r.monto_usd_bcv : r.monto_usd);
  const primaryAplicado = (r: Row) => (mode === "bcv" ? r.aplicado_usd_bcv : r.anticipo_aplicado_usd);
  const primarySaldo = (r: Row) => +(primaryUsd(r) - primaryAplicado(r)).toFixed(2);

  const kpis = useMemo(() => {
    const rows = anticipos ?? [];
    const total = rows.reduce((s, r) => s + primaryUsd(r), 0);
    const aplicado = rows.reduce((s, r) => s + primaryAplicado(r), 0);
    const saldo = total - aplicado;
    return { total, aplicado, saldo };
  }, [anticipos, mode]);

  const diasAbierto = (fecha: string) => {
    const d = new Date(fecha);
    return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  };

  const alertaVencidos = (anticipos ?? []).filter(
    (a) => (a.anticipo_estado ?? "abierto") !== "aplicado" && diasAbierto(a.fecha) > 30
  ).length;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const startEdit = (r: Row) => {
    setEditId(r.id);
    setEditVals({
      fecha: r.fecha,
      monto_bs: String(r.monto_bs),
      tasa_bcv: r.tasa_bcv != null ? String(r.tasa_bcv) : "",
      notas: r.notas ?? "",
    });
  };

  const cancelEdit = () => { setEditId(null); };

  const saveEdit = async (r: Row) => {
    const mBs = Number(editVals.monto_bs) || 0;
    const tasa = Number(editVals.tasa_bcv) || 0;
    if (!mBs || !tasa) return toast.error("Monto Bs y tasa BCV requeridos");
    const tasaPar = r.tasa_paralela ?? null;
    const mUsdBcv = +(mBs / tasa).toFixed(2);
    const mUsdPar = tasaPar ? +(mBs / tasaPar).toFixed(2) : mUsdBcv;
    const { error } = await supabase
      .from("transacciones")
      .update({
        fecha: editVals.fecha,
        monto_bs: mBs,
        monto_base_bs: mBs,
        tasa_bcv: tasa,
        monto_usd: mUsdPar,
        anticipo_usd_bcv: mUsdBcv,
        notas: editVals.notas || null,
      } as any)
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Anticipo actualizado");
    setEditId(null);
    qc.invalidateQueries({ queryKey: ["anticipos-proveedores-all"] });
    qc.invalidateQueries({ queryKey: ["anticipos-abiertos"] });
  };

  const deleteRow = async (r: Row) => {
    const { error } = await supabase.from("transacciones").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Anticipo eliminado");
    qc.invalidateQueries({ queryKey: ["anticipos-proveedores-all"] });
    qc.invalidateQueries({ queryKey: ["anticipos-abiertos"] });
  };

  const estadoBadge = (e: Row["anticipo_estado"]) => {
    if (e === "aplicado") return <Badge variant="secondary">aplicado</Badge>;
    if (e === "parcialmente_aplicado") return <Badge className="bg-amber-500 hover:bg-amber-500">parcial</Badge>;
    return <Badge variant="outline">abierto</Badge>;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Anticipos a proveedores (14.2)</h1>
          <p className="text-xs text-muted-foreground">Detalles contables — anticipos emitidos a proveedores y su aplicación.</p>
        </div>
        <div className="flex items-center gap-2">
          {alertaVencidos > 0 && (
            <Badge className="bg-destructive hover:bg-destructive flex gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {alertaVencidos} anticipo(s) abiertos &gt; 30 días
            </Badge>
          )}
          <UsdViewToggle />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total anticipado</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold mono">{fmtUsd(kpis.total)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total aplicado</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold mono text-green-700">{fmtUsd(kpis.aplicado)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Saldo pendiente</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold mono text-amber-700">{fmtUsd(kpis.saldo)}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div>
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Proveedor</Label>
              <Select value={filtroProv} onValueChange={setFiltroProv}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {proveedores.map(([id, nombre]) => (
                    <SelectItem key={id} value={id}>{nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Estado</Label>
              <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="abierto">Abierto</SelectItem>
                  <SelectItem value="parcialmente_aplicado">Parcialmente aplicado</SelectItem>
                  <SelectItem value="aplicado">Aplicado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Cargando…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No hay anticipos para los filtros seleccionados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b">
                  <tr className="text-left text-muted-foreground">
                    <SortableTh label="Fecha" k="fecha" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Proveedor" k="proveedor" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <th className="py-2 px-2 text-right">Monto Bs</th>
                    <th className="py-2 px-2 text-right">Tasa BCV</th>
                    <SortableTh label={`${label} (deuda)`} k="monto_usd" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                    <th className="py-2 px-2 text-right text-muted-foreground">{mode === "bcv" ? "USD paralelo" : "USD BCV"}</th>
                    <SortableTh label="Estado" k="estado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <th className="py-2 px-2">Factura</th>
                    <SortableTh label={`Saldo ${label}`} k="saldo" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                    <th className="py-2 px-2">Notas</th>
                    <th className="py-2 px-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const saldo = primarySaldo(r);
                    const primary = primaryUsd(r);
                    const alt = mode === "bcv" ? r.monto_usd : r.monto_usd_bcv;
                    const dias = diasAbierto(r.fecha);
                    const isEditing = editId === r.id;
                    const puedeEditar = (r.anticipo_estado ?? "abierto") === "abierto";
                    return (
                      <tr key={r.id} className="border-b hover:bg-muted/30">
                        <td className="py-1.5 px-2 mono">
                          {isEditing ? (
                            <Input type="date" className="h-7 text-xs" value={editVals.fecha} onChange={(e) => setEditVals({ ...editVals, fecha: e.target.value })} />
                          ) : (
                            <div className="flex items-center gap-1">
                              {fmtDate(r.fecha)}
                              {(r.anticipo_estado ?? "abierto") !== "aplicado" && dias > 30 && (
                                <AlertTriangle className="h-3 w-3 text-destructive" />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-2">{r.proveedor}</td>
                        <td className="py-1.5 px-2 mono text-right">
                          {isEditing ? (
                            <Input type="number" step="0.01" className="h-7 text-xs text-right mono" value={editVals.monto_bs} onChange={(e) => setEditVals({ ...editVals, monto_bs: e.target.value })} />
                          ) : fmtBs(r.monto_bs)}
                        </td>
                        <td className="py-1.5 px-2 mono text-right">
                          {isEditing ? (
                            <Input type="number" step="0.0001" className="h-7 text-xs text-right mono" value={editVals.tasa_bcv} onChange={(e) => setEditVals({ ...editVals, tasa_bcv: e.target.value })} />
                          ) : (r.tasa_bcv != null ? r.tasa_bcv.toFixed(2) : "—")}
                        </td>
                        <td className="py-1.5 px-2 mono text-right">{fmtUsd(primary)}</td>
                        <td className="py-1.5 px-2 mono text-right text-muted-foreground">{fmtUsd(alt)}</td>
                        <td className="py-1.5 px-2">{estadoBadge(r.anticipo_estado)}</td>
                        <td className="py-1.5 px-2 mono">{r.factura_vinculada ?? "—"}</td>
                        <td className="py-1.5 px-2 mono text-right">{fmtUsd(saldo)}</td>
                        <td className="py-1.5 px-2 max-w-[200px]">
                          {isEditing ? (
                            <Input className="h-7 text-xs" value={editVals.notas} onChange={(e) => setEditVals({ ...editVals, notas: e.target.value })} />
                          ) : (
                            <span className="truncate block text-muted-foreground" title={r.notas ?? ""}>{r.notas ?? "—"}</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(r)} title="Guardar">
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit} title="Cancelar">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)} disabled={!puedeEditar} title={puedeEditar ? "Editar" : "Sólo abiertos editables"}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!puedeEditar} title={puedeEditar ? "Eliminar" : "Sólo abiertos eliminables"}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>¿Eliminar anticipo?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Se eliminará el anticipo a <strong>{r.proveedor}</strong> por <strong className="mono">{fmtUsd(r.monto_usd)}</strong> del {fmtDate(r.fecha)}. Esta acción no se puede deshacer.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteRow(r)}>Eliminar</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableTh({ label, k, sortKey, sortDir, onClick, align }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`py-2 px-2 ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onClick(k)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "text-foreground" : "opacity-40"}`} />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
