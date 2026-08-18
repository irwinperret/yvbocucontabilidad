import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtDate, fmtUsd } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft, GripVertical, Link2Off, Wand2, Download } from "lucide-react";
import { exportTableToExcel } from "@/lib/excel-table";
import {
  aplicarPareoCxp,
  quitarPareoCxp,
  esPagoDirecto,
  liberarPagoDirecto,
  reasignarPagoDirecto,
} from "@/lib/pareo-cxp";
import { pendienteBsHistorico, pendienteUsdBcv, dentroDeTolerancia } from "@/lib/cxp-saldo";
import { bancoDeReferencia } from "@/lib/conciliacion-matching";

export const Route = createFileRoute("/_authenticated/proveedores/$id")({
  component: TableroProveedor,
  head: () => ({
    meta: [
      { title: "Conciliación por proveedor | Yvbocu Contabilidad" },
      { name: "description", content: "Asigna movimientos bancarios a las facturas de cada proveedor arrastrando y soltando." },
      { property: "og:title", content: "Conciliación por proveedor | Yvbocu Contabilidad" },
      { property: "og:description", content: "Asigna movimientos bancarios a las facturas de cada proveedor arrastrando y soltando." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const SIN = "sin-proveedor";

function usdBcvDeMov(mov: any): number {
  const bs = Math.abs(Number(mov?.monto_bs) || 0);
  const tasa = Number(mov?.tasa_bcv) || 0;
  if (tasa > 0 && bs > 0) return +(bs / tasa).toFixed(2);
  return 0;
}

function MovChip({ mov, disabled }: { mov: any; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `mov:${mov.id}`, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs ${isDragging ? "opacity-50" : ""} ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{fmtDate(mov.fecha)}</span>
      <span className="font-medium">{bancoDeReferencia(mov.referencia) || "banco"}</span>
      <span className="mono">{fmtBs(Math.abs(Number(mov.monto_bs) || 0))}</span>
      <span className="mono text-muted-foreground">{fmtUsd(usdBcvDeMov(mov))} BCV</span>
      <span className="truncate text-muted-foreground max-w-[16rem]">{mov.notas ?? ""}</span>
    </div>
  );
}

function Zona({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className ?? ""} ${isOver ? "ring-2 ring-primary rounded-md" : ""}`}>
      {children}
    </div>
  );
}

function TableroProveedor() {
  const { id } = useParams({ from: "/_authenticated/proveedores/$id" });
  const qc = useQueryClient();
  const { user } = useAuth();
  const esSin = id === SIN;
  const [filtroEstado, setFiltroEstado] = useState("todas");
  const [busca, setBusca] = useState("");
  const [busy, setBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: terceros } = useQuery({
    queryKey: ["terceros-tablero"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("id,razon_social,nombre_comercial").order("razon_social");
      return (data ?? []) as any[];
    },
  });
  const nombreProveedor = esSin
    ? "Sin proveedor"
    : (terceros ?? []).find((t) => t.id === id)?.nombre_comercial ||
      (terceros ?? []).find((t) => t.id === id)?.razon_social ||
      "Proveedor";

  const { data: cxps } = useQuery({
    queryKey: ["tablero-cxp", id],
    queryFn: async () => {
      let q = supabase.from("cuentas_por_pagar").select("*").order("fecha_vencimiento", { ascending: true });
      q = esSin ? q.is("tercero_id", null) : q.eq("tercero_id", id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: movimientos } = useQuery({
    queryKey: ["tablero-movs"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return (await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("*")
          .neq("standby", true)
          .like("referencia", "BANK:%")
          .order("fecha", { ascending: false })
          .range(from, to),
      )) as any[];
    },
  });

  const { data: vinculos } = useQuery({
    queryKey: ["conciliacion-bancaria"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("conciliacion_bancaria").select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const facturaIds = useMemo(
    () => new Set((cxps ?? []).map((c) => c.transaccion_id).filter(Boolean) as string[]),
    [cxps],
  );

  /** Transacciones de las facturas (para conocer su grupo contable). */
  const { data: facturasTx } = useQuery({
    queryKey: ["tablero-facturas-tx", id, [...facturaIds].sort().join(",")],
    enabled: facturaIds.size > 0,
    queryFn: async () => {
      const ids = [...facturaIds];
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase
          .from("transacciones")
          .select("id, grupo_transaccion_id")
          .in("id", ids.slice(i, i + 200));
        out.push(...(data ?? []));
      }
      return out;
    },
  });

  /** grupo_transaccion_id -> transaccion_factura_id */
  const grupoAFactura = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of facturasTx ?? []) {
      if (t.grupo_transaccion_id) m.set(t.grupo_transaccion_id, t.id);
    }
    return m;
  }, [facturasTx]);

  /** numero_factura -> transaccion_factura_id */
  const numeroAFactura = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cxps ?? []) {
      const n = String(c.numero_factura ?? "").trim();
      if (n && c.transaccion_id) m.set(n, c.transaccion_id);
    }
    return m;
  }, [cxps]);

  /** movId -> facturaTxIds (vínculo formal + pareo manual + pago directo del importador) */
  const movAFacturas = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of vinculos ?? []) {
      if (!v.transaccion_factura_id || v.estado === "rechazado") continue;
      const arr = m.get(v.transaccion_bancaria_id) ?? [];
      arr.push(v.transaccion_factura_id);
      m.set(v.transaccion_bancaria_id, arr);
    }
    // Pagos directos: el movimiento es la propia transacción 13.2.
    for (const mv of movimientos ?? []) {
      if (m.has(mv.id)) continue;
      if (String(mv.cuenta_codigo) !== "13.2") continue;
      const ligados = new Set<string>();
      const porGrupo = mv.grupo_transaccion_id ? grupoAFactura.get(mv.grupo_transaccion_id) : undefined;
      if (porGrupo) ligados.add(porGrupo);
      const det = String(mv.detalle ?? "");
      if (det.startsWith("Pago facturas")) {
        for (const n of det.replace("Pago facturas", "").split(",")) {
          const f = numeroAFactura.get(n.trim());
          if (f) ligados.add(f);
        }
      }
      if (ligados.size) m.set(mv.id, [...ligados]);
    }
    return m;
  }, [vinculos, movimientos, grupoAFactura, numeroAFactura]);

  const movsDelProveedor = useMemo(() => {
    return (movimientos ?? []).filter((mv) => {
      const ligados = movAFacturas.get(mv.id) ?? [];
      if (ligados.some((f) => facturaIds.has(f))) return true;
      if (ligados.length) return false; // pareado con otro proveedor
      return esSin ? !mv.tercero_id : mv.tercero_id === id;
    });
  }, [movimientos, movAFacturas, facturaIds, esSin, id]);

  const movsPorFactura = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const mv of movsDelProveedor) {
      for (const f of movAFacturas.get(mv.id) ?? []) {
        const arr = m.get(f) ?? [];
        arr.push(mv);
        m.set(f, arr);
      }
    }
    return m;
  }, [movsDelProveedor, movAFacturas]);

  const movsHuerfanos = useMemo(
    () => movsDelProveedor.filter((mv) => !(movAFacturas.get(mv.id) ?? []).length),
    [movsDelProveedor, movAFacturas],
  );

  const facturas = useMemo(() => {
    const txt = busca.trim().toLowerCase();
    return (cxps ?? []).filter((c) => {
      const movs = movsPorFactura.get(c.transaccion_id ?? "") ?? [];
      const conPareo = movs.length > 0;
      const pagada = c.estado === "pagada";
      if (filtroEstado === "abiertas" && pagada) return false;
      if (filtroEstado === "pagadas" && !pagada) return false;
      if (filtroEstado === "con-pareo" && !conPareo) return false;
      if (filtroEstado === "sin-pareo" && conPareo) return false;
      if (txt && !`${c.numero_factura ?? ""} ${c.proveedor ?? ""}`.toLowerCase().includes(txt)) return false;
      return true;
    });
  }, [cxps, filtroEstado, busca, movsPorFactura]);

  const sinMovimiento = facturas.filter(
    (c) => !(movsPorFactura.get(c.transaccion_id ?? "") ?? []).length,
  );
  /** Abiertas sin ningún movimiento asignado. */
  const facturasHuerfanas = sinMovimiento.filter((c) => c.estado !== "pagada");
  /** Pagadas pero sin movimiento identificable → casos a revisar. */
  const pagadasSinMov = sinMovimiento.filter((c) => c.estado === "pagada");
  const facturasConPareo = facturas.filter(
    (c) => (movsPorFactura.get(c.transaccion_id ?? "") ?? []).length > 0,
  );
  const facturasPagadas = facturas.filter((c) => c.estado === "pagada");
  const facturasAbiertas = facturas.filter((c) => c.estado !== "pagada");


  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] });
    await qc.invalidateQueries({ queryKey: ["tablero-cxp", id] });
    await qc.invalidateQueries({ queryKey: ["tablero-movs"] });
    await qc.invalidateQueries({ queryKey: ["cxp-analisis"] });
    await qc.invalidateQueries({ queryKey: ["mov-bancarios"] });
  };

  /** CxP actualmente cubiertas por un movimiento (por txId de factura). */
  const cxpsDeMov = (movId: string) => {
    const txIds = movAFacturas.get(movId) ?? [];
    return (cxps ?? []).filter((c) => c.transaccion_id && txIds.includes(c.transaccion_id));
  };

  const asignar = async (movId: string, cxpId: string) => {
    if (!user) return;
    const mov = (movimientos ?? []).find((m) => m.id === movId);
    const cxp = (cxps ?? []).find((c) => c.id === cxpId);
    if (!mov || !cxp) return;
    if (!cxp.transaccion_id) return toast.error("La factura no tiene transacción asociada.");
    setBusy(true);
    try {
      if (esPagoDirecto(mov)) {
        const r = await reasignarPagoDirecto({
          mov,
          cxpsActuales: cxpsDeMov(movId),
          destino: cxp,
          userId: user.id,
        });
        if (!r.ok) throw new Error(r.error ?? "No se pudo reasignar");
      } else {
        if ((movAFacturas.get(movId) ?? []).length) await quitarPareoCxp(movId);
        await aplicarPareoCxp({
          mov,
          terceroId: (cxp.tercero_id ?? mov.tercero_id ?? null) as string,
          cxps: [cxp],
          userId: user.id,
        });
      }
      toast.success("Movimiento asignado");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo asignar");
    } finally {
      setBusy(false);
    }
  };

  const desasignar = async (movId: string) => {
    const mov = (movimientos ?? []).find((m) => m.id === movId);
    setBusy(true);
    const r = mov && esPagoDirecto(mov)
      ? await liberarPagoDirecto(mov, cxpsDeMov(movId))
      : await quitarPareoCxp(movId);
    setBusy(false);
    if (!r.ok) return toast.error(r.error ?? "No se pudo desasignar");
    toast.success("Movimiento liberado");

    await refrescar();
  };

  const cambiarProveedorMov = async (movId: string, nuevo: string | null) => {
    const { error } = await supabase.from("transacciones").update({ tercero_id: nuevo } as any).eq("id", movId);
    if (error) return toast.error(error.message);
    toast.success(nuevo ? "Proveedor asignado al movimiento" : "Movimiento sin proveedor");
    await refrescar();
  };

  const cambiarProveedorFactura = async (cxp: any, nuevo: string | null) => {
    const nombre = nuevo
      ? (terceros ?? []).find((t) => t.id === nuevo)?.nombre_comercial ||
        (terceros ?? []).find((t) => t.id === nuevo)?.razon_social
      : null;
    const { error } = await supabase
      .from("cuentas_por_pagar")
      .update({ tercero_id: nuevo, proveedor: nombre } as any)
      .eq("id", cxp.id);
    if (error) return toast.error(error.message);
    if (cxp.transaccion_id) {
      await supabase.from("transacciones").update({ tercero_id: nuevo } as any).eq("id", cxp.transaccion_id);
    }
    toast.success("Proveedor de la factura actualizado");
    await refrescar();
  };

  /** Parea automáticamente los huérfanos cuyo monto coincide con una sola factura. */
  const parearEvidentes = async () => {
    if (!user) return;
    const pendientes = facturasHuerfanas.filter((c) => c.estado !== "pagada" && c.transaccion_id);
    const usados = new Set<string>();
    let n = 0;
    setBusy(true);
    try {
      for (const mv of movsHuerfanos) {
        const monto = Math.abs(Number(mv.monto_bs) || 0);
        const cands = pendientes.filter(
          (c) => !usados.has(c.id) && dentroDeTolerancia(Math.abs(pendienteBsHistorico(c) - monto), monto),
        );
        if (cands.length !== 1) continue;
        const cxp = cands[0];
        await aplicarPareoCxp({
          mov: mv,
          terceroId: (cxp.tercero_id ?? mv.tercero_id ?? null) as string,
          cxps: [cxp],
          userId: user.id,
        });
        usados.add(cxp.id);
        n++;
      }
      toast[n ? "success" : "info"](n ? `${n} movimiento(s) pareado(s)` : "No hay coincidencias evidentes");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al parear");
    } finally {
      setBusy(false);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const movId = String(e.active.id).replace("mov:", "");
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    if (over === "huerfanos") return void desasignar(movId);
    if (over.startsWith("cxp:")) return void asignar(movId, over.slice(4));
  };

  const exportar = async () => {
    await exportTableToExcel({
      filename: `conciliacion-${nombreProveedor.replace(/\s+/g, "-").toLowerCase()}.xlsx`,
      sheetName: "Conciliación",
      columns: [
        { header: "N° factura", key: "fact", width: 18 },
        { header: "Fecha emisión", key: "emision", width: 14 },
        { header: "Estado", key: "estado", width: 12 },
        { header: "Pendiente Bs", key: "bs", width: 16, fmt: "bs" },
        { header: "Pendiente USD BCV", key: "usd", width: 18, fmt: "usd" },
        { header: "Movimientos pareados", key: "movs", width: 60 },
      ],
      rows: facturas.map((c) => ({
        fact: c.numero_factura ?? "s/n",
        emision: c.fecha ? fmtDate(c.fecha) : "—",
        estado: c.estado,
        bs: pendienteBsHistorico(c),
        usd: pendienteUsdBcv(c),
        movs: (movsPorFactura.get(c.transaccion_id ?? "") ?? [])
          .map((m) => `${fmtDate(m.fecha)} ${fmtBs(Math.abs(Number(m.monto_bs) || 0))}`)
          .join(" | "),
      })),
    });
    toast.success("Excel generado");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/proveedores"><ArrowLeft className="h-4 w-4 mr-1" />Proveedores</Link>
          </Button>
          <h1 className="text-xl font-semibold">{nombreProveedor}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas ({facturas.length})</SelectItem>
              <SelectItem value="con-pareo">Con pareo ({facturasConPareo.length})</SelectItem>
              <SelectItem value="sin-pareo">Sin pareo ({facturas.length - facturasConPareo.length})</SelectItem>
              <SelectItem value="abiertas">Abiertas ({facturasAbiertas.length})</SelectItem>
              <SelectItem value="pagadas">Pagadas ({facturasPagadas.length})</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Buscar factura…" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-48" />
          <Button variant="outline" size="sm" onClick={parearEvidentes} disabled={busy}>
            <Wand2 className="h-4 w-4 mr-1" />Parear lo evidente
          </Button>
          <Button variant="outline" size="sm" onClick={exportar}>
            <Download className="h-4 w-4 mr-1" />Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Facturas</div>
            <div className="text-lg font-semibold">{facturas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Con pareo</div>
            <div className="text-lg font-semibold">{facturasConPareo.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Facturas huérfanas</div>
            <div className="text-lg font-semibold">{facturasHuerfanas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Movimientos huérfanos</div>
            <div className="text-lg font-semibold">{movsHuerfanos.length}</div>
          </CardContent>
        </Card>
      </div>

      <p className="text-sm text-muted-foreground">
        Arrastra un movimiento a una factura para asignarlo, o a la bandeja de huérfanos para liberarlo.
      </p>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Facturas / órdenes <Badge variant="secondary">{facturas.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {facturas.length === 0 && <p className="text-sm text-muted-foreground">Sin facturas para este filtro.</p>}
            {facturas.map((c) => {
              const movs = movsPorFactura.get(c.transaccion_id ?? "") ?? [];
              const cubierto = movs.reduce((s, m) => s + Math.abs(Number(m.monto_bs) || 0), 0);
              const facturasAsignables = facturas.filter((f) => f.id !== c.id && f.transaccion_id);
              return (
                <Zona key={c.id} id={`cxp:${c.id}`} className="border rounded-md p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium">Fact. {c.numero_factura ?? "s/n"}</span>{" "}
                      {c.fecha && (
                        <span className="text-muted-foreground">· emisión {fmtDate(c.fecha)}</span>
                      )}{" "}
                      <span className="text-muted-foreground">· vence {c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</span>
                      <div className="text-xs text-muted-foreground">
                        Factura {fmtBs(Number(c.monto_bs) || 0)} ·{" "}
                        {fmtUsd(Number(c.usd_bcv_factura ?? c.monto_usd ?? 0) || 0)} USD BCV
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Pendiente {fmtBs(pendienteBsHistorico(c))} · {fmtUsd(pendienteUsdBcv(c))} USD BCV · pareado{" "}
                        {fmtBs(cubierto)} ({movs.length} mov.)
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant={c.estado === "pagada" ? "secondary" : c.estado === "parcial" ? "default" : "outline"}>
                        {c.estado === "pagada" ? "Pagada" : c.estado === "parcial" ? "Parcial" : "Pendiente"}
                      </Badge>
                      <Badge variant={movs.length ? "default" : "destructive"}>
                        {movs.length ? `Con pareo (${movs.length})` : "Sin pareo"}
                      </Badge>

                      <Select
                        value={c.tercero_id ?? "none"}
                        onValueChange={(v) => cambiarProveedorFactura(c, v === "none" ? null : v)}
                      >
                        <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin proveedor</SelectItem>
                          {(terceros ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.nombre_comercial || t.razon_social}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    {movs.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Suelta aquí un movimiento…</p>
                    ) : (
                      movs.map((m) => (
                        <div key={m.id} className="flex items-center gap-2">
                          <MovChip mov={m} />
                          <Button variant="ghost" size="sm" onClick={() => desasignar(m.id)} disabled={busy}>
                            <Link2Off className="h-3.5 w-3.5" />
                          </Button>
                          <Select onValueChange={(v) => v === "huerfanos" ? desasignar(m.id) : asignar(m.id, v)}>
                            <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Mover a…" /></SelectTrigger>
                            <SelectContent>
                              {facturasAsignables.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                  {f.numero_factura ?? "s/n"} · {fmtBs(pendienteBsHistorico(f))}
                                </SelectItem>
                              ))}
                              <SelectItem value="huerfanos">Dejar huérfano</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ))
                    )}
                  </div>
                </Zona>
              );
            })}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Movimientos huérfanos <Badge variant="destructive">{movsHuerfanos.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Zona id="huerfanos" className="space-y-2 min-h-24 border border-dashed rounded-md p-2">
                {movsHuerfanos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin movimientos huérfanos.</p>
                )}
                {movsHuerfanos.map((m) => (
                  <div key={m.id} className="space-y-1">
                    <MovChip mov={m} />
                    <div className="flex gap-2">
                      <Select onValueChange={(v) => asignar(m.id, v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Asignar a factura…" /></SelectTrigger>
                        <SelectContent>
                          {facturas
                            .filter((c) => c.transaccion_id)
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.numero_factura ?? "s/n"} · {fmtBs(pendienteBsHistorico(c))}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={m.tercero_id ?? "none"}
                        onValueChange={(v) => cambiarProveedorMov(m.id, v === "none" ? null : v)}
                      >
                        <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin proveedor</SelectItem>
                          {(terceros ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.nombre_comercial || t.razon_social}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </Zona>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Facturas abiertas sin movimiento asignado{" "}
                  <Badge variant="destructive">{facturasHuerfanas.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {facturasHuerfanas.length === 0 && <p className="text-xs text-muted-foreground">Ninguna.</p>}
                {facturasHuerfanas.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs border-b last:border-0 py-1">
                    <span>
                      Fact. {c.numero_factura ?? "s/n"}
                      {c.fecha && <span className="text-muted-foreground ml-1">({fmtDate(c.fecha)})</span>}
                    </span>
                    <span className="mono">
                      {fmtBs(pendienteBsHistorico(c))} · {fmtUsd(pendienteUsdBcv(c))} BCV
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Pagadas sin movimiento identificado{" "}
                  <Badge variant="secondary">{pagadasSinMov.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {pagadasSinMov.length === 0 && <p className="text-xs text-muted-foreground">Ninguna.</p>}
                {pagadasSinMov.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs border-b last:border-0 py-1">
                    <span>
                      Fact. {c.numero_factura ?? "s/n"}
                      {c.fecha && <span className="text-muted-foreground ml-1">({fmtDate(c.fecha)})</span>}
                    </span>
                    <span className="mono">
                      {fmtBs(Number(c.monto_bs) || 0)} · {fmtUsd(Number(c.usd_bcv_factura ?? c.monto_usd ?? 0) || 0)} BCV
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

        </div>
      </DndContext>
    </div>
  );
}
