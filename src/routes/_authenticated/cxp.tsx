import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { UsdRateBadge } from "@/components/usd-rate-badge";
import { toast } from "sonner";
import { Check, X, Link2, Download } from "lucide-react";
import { exportTableToExcel } from "@/lib/excel-table";
import {
  bancoDeReferencia,
  normalizarFactura,
  parearMovimiento,
  sugerirCombinacionParaFactura,
  type FacturaRef,
} from "@/lib/conciliacion-matching";
import { pendienteBsAFecha, pendienteBsHistorico, pendienteUsdBcv } from "@/lib/cxp-saldo";
import { tasaBcvQuery } from "@/lib/tasas";

export const Route = createFileRoute("/_authenticated/cxp")({
  component: CxPAnalisisPage,
  head: () => ({
    meta: [
      { title: "Cuentas por pagar | Yvbocu Contabilidad" },
      { name: "description", content: "Obligaciones pendientes y su conciliación contra los movimientos bancarios." },
      { property: "og:title", content: "Cuentas por pagar | Yvbocu Contabilidad" },
      { property: "og:description", content: "Obligaciones pendientes y su conciliación contra los movimientos bancarios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type MovLite = {
  id: string;
  fecha: string;
  monto_bs: number;
  notas: string | null;
  referencia: string | null;
  cuenta_codigo: string;
  tasa_bcv: number;
};

function CxPAnalisisPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [origenFilter, setOrigenFilter] = useState<string>("todos");
  const [origenPareo, setOrigenPareo] = useState<string>("todos");
  const [estadoPareo, setEstadoPareo] = useState<string>("todos");
  const [manualPara, setManualPara] = useState<any | null>(null);

  const { data } = useQuery({
    queryKey: ["cxp-analisis", origenFilter],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) => {
        let q = supabase
          .from("cuentas_por_pagar")
          .select("*")
          .neq("estado", "pagada")
          .order("fecha_vencimiento", { ascending: true });
        if (origenFilter !== "todos") q = q.eq("origen", origenFilter);
        return await q.range(from, to);
      });
    },
  });

  const { data: movimientos } = useQuery({
    queryKey: ["mov-bancarios-cxp"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const rows = await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id,fecha,monto_bs,notas,referencia,cuenta_codigo,tasa_bcv").neq("standby", true)
          .like("referencia", "BANK:%")
          .order("fecha", { ascending: false })
          .range(from, to),
      );
      return rows as unknown as MovLite[];
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

  const items = (data ?? []) as any[];
  const { data: tasaHoy = 0 } = useQuery({
    queryKey: ["tasa-bcv-cxp-analisis", todayISO()],
    queryFn: async () => {
      const { data } = await tasaBcvQuery(todayISO(), "tasa");
      return Number(data?.tasa) || 0;
    },
  });

  /** Índice de facturas de CxP (por su transacción asociada) */
  const indice = useMemo(() => {
    const lista: FacturaRef[] = items
      .filter((c) => c.transaccion_id)
      .map((c) => ({
        id: c.transaccion_id as string,
        fecha: (c.created_at ? String(c.created_at).slice(0, 10) : todayISO()),
        numero_factura: c.numero_factura ?? null,
        monto_bs: Number(c.monto_bs),
        usd_bcv: pendienteUsdBcv(c),
        cuenta_codigo: "2.1",
        proveedor: c.proveedor ?? null,
      }));
    const porNumero = new Map<string, FacturaRef[]>();
    for (const f of lista) {
      const k = normalizarFactura(f.numero_factura);
      if (!k) continue;
      const arr = porNumero.get(k) ?? [];
      arr.push(f);
      porNumero.set(k, arr);
    }
    return { lista, porNumero };
  }, [items]);

  /** facturaId -> movimientos sugeridos por el motor de pareo */
  const sugeridosPorFactura = useMemo(() => {
    const m = new Map<string, MovLite[]>();
    for (const mov of movimientos ?? []) {
      const r = parearMovimiento(mov as any, indice.porNumero, indice.lista);
      if (r.estado === "no_aplica" || r.estado === "sin_pareo") continue;
      for (const f of r.facturas) {
        const arr = m.get(f.id) ?? [];
        arr.push(mov);
        m.set(f.id, arr);
      }
    }
    return m;
  }, [movimientos, indice]);

  /** facturaId -> vínculos confirmados */
  const confirmadosPorFactura = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const v of vinculos ?? []) {
      if (v.estado !== "pareado" || !v.transaccion_factura_id) continue;
      const arr = m.get(v.transaccion_factura_id) ?? [];
      arr.push(v);
      m.set(v.transaccion_factura_id, arr);
    }
    return m;
  }, [vinculos]);

  const movById = useMemo(() => {
    const m = new Map<string, MovLite>();
    for (const mv of movimientos ?? []) m.set(mv.id, mv);
    return m;
  }, [movimientos]);

  /** Movimientos ya confirmados contra CUALQUIER factura (no ofrecerlos de nuevo). */
  const movimientosUsadosIds = useMemo(() => {
    const s = new Set<string>();
    for (const v of vinculos ?? []) {
      if (v.estado === "pareado" && v.transaccion_bancaria_id) s.add(v.transaccion_bancaria_id);
    }
    return s;
  }, [vinculos]);

  const filas = useMemo(() => {
    return items.map((c) => {
      const fid = c.transaccion_id as string | null;
      const confirmados = fid ? confirmadosPorFactura.get(fid) ?? [] : [];
      const movsConf = confirmados
        .map((v) => movById.get(v.transaccion_bancaria_id))
        .filter(Boolean) as MovLite[];
      const sugeridos = fid ? sugeridosPorFactura.get(fid) ?? [] : [];

      // Si no hay un pareo individual sugerido, intenta encontrar una
      // COMBINACIÓN de varios movimientos del mismo proveedor (factura grande
      // pagada en cuotas): búsqueda combinatoria, no un pareo de 1 a 1.
      let sugeridosCombo: MovLite[] = [];
      let esCombo = false;
      if (!movsConf.length && !sugeridos.length) {
        const disponibles = (movimientos ?? []).filter((m) => !movimientosUsadosIds.has(m.id));
        const idsCombo = sugerirCombinacionParaFactura(
          { proveedor: c.proveedor ?? null, pendienteBs: pendienteBsHistorico(c) },
          disponibles,
        );
        if (idsCombo.length) {
          sugeridosCombo = idsCombo.map((id) => movById.get(id)).filter(Boolean) as MovLite[];
          esCombo = true;
        }
      }

      const movs = movsConf.length ? movsConf : (sugeridos.length ? sugeridos : sugeridosCombo);
      const totalPareado = movs.reduce((s, m) => s + Math.abs(Number(m.monto_bs) || 0), 0);
      const estado: "pareada" | "posible" | "sin_pareo" = movsConf.length
        ? "pareada"
        : movs.length
          ? "posible"
          : "sin_pareo";
      const origen = movsConf.length
        ? confirmados.every((v) => v.origen === "auto") ? "auto" : "manual"
        : null;
      return { c, estado, movs, totalPareado, origen, confirmable: !movsConf.length && movs.length > 0, esCombo };
    });
  }, [items, confirmadosPorFactura, sugeridosPorFactura, movById, movimientos, movimientosUsadosIds]);

  const filtradas = useMemo(
    () =>
      filas.filter((f) => {
        if (estadoPareo !== "todos" && f.estado !== estadoPareo) return false;
        if (origenPareo !== "todos" && (f.origen ?? "ninguno") !== origenPareo) return false;
        return true;
      }),
    [filas, estadoPareo, origenPareo],
  );

  const guardar = async (
    facturaId: string,
    movIds: string[],
    estado: "pareado" | "rechazado",
    origen: "auto" | "manual",
  ) => {
    // limpiar vínculos previos de esta factura
    const del = await (supabase.from as any)("conciliacion_bancaria")
      .delete()
      .eq("transaccion_factura_id", facturaId);
    if (del.error) { toast.error(del.error.message); return; }
    if (estado === "pareado" && movIds.length) {
      const { error } = await (supabase.from as any)("conciliacion_bancaria").insert(
        movIds.map((mid) => ({
          transaccion_bancaria_id: mid,
          transaccion_factura_id: facturaId,
          estado: "pareado",
          origen,
          confirmado_por: user?.id ?? null,
          confirmado_en: new Date().toISOString(),
        })),
      );
      if (error) { toast.error(error.message); return; }
    }
    toast.success(estado === "pareado" ? "Pareo guardado" : "Sugerencia rechazada");
    qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] });
    setManualPara(null);
  };

  const badge = (c: any) => {
    if (!c.fecha_vencimiento) return <Badge className="bg-green-600">vigente</Badge>;
    if (c.fecha_vencimiento < todayISO()) return <Badge variant="destructive">vencida</Badge>;
    const diff = (new Date(c.fecha_vencimiento).getTime() - Date.now()) / 86400000;
    if (diff <= 7) return <Badge className="bg-orange-500">por vencer</Badge>;
    return <Badge className="bg-green-600">vigente</Badge>;
  };

  const badgePareo = (e: string) => {
    if (e === "pareada") return <Badge className="bg-green-600">Pareada</Badge>;
    if (e === "posible") return <Badge className="bg-orange-500">Posible pareo</Badge>;
    return <Badge variant="destructive">Sin pareo</Badge>;
  };

  const pendUsdOf = (c: any) => pendienteUsdBcv(c);

  const lista = filtradas.map((f) => f.c);
  const vencidas = lista.filter((c: any) => c.fecha_vencimiento && c.fecha_vencimiento < todayISO());
  const porVencer = lista.filter(
    (c: any) =>
      c.fecha_vencimiento &&
      c.fecha_vencimiento >= todayISO() &&
      (new Date(c.fecha_vencimiento).getTime() - Date.now()) / 86400000 <= 7,
  );
  const totalVencidas = vencidas.reduce((s: number, c: any) => s + pendUsdOf(c), 0);
  const totalPorVencer = porVencer.reduce((s: number, c: any) => s + pendUsdOf(c), 0);
  const total = lista.reduce((s: number, c: any) => s + pendUsdOf(c), 0);

  const exportar = async () => {
    if (!filtradas.length) { toast.error("No hay cuentas por pagar que exportar."); return; }
    try {
      await exportTableToExcel({
        filename: `cuentas-por-pagar-${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: "Cuentas por pagar",
        columns: [
          { header: "Proveedor", key: "prov", width: 30 },
          { header: "N° factura", key: "fact", width: 16 },
          { header: "Origen", key: "origen", width: 12 },
          { header: "Bs histórico", key: "bsHistorico", width: 16, fmt: "bs" },
          { header: "Pendiente hoy Bs", key: "bs", width: 18, fmt: "bs" },
          { header: "Pendiente USD BCV", key: "usd", width: 18, fmt: "usd" },
          { header: "Vence", key: "vence", width: 12 },
          { header: "Estado de pareo", key: "estPareo", width: 18 },
          { header: "Movimientos pareados", key: "movs", width: 46 },
          { header: "Total pareado Bs", key: "totalPareado", width: 16, fmt: "bs" },
          { header: "Origen del pareo", key: "origenPareo", width: 16 },
        ],
        rows: filtradas.map((f) => ({
          prov: f.c.proveedor ?? "",
          fact: f.c.numero_factura ?? "",
          origen: f.c.origen === "xetux" ? "Xetux" : "Manual",
          bsHistorico: pendienteBsHistorico(f.c),
          bs: pendienteBsAFecha(f.c, tasaHoy),
          usd: pendUsdOf(f.c),
          vence: f.c.fecha_vencimiento ?? "",
          estPareo: f.estado === "pareada" ? "Pareada" : f.estado === "posible" ? "Posible pareo" : "Sin pareo",
          movs: f.movs
            .map((m) => `${fmtDate(m.fecha)} ${bancoDeReferencia(m.referencia)} ${fmtBs(m.monto_bs)}`)
            .join(" | "),
          totalPareado: f.totalPareado,
          origenPareo: f.origen === "auto" ? "Automático" : f.origen === "manual" ? "Manual" : "—",
        })),
      });
      toast.success(`Excel generado (${filtradas.length} cuentas)`);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo generar el Excel");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cuentas por pagar — análisis</h1>
          <div className="mt-1"><UsdRateBadge /></div>
          <p className="text-sm text-muted-foreground">Obligaciones pendientes y su pareo contra movimientos bancarios</p>
        </div>
        <Button onClick={exportar}><Download className="h-4 w-4 mr-2" /> Exportar a Excel</Button>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="grid gap-4 md:grid-cols-4 flex-1">
          <Kpi label="Vencidas" value={fmtUsd(totalVencidas)} count={vencidas.length} color="negative" />
          <Kpi label="Por vencer 7d" value={fmtUsd(totalPorVencer)} count={porVencer.length} color="warning" />
          <Kpi label="Vigentes" value={fmtUsd(total - totalVencidas - totalPorVencer)} count={lista.length - vencidas.length - porVencer.length} color="positive" />
          <Kpi label="Total" value={fmtUsd(total)} count={lista.length} color="" />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Origen del registro</Label>
            <Select value={origenFilter} onValueChange={setOrigenFilter}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="xetux">Xetux</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estado de pareo</Label>
            <Select value={estadoPareo} onValueChange={setEstadoPareo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pareada">Pareada</SelectItem>
                <SelectItem value="posible">Posible pareo</SelectItem>
                <SelectItem value="sin_pareo">Sin pareo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Origen del pareo</Label>
            <Select value={origenPareo} onValueChange={setOrigenPareo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="auto">Automático</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="ninguno">Sin pareo confirmado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle ({filtradas.length})</CardTitle></CardHeader>
        <CardContent>
          {filtradas.length === 0 ? <p className="text-sm text-muted-foreground">Sin pendientes.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Proveedor</th>
                    <th className="text-left py-2 px-2">N° factura</th>
                    <th className="text-left py-2 px-2">Origen</th>
                    <th className="text-right py-2 px-2">Pendiente Bs</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Vence</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Conciliación bancaria</th>
                    <th className="text-left py-2 px-2">Origen del pareo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((f) => {
                    const c = f.c;
                     const pendBs = pendienteBsAFecha(c, tasaHoy);
                    const saldo = pendBs - f.totalPareado;
                    return (
                      <tr key={c.id} className="border-b last:border-0 align-top">
                        <td className="py-2 px-2">{c.proveedor ?? "—"}</td>
                        <td className="py-2 px-2 mono text-xs">{c.numero_factura ?? "—"}</td>
                        <td className="py-2 px-2">
                          <Badge variant="outline" className="text-[10px]">{c.origen === "xetux" ? "Xetux" : "Manual"}</Badge>
                        </td>
                         <td className="py-2 px-2 text-right mono">
                           {fmtBs(pendBs)}
                           <div className="text-[10px] text-muted-foreground">Histórico {fmtBs(pendienteBsHistorico(c))}</div>
                         </td>
                        <td className="py-2 px-2 text-right mono">{fmtUsd(pendUsdOf(c))}</td>
                        <td className="py-2 px-2 mono">{c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}</td>
                        <td className="py-2 px-2">{badge(c)}</td>
                        <td className="py-2 px-2">
                          <div className="flex flex-col gap-1">
                            {badgePareo(f.estado)}
                            {f.esCombo && (
                              <span className="text-[11px] text-amber-600 font-medium">
                                Combinación de {f.movs.length} movimientos (sugerido)
                              </span>
                            )}
                            {f.movs.map((m) => (
                              <span key={m.id} className="text-[11px] mono">
                                {fmtDate(m.fecha)} · {bancoDeReferencia(m.referencia)} · {fmtBs(m.monto_bs)}
                              </span>
                            ))}
                            {f.movs.length > 0 && (
                              <span className="text-[11px]">
                                Total pareado {fmtBs(f.totalPareado)} · saldo {fmtBs(saldo)}
                              </span>
                            )}
                            <div className="flex gap-1 pt-1 flex-wrap">
                              {f.confirmable && c.transaccion_id && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => guardar(c.transaccion_id, f.movs.map((m) => m.id), "pareado", "auto")}>
                                    <Check className="h-3 w-3 mr-1" /> Confirmar{f.movs.length > 1 ? ` (${f.movs.length})` : ""}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => guardar(c.transaccion_id, [], "rechazado", "manual")}>
                                    <X className="h-3 w-3 mr-1" /> Rechazar
                                  </Button>
                                </>
                              )}
                              {c.transaccion_id && (
                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setManualPara(f)}>
                                  <Link2 className="h-3 w-3 mr-1" /> Parear manual
                                </Button>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          {f.origen ? (
                            <Badge variant="outline" className="text-[10px]">{f.origen === "auto" ? "Automático" : "Manual"}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
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

      {manualPara && (
        <ManualDialog
          fila={manualPara}
          movimientos={movimientos ?? []}
          onClose={() => setManualPara(null)}
          onSave={(ids) => guardar(manualPara.c.transaccion_id, ids, "pareado", "manual")}
        />
      )}
    </div>
  );
}

function ManualDialog({
  fila,
  movimientos,
  onClose,
  onSave,
}: {
  fila: any;
  movimientos: MovLite[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [q, setQ] = useState(fila.c.proveedor ?? "");
  const [sel, setSel] = useState<string[]>(fila.movs.map((m: MovLite) => m.id));

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = movimientos.filter((m) =>
      !t
        ? true
        : String(m.notas ?? "").toLowerCase().includes(t) ||
          bancoDeReferencia(m.referencia).toLowerCase().includes(t) ||
          String(Math.abs(Number(m.monto_bs))).includes(t),
    );
    return base.slice(0, 200);
  }, [movimientos, q]);

  const totalSel = movimientos
    .filter((m) => sel.includes(m.id))
    .reduce((s, m) => s + Math.abs(Number(m.monto_bs) || 0), 0);
  const pendBs = pendienteBsHistorico(fila.c);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Parear movimientos — {fila.c.proveedor ?? "Proveedor"} · Fact {fila.c.numero_factura ?? "—"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Buscar por memo, banco o monto…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-[45vh] overflow-y-auto border rounded-md divide-y">
            {lista.map((m) => (
              <label key={m.id} className="flex items-center gap-3 px-3 py-2 text-xs cursor-pointer">
                <Checkbox
                  checked={sel.includes(m.id)}
                  onCheckedChange={(v) => setSel((s) => (v ? [...s, m.id] : s.filter((x) => x !== m.id)))}
                />
                <span className="mono whitespace-nowrap">{fmtDate(m.fecha)}</span>
                <span className="whitespace-nowrap">{bancoDeReferencia(m.referencia)}</span>
                <span className="mono whitespace-nowrap">{fmtBs(m.monto_bs)}</span>
                <span className="text-muted-foreground truncate">{m.notas ?? ""}</span>
              </label>
            ))}
            {lista.length === 0 && <p className="p-3 text-xs text-muted-foreground">Sin movimientos que coincidan.</p>}
          </div>
          <p className="text-xs">
            Seleccionados: {sel.length} · Total {fmtBs(totalSel)} · Pendiente CxP {fmtBs(pendBs)} · Diferencia{" "}
            {fmtBs(pendBs - totalSel)}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(sel)}>Guardar pareo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value, count, color }: { label: string; value: string; count: number; color: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold mono ${color === "negative" ? "negative" : color === "warning" ? "text-orange-600" : color === "positive" ? "positive" : ""}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{count} registros</div>
      </CardContent>
    </Card>
  );
}
