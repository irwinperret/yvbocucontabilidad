import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

import { Pencil, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { DeleteButton } from "@/components/delete-button";
import { logAudit, isPeriodClosed } from "@/lib/audit";
import { CENTROS, METODOS, CAPEX_CATEGORIAS, type Centro } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";
import { AdjuntoCell } from "@/components/adjunto-cell";
import { fetchAllRows } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/transacciones")({
  component: TransaccionesPage,
});

function TransaccionesPage() {
  const qc = useQueryClient();
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState(todayISO());

  const { data: minFecha, isSuccess: minFechaReady } = useQuery({
    queryKey: ["transacciones-min-fecha"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("fecha")
        .order("fecha", { ascending: true })
        .limit(1)
        .maybeSingle();
      return (data as any)?.fecha ?? null;
    },
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!minFechaReady || desde) return;
    if (minFecha) setDesde(minFecha);
    else {
      const d = new Date(); d.setDate(d.getDate() - 30);
      setDesde(d.toISOString().slice(0, 10));
    }
  }, [minFechaReady, minFecha, desde]);
  const [centro, setCentro] = useState<string>("todos");
  const [cuentaFiltro, setCuentaFiltro] = useState<string>("todos");
  const [metodoFiltro, setMetodoFiltro] = useState<string>("todos");
  const [modoFiltro, setModoFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [sortKey, setSortKey] = useState<"fecha" | "monto_bs" | "monto_usd">("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editing, setEditing] = useState<any>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipePwd, setWipePwd] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 50;

  useEffect(() => { setPage(0); setSelected(new Set()); }, [desde, hasta, centro, cuentaFiltro, metodoFiltro, modoFiltro, busca, sortKey, sortDir]);

  const toggleSort = (k: "fecha" | "monto_bs" | "monto_usd") => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "fecha" ? "desc" : "desc"); }
  };
  const sortArrow = (k: string) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const { data, isLoading } = useQuery({
    enabled: !!desde,
    queryKey: ["transacciones-list", desde, hasta, centro],
    queryFn: async () => {
      return await fetchAllRows<any>(async (from, to) => {
        let q = supabase
          .from("transacciones")
          .select("id,fecha,centro_costo,cuenta_codigo,numero_factura,numero_orden,referencia,monto_bs,monto_base_bs,iva_bs,iva_aplica,tasa_bcv,tasa_paralela,monto_usd,metodo_pago,modo,notas,detalle,adjunto_url,created_by,cuenta_bancaria_id,capex_categoria,pareja_off_balance_id")
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to);
        if (centro !== "todos") q = q.eq("centro_costo", centro as any);
        return await q;
      });
    },
  });


  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-all-list"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre").order("orden");
      return data ?? [];
    },
  });

  const cuentaNombre = useMemo(() => {
    const m: Record<string, string> = {};
    (cuentas ?? []).forEach((c: any) => { m[c.codigo] = c.nombre; });
    return m;
  }, [cuentas]);

  const { data: profiles } = useQuery({
    queryKey: ["profiles-emails"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,email");
      return data ?? [];
    },
  });

  const emailById = useMemo(() => {
    const m: Record<string, string> = {};
    (profiles ?? []).forEach((p: any) => { m[p.id] = p.email; });
    return m;
  }, [profiles]);


  const cuentasEnData = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((t: any) => t.cuenta_codigo && set.add(t.cuenta_codigo));
    return Array.from(set).sort();
  }, [data]);
  const metodosEnData = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((t: any) => t.metodo_pago && set.add(t.metodo_pago));
    return Array.from(set).sort();
  }, [data]);

  const filtradas = useMemo(() => {
    const s = busca.trim().toLowerCase();
    let arr = ((data ?? []) as any[]).filter((t: any) => {
      if (cuentaFiltro !== "todos" && t.cuenta_codigo !== cuentaFiltro) return false;
      if (metodoFiltro !== "todos" && (t.metodo_pago ?? "") !== metodoFiltro) return false;
      if (modoFiltro !== "todos" && t.modo !== modoFiltro) return false;
      if (s) {
        const hit =
          t.cuenta_codigo?.toLowerCase().includes(s) ||
          cuentaNombre[t.cuenta_codigo]?.toLowerCase().includes(s) ||
          t.numero_factura?.toLowerCase().includes(s) ||
          (t.numero_orden ?? "").toLowerCase().includes(s) ||
          t.referencia?.toLowerCase().includes(s) ||
          t.notas?.toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
    arr = [...arr].sort((a: any, b: any) => {
      const av = sortKey === "fecha" ? a.fecha : Number(a[sortKey]) || 0;
      const bv = sortKey === "fecha" ? b.fecha : Number(b[sortKey]) || 0;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [data, busca, cuentaNombre, cuentaFiltro, metodoFiltro, modoFiltro, sortKey, sortDir]);

  const totales = useMemo(() => {
    // Excluye legs IVA (12.4 y 12.5) para no doble-contar
    const noIva = filtradas.filter((t: any) => t.cuenta_codigo !== "12.4" && t.cuenta_codigo !== "12.5");
    return {
      bs: noIva.reduce((s: number, t: any) => s + (Number(t.monto_bs) || 0), 0),
      usd: noIva.reduce((s: number, t: any) => s + (Number(t.monto_usd) || 0), 0),
      ivaBs: filtradas.filter((t: any) => t.cuenta_codigo === "12.4" || t.cuenta_codigo === "12.5")
        .reduce((s: number, t: any) => s + (Number(t.monto_bs) || 0), 0),
    };
  }, [filtradas]);

  const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const paginadas = useMemo(
    () => filtradas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtradas, page]
  );

  const toggleSel = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelAllPage = (v: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      paginadas.forEach((t: any) => { v ? n.add(t.id) : n.delete(t.id); });
      return n;
    });

  const borrarSeleccionadas = async () => {
    if (!selected.size) return;
    if (!confirm(`¿Borrar ${selected.size} transacciones seleccionadas? Esta acción es irreversible.`)) return;
    const ids = Array.from(selected);
    const seleccionadas = filtradas.filter((t: any) => selected.has(t.id));
    // Validar mes cerrado
    for (const t of seleccionadas) {
      if (await isPeriodClosed(t.fecha)) {
        return toast.error(`No se puede borrar: hay transacciones en meses cerrados (ej. ${t.fecha}).`);
      }
    }
    // Romper FKs de parejas off-balance
    await supabase.from("transacciones").update({ pareja_off_balance_id: null } as any).in("id", ids);
    const { error } = await supabase.from("transacciones").delete().in("id", ids);
    if (error) return toast.error(error.message);
    for (const id of ids) await logAudit("transacciones", "DELETE", id, null, null);
    toast.success(`${ids.length} transacciones eliminadas`);
    setSelected(new Set());
    qc.invalidateQueries();
  };


  const eliminar = async (t: any) => {
    if (await isPeriodClosed(t.fecha)) {
      toast.error("Este mes ya está cerrado, así que no puedes borrar esta transacción todavía.", {
        description: "Si necesitas corregirla, ve a Registrar → pestaña «COGS e Inventario» y reabre el mes. Luego podrás editarla o eliminarla y volver a cerrarlo.",
        duration: 8000,
      });
      throw new Error("blocked");
    }
    const ids: string[] = [t.id];
    // Si la transacción tiene pareja off-balance, borramos también la otra
    if (t.pareja_off_balance_id) {
      const { data: pareja } = await supabase
        .from("transacciones")
        .select("id, fecha")
        .eq("id", t.pareja_off_balance_id)
        .maybeSingle();
      if (pareja) {
        if (await isPeriodClosed(pareja.fecha)) {
          toast.error("La transacción enlazada está en un mes cerrado — no se puede eliminar el par.");
          throw new Error("blocked");
        }
        ids.push(pareja.id);
        // Romper el FK self-reference antes de borrar para no bloquearnos
        await supabase.from("transacciones").update({ pareja_off_balance_id: null } as any).in("id", ids);
      }
    }
    const { error } = await supabase.from("transacciones").delete().in("id", ids);
    if (error) { toast.error(error.message); throw error; }
    for (const id of ids) await logAudit("transacciones", "DELETE", id, id === t.id ? t : null, null);
    toast.success(ids.length > 1 ? "Par off-balance eliminado (2 movimientos)" : "Movimiento eliminado");
    qc.invalidateQueries();
  };


  const exportar = async () => {
    if (!filtradas.length) return toast.error("No hay movimientos para exportar");
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Yvbocu Contabilidad";
      wb.created = new Date();
      const ws = wb.addWorksheet("Transacciones");
      ws.columns = [
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Centro", key: "centro", width: 10 },
        { header: "Código", key: "codigo", width: 10 },
        { header: "Cuenta", key: "cuenta", width: 36 },
        { header: "N° Factura", key: "factura", width: 14 },
        { header: "N° Orden", key: "orden", width: 14 },
        { header: "Referencia", key: "referencia", width: 18 },
        { header: "Monto Bs", key: "bs", width: 16 },
        { header: "Base Bs", key: "base", width: 16 },
        { header: "IVA Bs", key: "iva", width: 14 },
        { header: "Tasa BCV", key: "tasa", width: 12 },
        { header: "Monto USD", key: "usd", width: 14 },
        { header: "Método", key: "metodo", width: 14 },
        { header: "Modo", key: "modo", width: 12 },
        { header: "Notas", key: "notas", width: 40 },
      ];
      const header = ws.getRow(1);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };

      for (const t of filtradas as any[]) {
        const r = ws.addRow({
          fecha: t.fecha,
          centro: t.centro_costo,
          codigo: t.cuenta_codigo,
          cuenta: cuentaNombre[t.cuenta_codigo] ?? "",
          factura: t.numero_factura ?? "",
          orden: t.numero_orden ?? "",
          referencia: t.referencia ?? "",
          bs: Number(t.monto_bs) || 0,
          base: Number(t.monto_base_bs) || 0,
          iva: Number(t.iva_bs) || 0,
          tasa: Number(t.tasa_bcv) || 0,
          usd: Number(t.monto_usd) || 0,
          metodo: t.metodo_pago ?? "",
          modo: t.modo,
          notas: t.notas ?? "",
        });
        ["bs", "base", "iva"].forEach((k) => { r.getCell(k as any).numFmt = '#,##0.00'; });
        r.getCell("tasa" as any).numFmt = '#,##0.0000';
        r.getCell("usd" as any).numFmt = '"$"#,##0.00';
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transacciones_${desde}_a_${hasta}${centro !== "todos" ? `_${centro}` : ""}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exportadas ${filtradas.length} transacciones`);
    } finally {
      setExporting(false);
    }
  };

  const borrarTodo = async () => {
    if (wipePwd !== "12345678") return toast.error("Contraseña incorrecta");
    setWipeBusy(true);
    try {
      // Borrar dependencias primero (cuentas por cobrar/pagar referencian transacciones)
      await supabase.from("cuentas_por_cobrar").delete().not("id", "is", null);
      await supabase.from("cuentas_por_pagar").delete().not("id", "is", null);
      const { error, count } = await supabase
        .from("transacciones")
        .delete({ count: "exact" })
        .not("id", "is", null);
      if (error) { toast.error(error.message); return; }
      await logAudit("transacciones", "DELETE", "ALL" as any, { borradas: count ?? 0 }, null);
      toast.success(`Se borraron ${count ?? 0} transacciones`);
      setWipeOpen(false);
      setWipePwd("");
      qc.invalidateQueries();
    } finally {
      setWipeBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transacciones</h1>
        <p className="text-sm text-muted-foreground">Lista de movimientos registrados — editar o eliminar</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div><Label>Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
            <div>
              <Label>Centro</Label>
              <Select value={centro} onValueChange={setCentro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cuenta</Label>
              <Select value={cuentaFiltro} onValueChange={setCuentaFiltro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  {cuentasEnData.map((c) => (
                    <SelectItem key={c} value={c}>{c} — {cuentaNombre[c] ?? ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Método</Label>
              <Select value={metodoFiltro} onValueChange={setMetodoFiltro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {metodosEnData.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modo</Label>
              <Select value={modoFiltro} onValueChange={setModoFiltro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="on_balance">On-balance</SelectItem>
                  <SelectItem value="off_balance">Off-balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 md:col-span-6">
              <Label>Buscar</Label>
              <Input placeholder="cuenta, factura, referencia, notas…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </div>
          {(cuentaFiltro !== "todos" || metodoFiltro !== "todos" || modoFiltro !== "todos" || centro !== "todos") && (
            <div className="mt-3 flex flex-wrap gap-3 text-sm rounded-md bg-muted/40 p-2 border">
              <span className="text-xs text-muted-foreground self-center">Totales del filtro (sin IVA):</span>
              <span className="mono font-semibold">{fmtBs(totales.bs)}</span>
              <span className="mono font-semibold">{fmtUsd(totales.usd)}</span>
              {totales.ivaBs > 0 && (
                <span className="mono text-xs text-muted-foreground self-center">+ IVA legs {fmtBs(totales.ivaBs)}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {isLoading ? "Cargando…" : `${filtradas.length} movimientos`}
              {filtradas.length > PAGE_SIZE && <span className="text-xs text-muted-foreground font-normal ml-2">· página {page + 1} de {totalPages}</span>}
            </CardTitle>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <Button variant="destructive" size="sm" onClick={borrarSeleccionadas}>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Borrar {selected.size} seleccionadas
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportar} disabled={exporting || filtradas.length === 0}>
                <Download className="h-4 w-4 mr-1.5" />
                {exporting ? "Exportando…" : "Exportar a Excel"}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setWipeOpen(true)}>
                <Trash2 className="h-4 w-4 mr-1.5" />
                Borrar todo
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos en este rango.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 px-2 w-8">
                      <Checkbox
                        checked={paginadas.length > 0 && paginadas.every((t: any) => selected.has(t.id))}
                        onCheckedChange={(v) => toggleSelAllPage(Boolean(v))}
                      />
                    </th>
                    <th className="text-left py-2 px-2">
                      <button type="button" onClick={() => toggleSort("fecha")} className="hover:text-foreground">Fecha{sortArrow("fecha")}</button>
                    </th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-left py-2 px-2">Cuenta</th>
                    <th className="text-left py-2 px-2">Factura</th>
                    <th className="text-left py-2 px-2">N° Orden</th>
                    <th className="text-right py-2 px-2">
                      <button type="button" onClick={() => toggleSort("monto_bs")} className="hover:text-foreground">Bs{sortArrow("monto_bs")}</button>
                    </th>
                    <th className="text-right py-2 px-2">
                      <button type="button" onClick={() => toggleSort("monto_usd")} className="hover:text-foreground">USD{sortArrow("monto_usd")}</button>
                    </th>
                    <th className="text-left py-2 px-2">Método</th>
                    <th className="text-left py-2 px-2">Modo</th>
                    <th className="text-center py-2 px-2">Factura</th>
                    <th className="text-left py-2 px-2">Registrado por</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginadas.map((t: any) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2">
                        <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSel(t.id)} />
                      </td>
                      <td className="py-2 px-2 mono whitespace-nowrap">{fmtDate(t.fecha)}</td>
                      <td className="py-2 px-2">{t.centro_costo}</td>
                      <td className="py-2 px-2">
                        <div className="mono text-xs">{t.cuenta_codigo}</div>
                        <div className="text-xs text-muted-foreground">{cuentaNombre[t.cuenta_codigo] ?? ""}</div>
                      </td>
                      <td className="py-2 px-2 mono text-xs">{t.numero_factura ?? "—"}</td>
                      <td className="py-2 px-2 mono text-xs">{t.numero_orden ?? "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(t.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(t.monto_usd)}</td>
                      <td className="py-2 px-2 text-xs">{t.metodo_pago ?? "—"}</td>
                      <td className="py-2 px-2">
                        {t.modo === "off_balance"
                          ? <Badge variant="outline" className="text-[10px]">off</Badge>
                          : <Badge className="text-[10px]">on</Badge>}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <AdjuntoCell
                          transaccionId={t.id}
                          adjuntoPath={t.adjunto_url ?? null}
                          canDelete={true}
                          onChange={(p) => {
                            t.adjunto_url = p;
                            qc.invalidateQueries({ queryKey: ["transacciones-list"] });
                          }}
                        />
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{emailById[t.created_by] ?? "—"}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditing(t)}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <DeleteButton
                            fecha={t.fecha}
                            detail={`${fmtDate(t.fecha)} · ${t.cuenta_codigo} · ${fmtBs(t.monto_bs)}`}
                            warnings={t.pareja_off_balance_id ? ["Esta transacción está enlazada a otro movimiento off-balance (venta ↔ bono). Si confirmas, se eliminarán las DOS transacciones."] : []}
                            onConfirm={() => eliminar(t)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtradas.length)} de {filtradas.length}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => setPage(0)} disabled={page === 0}>«</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>‹</Button>
                    <span className="text-xs mx-2">Pág. {page + 1} / {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>›</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>


      {editing && (
        <EditDialog
          tx={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries(); }}
        />
      )}

      <Dialog open={wipeOpen} onOpenChange={(o) => { if (!o) { setWipeOpen(false); setWipePwd(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Borrar TODAS las transacciones</DialogTitle>
            <DialogDescription>
              Esta acción es irreversible. Se eliminarán todas las transacciones, junto con sus cuentas por cobrar y cuentas por pagar asociadas. Escribe la contraseña de la página para confirmar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Contraseña</Label>
            <Input
              type="password"
              value={wipePwd}
              onChange={(e) => setWipePwd(e.target.value)}
              placeholder="Contraseña de la página"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setWipeOpen(false); setWipePwd(""); }} disabled={wipeBusy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={borrarTodo} disabled={wipeBusy || !wipePwd}>
              {wipeBusy ? "Borrando…" : "Sí, borrar todo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDialog({ tx, onClose, onSaved }: { tx: any; onClose: () => void; onSaved: () => void }) {
  const [fecha, setFecha] = useState<string>(tx.fecha);
  const [centro, setCentro] = useState<Centro>(tx.centro_costo);
  const [montoUsd, setMontoUsd] = useState<string>(String(tx.monto_usd ?? ""));
  const [tasa, setTasa] = useState<string>(String(tx.tasa_bcv ?? ""));
  const [metodo, setMetodo] = useState<string>(tx.metodo_pago ?? "transferencia");
  const [numFactura, setNumFactura] = useState<string>(tx.numero_factura ?? "");
  const [numOrden, setNumOrden] = useState<string>(tx.numero_orden ?? "");
  const [referencia, setReferencia] = useState<string>(tx.referencia ?? "");
  const [notas, setNotas] = useState<string>(tx.notas ?? "");
  const [detalle, setDetalle] = useState<string>(tx.detalle ?? "");
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>(tx.cuenta_bancaria_id ?? "");
  const [capexCategoria, setCapexCategoria] = useState<string>(tx.capex_categoria ?? "Otros");
  const [busy, setBusy] = useState(false);

  const usdN = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  // Bs se recalcula desde USD usando la tasa paralela registrada (o BCV como fallback).
  const tasaParalelaN = Number(tx.tasa_paralela) || 0;
  const tasaConvN = tasaParalelaN || tasaN;
  const baseUsd = tx.iva_aplica ? usdN / 1.16 : usdN;
  const total = usdN * tasaConvN;            // monto Bs total (con IVA si aplica)
  const base = baseUsd * tasaConvN;          // base Bs sin IVA
  const iva = tx.iva_aplica ? total - base : 0;


  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await isPeriodClosed(fecha) || await isPeriodClosed(tx.fecha)) {
      return toast.error("Período cerrado — no se puede editar");
    }
    if (!tasaN) return toast.error("Falta tasa");
    if (!usdN) return toast.error("Indica un monto en USD");
    setBusy(true);
    const patch = {
      fecha,
      centro_costo: centro as any,
      monto_bs: total,
      monto_base_bs: base,
      iva_bs: iva,
      tasa_bcv: tasaN,
      monto_usd: usdN,
      metodo_pago: metodo as any,
      numero_factura: numFactura || null,
      numero_orden: numOrden || null,
      referencia: referencia || null,
      notas: notas || null,
      detalle: detalle || null,
      cuenta_bancaria_id: cuentaBancariaId || null,
      capex_categoria: tx.cuenta_codigo === "10.6" ? capexCategoria : tx.capex_categoria ?? null,
    };
    const { data: updated, error } = await supabase
      .from("transacciones")
      .update(patch as any)
      .eq("id", tx.id)
      .select()
      .single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (updated) await logAudit("transacciones", "UPDATE", tx.id, tx, updated);
    toast.success("Movimiento actualizado");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar movimiento — {tx.cuenta_codigo}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Centro</Label>
            <Select value={centro} onValueChange={(v) => setCentro(v as Centro)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Monto USD {tx.iva_aplica ? "(IVA incluido)" : ""}</Label>
            <Input type="number" step="0.01" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Tasa BCV</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          <div className="md:col-span-2 rounded-md bg-muted p-2 text-sm flex justify-between">
            <span className="text-muted-foreground">Equivalente Bs {tasaParalelaN ? "(tasa paralela)" : "(tasa BCV)"}</span>
            <span className="mono font-semibold">{fmtBs(total)}</span>
          </div>

          <div>
            <Label>Método</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METODOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>N° factura</Label><Input value={numFactura} onChange={(e) => setNumFactura(e.target.value)} /></div>
          <div><Label>N° orden</Label><Input value={numOrden} onChange={(e) => setNumOrden(e.target.value)} /></div>
          <div className="md:col-span-2">
            <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
          </div>
          <div><Label>Referencia</Label><Input value={referencia} onChange={(e) => setReferencia(e.target.value)} /></div>
          {(() => {
            const labelByCode: Record<string, string> = {
              "10.1": "Prestamista", "10.4": "Beneficiarios",
              "10.5": "Aportante", "10.6": "Descripción activo",
            };
            const lbl = labelByCode[tx.cuenta_codigo];
            if (!lbl && !detalle) return null;
            return (
              <div className="md:col-span-2"><Label>{lbl ?? "Detalle"}</Label><Input value={detalle} onChange={(e) => setDetalle(e.target.value)} /></div>
            );
          })()}
          {tx.cuenta_codigo === "10.6" && (
            <div className="md:col-span-2">
              <Label>Categoría CapEx</Label>
              <Select value={capexCategoria} onValueChange={setCapexCategoria}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAPEX_CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
