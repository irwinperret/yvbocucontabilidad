import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

import { Pencil, Download, Trash2, Filter, ArrowUp, ArrowDown, X } from "lucide-react";
import { toast } from "sonner";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { EliminarTransaccionDialog } from "@/components/eliminar-transaccion-dialog";
import { logAudit, isPeriodClosed } from "@/lib/audit";
import { CENTROS, METODOS, CAPEX_CATEGORIAS, type Centro } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";
import { AdjuntoCell } from "@/components/adjunto-cell";
import { fetchAllRows } from "@/lib/fetch-all";
import { UsdRateBadge } from "@/components/usd-rate-badge";

export const Route = createFileRoute("/_authenticated/transacciones")({
  component: TransaccionesPage,
});

// ---------- Session-persistent state helper ----------
const SESSION_KEY = "transacciones-filters-v1";
type FilterState = {
  desde: string;
  hasta: string;
  busca: string;
  centros: string[];
  cuentas: string[];
  metodos: string[];
  modos: string[]; // ["on_balance","off_balance"]
  tercero: string;
  factura: string;
  notas: string;
  referencia: string;
  numMin: string;
  numMax: string;
  bsMin: string;
  bsMax: string;
  usdMin: string;
  usdMax: string;
  netoMin: string;
  netoMax: string;
  ivaMin: string;
  ivaMax: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  pageSize: number | "all";
};
type SortKey = "numero" | "fecha" | "cuenta_codigo" | "centro_costo" | "monto_bs" | "monto_usd" | "numero_factura";
const defaultState = (initialDesde: string): FilterState => ({
  desde: initialDesde,
  hasta: todayISO(),
  busca: "",
  centros: [],
  cuentas: [],
  metodos: [],
  modos: [],
  tercero: "",
  factura: "",
  notas: "",
  referencia: "",
  numMin: "", numMax: "",
  bsMin: "", bsMax: "",
  usdMin: "", usdMax: "",
  netoMin: "", netoMax: "",
  ivaMin: "", ivaMax: "",
  sortKey: "fecha",
  sortDir: "desc",
  pageSize: 50,
});

function usdParaleloVisual(t: any, tasaParalelaFallback?: number | null) {
  const montoBs = Number(t.monto_bs) || 0;
  const tasaParalela = Number(t.tasa_paralela) || 0;
  if (tasaParalela > 0) return montoBs / tasaParalela;
  const fb = Number(tasaParalelaFallback) || 0;
  if (fb > 0) return montoBs / fb;
  return Number(t.monto_usd) || 0;
}

function usdBcvVisual(t: any) {
  const montoBs = Number(t.monto_bs) || 0;
  const tasaBcv = Number(t.tasa_bcv) || 0;
  return tasaBcv > 0 ? montoBs / tasaBcv : null;
}

function loadState(): Partial<FilterState> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function TransaccionesPage() {
  const qc = useQueryClient();

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

  const [state, setState] = useState<FilterState>(() => {
    const saved = loadState();
    const base = defaultState("");
    return saved ? { ...base, ...saved } : base;
  });
  const upd = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  // Persist
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch {}
  }, [state]);

  // Initialize desde on first mount if empty
  useEffect(() => {
    if (!minFechaReady || state.desde) return;
    if (minFecha) upd("desde", minFecha);
    else {
      const d = new Date(); d.setDate(d.getDate() - 30);
      upd("desde", d.toISOString().slice(0, 10));
    }
  }, [minFechaReady, minFecha, state.desde]);

  const {
    desde, hasta, busca, centros, cuentas: cuentasSel, metodos: metodosSel, modos,
    tercero, factura, notas: notasF, referencia, numMin, numMax,
    bsMin, bsMax, usdMin, usdMax, netoMin, netoMax, ivaMin, ivaMax,
    sortKey, sortDir, pageSize,
  } = state;

  // Debounced global search
  const [buscaDebounced, setBuscaDebounced] = useState(busca);
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const [editing, setEditing] = useState<any>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipePwd, setWipePwd] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  useEffect(() => { setPage(0); setSelected(new Set()); }, [
    desde, hasta, buscaDebounced, centros, cuentasSel, metodosSel, modos,
    tercero, factura, notasF, referencia, numMin, numMax,
    bsMin, bsMax, usdMin, usdMax, netoMin, netoMax, ivaMin, ivaMax,
    sortKey, sortDir, pageSize,
  ]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) upd("sortDir", sortDir === "asc" ? "desc" : "asc");
    else { upd("sortKey", k); upd("sortDir", k === "fecha" || k === "numero" ? "desc" : "asc"); }
  };
  const sortArrow = (k: SortKey) => sortKey === k
    ? (sortDir === "asc" ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)
    : null;

  const { data, isLoading } = useQuery({
    enabled: !!desde,
    queryKey: ["transacciones-list", desde, hasta],
    queryFn: async () => {
      return await fetchAllRows<any>(async (from, to) => {
        return await supabase
          .from("transacciones")
          .select("id,numero,fecha,centro_costo,cuenta_codigo,numero_factura,numero_orden,referencia,monto_bs,monto_base_bs,iva_bs,iva_aplica,tasa_bcv,tasa_paralela,monto_usd,metodo_pago,modo,notas,detalle,adjunto_url,created_by,cuenta_bancaria_id,capex_categoria,pareja_off_balance_id,grupo_transaccion_id,tercero_id")
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to);
      });
    },
  });

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-all-list"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo,orden").order("orden");
      return data ?? [];
    },
  });

  const cuentaNombre = useMemo(() => {
    const m: Record<string, string> = {};
    (cuentas ?? []).forEach((c: any) => { m[c.codigo] = c.nombre; });
    return m;
  }, [cuentas]);

  const cuentasByGrupo = useMemo(() => {
    const g: Record<string, any[]> = {};
    (cuentas ?? []).forEach((c: any) => { (g[c.grupo || "Otros"] ||= []).push(c); });
    return g;
  }, [cuentas]);

  const { data: terceros } = useQuery({
    queryKey: ["terceros-lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("id,razon_social,nombre_comercial");
      return data ?? [];
    },
  });
  const terceroById = useMemo(() => {
    const m: Record<string, { razon_social: string; nombre_comercial: string | null }> = {};
    (terceros ?? []).forEach((t: any) => { m[t.id] = t; });
    return m;
  }, [terceros]);

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

  const metodosEnData = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((t: any) => t.metodo_pago && set.add(t.metodo_pago));
    return Array.from(set).sort();
  }, [data]);

  const norm = (v: any) =>
    (v ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const numOr = (s: string): number | null => {
    if (s === "" || s == null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const filtradas = useMemo(() => {
    const s = norm(buscaDebounced.trim());
    const tN = norm(tercero.trim());
    const fN = norm(factura.trim());
    const nN = norm(notasF.trim());
    const rN = norm(referencia.trim());
    const nMin = numOr(numMin), nMax = numOr(numMax);
    const bMin = numOr(bsMin), bMax = numOr(bsMax);
    const uMin = numOr(usdMin), uMax = numOr(usdMax);
    const netMin = numOr(netoMin), netMax = numOr(netoMax);
    const iMin = numOr(ivaMin), iMax = numOr(ivaMax);

    let arr = ((data ?? []) as any[]).filter((t: any) => {
      if (centros.length && !centros.includes(t.centro_costo)) return false;
      if (cuentasSel.length && !cuentasSel.includes(t.cuenta_codigo)) return false;
      if (metodosSel.length && !metodosSel.includes(t.metodo_pago ?? "")) return false;
      if (modos.length && !modos.includes(t.modo)) return false;

      if (tN) {
        const ter = t.tercero_id ? terceroById[t.tercero_id] : null;
        const hit = norm(ter?.razon_social).includes(tN) || norm(ter?.nombre_comercial).includes(tN);
        if (!hit) return false;
      }
      if (fN && !norm(t.numero_factura).includes(fN)) return false;
      if (nN && !norm(t.notas).includes(nN)) return false;
      if (rN && !norm(t.referencia).includes(rN)) return false;

      const num = Number(t.numero) || 0;
      if (nMin != null && num < nMin) return false;
      if (nMax != null && num > nMax) return false;

      const mBs = Number(t.monto_bs) || 0;
      if (bMin != null && mBs < bMin) return false;
      if (bMax != null && mBs > bMax) return false;

      const mUsd = Number(t.monto_usd) || 0;
      if (uMin != null && mUsd < uMin) return false;
      if (uMax != null && mUsd > uMax) return false;

      const baseBs = Number(t.monto_base_bs) || 0;
      if (netMin != null && baseBs < netMin) return false;
      if (netMax != null && baseBs > netMax) return false;

      const ivaBs = Number(t.iva_bs) || 0;
      if (iMin != null && ivaBs < iMin) return false;
      if (iMax != null && ivaBs > iMax) return false;

      if (s) {
        const ter = t.tercero_id ? terceroById[t.tercero_id] : null;
        const hit =
          norm(t.cuenta_codigo).includes(s) ||
          norm(cuentaNombre[t.cuenta_codigo]).includes(s) ||
          norm(ter?.razon_social).includes(s) ||
          norm(ter?.nombre_comercial).includes(s) ||
          norm(t.numero_factura).includes(s) ||
          norm(t.numero_orden).includes(s) ||
          norm(t.referencia).includes(s) ||
          norm(t.notas).includes(s) ||
          norm(t.centro_costo).includes(s) ||
          norm(String(t.numero)).includes(s);
        if (!hit) return false;
      }
      return true;
    });

    arr = [...arr].sort((a: any, b: any) => {
      let av: any, bv: any;
      if (sortKey === "fecha") { av = a.fecha; bv = b.fecha; }
      else if (sortKey === "cuenta_codigo" || sortKey === "centro_costo" || sortKey === "numero_factura") {
        av = (a[sortKey] ?? "").toString(); bv = (b[sortKey] ?? "").toString();
      } else {
        av = Number(a[sortKey]) || 0; bv = Number(b[sortKey]) || 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [data, buscaDebounced, tercero, factura, notasF, referencia, centros, cuentasSel, metodosSel, modos,
      numMin, numMax, bsMin, bsMax, usdMin, usdMax, netoMin, netoMax, ivaMin, ivaMax,
      sortKey, sortDir, cuentaNombre, terceroById]);

  const totales = useMemo(() => {
    const noIva = filtradas.filter((t: any) => t.cuenta_codigo !== "12.4" && t.cuenta_codigo !== "12.5");
    return {
      bs: noIva.reduce((s: number, t: any) => s + (Number(t.monto_bs) || 0), 0),
      usd: noIva.reduce((s: number, t: any) => s + (Number(t.monto_usd) || 0), 0),
      ivaBs: filtradas.filter((t: any) => t.cuenta_codigo === "12.4" || t.cuenta_codigo === "12.5")
        .reduce((s: number, t: any) => s + (Number(t.monto_bs) || 0), 0),
    };
  }, [filtradas]);

  const effectivePageSize = pageSize === "all" ? Math.max(filtradas.length, 1) : pageSize;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filtradas.length / effectivePageSize));
  const paginadas = useMemo(
    () => pageSize === "all" ? filtradas : filtradas.slice(page * effectivePageSize, (page + 1) * effectivePageSize),
    [filtradas, page, pageSize, effectivePageSize]
  );

  const totalRegistros = (data ?? []).length;

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
    const seleccionadas = filtradas.filter((t: any) => selected.has(t.id));
    if (!confirm(`¿Borrar ${seleccionadas.length} transacciones seleccionadas? Se eliminarán también las CxC, CxP, propinas y transacciones vinculadas (off-balance, mismo grupo, venta/cobro contraparte). Esta acción es irreversible.`)) return;
    const { analizarBorradoTransaccion, ejecutarBorradoTransaccion } = await import("@/lib/eliminar-transaccion");
    let okCount = 0;
    const errores: string[] = [];
    for (const t of seleccionadas) {
      try {
        const plan = await analizarBorradoTransaccion(t);
        if (plan.bloqueoMesCerrado) { errores.push(`${t.fecha}: mes cerrado`); continue; }
        if (plan.bloqueoAnticipoAplicado) { errores.push(`${t.id.slice(0,8)}: ${plan.bloqueoAnticipoAplicado}`); continue; }
        const res = await ejecutarBorradoTransaccion(plan);
        if (!res.ok) { errores.push(`${t.id.slice(0,8)}: ${res.error}`); continue; }
        okCount += plan.transacciones.length;
      } catch (e: any) {
        errores.push(`${t.id.slice(0,8)}: ${e?.message ?? "error"}`);
      }
    }
    if (okCount) toast.success(`${okCount} transacción(es) eliminada(s)`);
    if (errores.length) toast.error(`Fallaron ${errores.length}: ${errores.slice(0,3).join(" · ")}${errores.length > 3 ? "…" : ""}`);
    setSelected(new Set());
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
        { header: "#", key: "numero", width: 8 },
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Centro", key: "centro", width: 10 },
        { header: "Código", key: "codigo", width: 10 },
        { header: "Cuenta", key: "cuenta", width: 36 },
        { header: "Proveedor/Cliente", key: "tercero", width: 30 },
        { header: "N° Factura", key: "factura", width: 14 },
        { header: "N° Orden", key: "orden", width: 14 },
        { header: "Referencia", key: "referencia", width: 18 },
        { header: "Monto Bs", key: "bs", width: 16 },
        { header: "Base Bs", key: "base", width: 16 },
        { header: "IVA Bs", key: "iva", width: 14 },
        { header: "Tasa BCV", key: "tasa", width: 12 },
        { header: "Tasa Paralela", key: "tasaPar", width: 14 },
        { header: "Monto USD Paralelo", key: "usd", width: 18 },
        { header: "Monto USD (BCV ref.)", key: "usdBcv", width: 20 },
        { header: "Método", key: "metodo", width: 14 },
        { header: "Modo", key: "modo", width: 12 },
        { header: "Notas", key: "notas", width: 40 },
      ];
      const header = ws.getRow(1);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };

      for (const t of filtradas as any[]) {
        const tasaParRaw = t.tasa_paralela == null ? null : Number(t.tasa_paralela);
        const tieneParalela = tasaParRaw != null && tasaParRaw > 0;
        const montoBs = Number(t.monto_bs) || 0;
        const tasaBcvRaw = Number(t.tasa_bcv) || 0;
        const tieneBcv = tasaBcvRaw > 0;
        const usdParalelo = usdParaleloVisual(t);
        const usdBcv = usdBcvVisual(t);
        const ter = t.tercero_id ? terceroById[t.tercero_id] : null;
        const r = ws.addRow({
          numero: t.numero ?? "",
          fecha: t.fecha,
          centro: t.centro_costo,
          codigo: t.cuenta_codigo,
          cuenta: cuentaNombre[t.cuenta_codigo] ?? "",
          tercero: ter?.razon_social ?? "",
          factura: t.numero_factura ?? "",
          orden: t.numero_orden ?? "",
          referencia: t.referencia ?? "",
          bs: montoBs,
          base: Number(t.monto_base_bs) || 0,
          iva: Number(t.iva_bs) || 0,
          tasa: tasaBcvRaw,
          tasaPar: tieneParalela ? tasaParRaw : "N/A",
          usd: tieneParalela ? usdParalelo : Number(t.monto_usd) || "N/A",
          usdBcv: tieneBcv ? usdBcv : "N/A",
          metodo: t.metodo_pago ?? "",
          modo: t.modo,
          notas: t.notas ?? "",
        });
        ["bs", "base", "iva"].forEach((k) => { r.getCell(k as any).numFmt = '#,##0.00'; });
        r.getCell("tasa" as any).numFmt = '#,##0.0000';
        if (tieneParalela) {
          r.getCell("tasaPar" as any).numFmt = '#,##0.0000';
          r.getCell("usd" as any).numFmt = '"$"#,##0.00';
        }
        if (tieneBcv) r.getCell("usdBcv" as any).numFmt = '"$"#,##0.00';
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transacciones_${desde}_a_${hasta}.xlsx`;
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

  // --- Date range presets
  const applyPreset = (preset: string) => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === "hoy") { upd("desde", iso(today)); upd("hasta", iso(today)); return; }
    if (preset === "semana") {
      const d = new Date(today); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day);
      upd("desde", iso(d)); upd("hasta", iso(today)); return;
    }
    if (preset === "mes") {
      upd("desde", iso(new Date(today.getFullYear(), today.getMonth(), 1)));
      upd("hasta", iso(today)); return;
    }
    if (preset === "mes_anterior") {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 0);
      upd("desde", iso(from)); upd("hasta", iso(to)); return;
    }
    if (preset === "anio") {
      upd("desde", iso(new Date(today.getFullYear(), 0, 1)));
      upd("hasta", iso(today)); return;
    }
    if (preset === "todo") {
      if (minFecha) upd("desde", minFecha);
      upd("hasta", iso(today)); return;
    }
  };

  // --- Chips of active filters
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (buscaDebounced) chips.push({ key: "busca", label: `Buscar: "${buscaDebounced}"`, clear: () => upd("busca", "") });
  centros.forEach((c) => chips.push({ key: `c-${c}`, label: `Centro: ${c}`, clear: () => upd("centros", centros.filter((x) => x !== c)) }));
  cuentasSel.forEach((c) => chips.push({ key: `cu-${c}`, label: `Cuenta: ${c}`, clear: () => upd("cuentas", cuentasSel.filter((x) => x !== c)) }));
  metodosSel.forEach((m) => chips.push({ key: `m-${m}`, label: `Método: ${m}`, clear: () => upd("metodos", metodosSel.filter((x) => x !== m)) }));
  modos.forEach((m) => chips.push({ key: `mo-${m}`, label: `Modo: ${m === "on_balance" ? "on" : "off"}`, clear: () => upd("modos", modos.filter((x) => x !== m)) }));
  if (tercero) chips.push({ key: "ter", label: `Tercero: "${tercero}"`, clear: () => upd("tercero", "") });
  if (factura) chips.push({ key: "fac", label: `Factura: "${factura}"`, clear: () => upd("factura", "") });
  if (notasF) chips.push({ key: "not", label: `Notas: "${notasF}"`, clear: () => upd("notas", "") });
  if (referencia) chips.push({ key: "ref", label: `Ref: "${referencia}"`, clear: () => upd("referencia", "") });
  if (numMin || numMax) chips.push({ key: "num", label: `# ${numMin || "…"}-${numMax || "…"}`, clear: () => { upd("numMin", ""); upd("numMax", ""); } });
  if (bsMin || bsMax) chips.push({ key: "bs", label: `Bs ${bsMin || "…"}-${bsMax || "…"}`, clear: () => { upd("bsMin", ""); upd("bsMax", ""); } });
  if (usdMin || usdMax) chips.push({ key: "usd", label: `USD ${usdMin || "…"}-${usdMax || "…"}`, clear: () => { upd("usdMin", ""); upd("usdMax", ""); } });
  if (netoMin || netoMax) chips.push({ key: "neto", label: `Neto Bs ${netoMin || "…"}-${netoMax || "…"}`, clear: () => { upd("netoMin", ""); upd("netoMax", ""); } });
  if (ivaMin || ivaMax) chips.push({ key: "iva", label: `IVA Bs ${ivaMin || "…"}-${ivaMax || "…"}`, clear: () => { upd("ivaMin", ""); upd("ivaMax", ""); } });

  const clearAll = () => {
    setState((s) => ({
      ...s,
      busca: "", centros: [], cuentas: [], metodos: [], modos: [],
      tercero: "", factura: "", notas: "", referencia: "",
      numMin: "", numMax: "", bsMin: "", bsMax: "", usdMin: "", usdMax: "",
      netoMin: "", netoMax: "", ivaMin: "", ivaMax: "",
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transacciones</h1>
        <div className="mt-1"><UsdRateBadge /></div>
        <p className="text-sm text-muted-foreground">Lista de movimientos registrados — editar o eliminar</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Desde</Label>
              <Input type="date" value={desde} onChange={(e) => upd("desde", e.target.value)} />
            </div>
            <div>
              <Label>Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => upd("hasta", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Rango rápido</Label>
              <div className="flex flex-wrap gap-1">
                {[
                  ["hoy", "Hoy"], ["semana", "Esta semana"], ["mes", "Este mes"],
                  ["mes_anterior", "Mes anterior"], ["anio", "Este año"], ["todo", "Todo"],
                ].map(([k, l]) => (
                  <Button key={k} type="button" variant="outline" size="sm" onClick={() => applyPreset(k)}>{l}</Button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label>Búsqueda global</Label>
            <Input
              placeholder="Busca en cuenta, tercero, factura, notas, referencia, centro, #…"
              value={busca}
              onChange={(e) => upd("busca", e.target.value)}
            />
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <Badge key={c.key} variant="secondary" className="gap-1 pr-1">
                  {c.label}
                  <button
                    type="button"
                    onClick={c.clear}
                    className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
                    aria-label="Quitar filtro"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button variant="ghost" size="sm" onClick={clearAll} className="h-6 text-xs">
                Limpiar todos
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {isLoading
                ? "Cargando…"
                : `Mostrando ${filtradas.length.toLocaleString()} de ${totalRegistros.toLocaleString()} transacciones`}
              {pageSize !== "all" && filtradas.length > effectivePageSize && (
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  · página {page + 1} de {totalPages}
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs">
                <Label className="text-xs whitespace-nowrap">Por página</Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => upd("pageSize", v === "all" ? "all" : Number(v))}
                >
                  <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="250">250</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="all">Todas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
          {(centros.length || cuentasSel.length || metodosSel.length || modos.length) > 0 && (
            <div className="mb-3 flex flex-wrap gap-3 text-sm rounded-md bg-muted/40 p-2 border">
              <span className="text-xs text-muted-foreground self-center">Totales del filtro (sin IVA):</span>
              <span className="mono font-semibold">{fmtBs(totales.bs)}</span>
              <span className="mono font-semibold">{fmtUsd(totales.usd)}</span>
              {totales.ivaBs > 0 && (
                <span className="mono text-xs text-muted-foreground self-center">+ IVA legs {fmtBs(totales.ivaBs)}</span>
              )}
            </div>
          )}

          {filtradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos que coincidan con los filtros.</p>
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
                    <ThSort onClick={() => toggleSort("numero")} arrow={sortArrow("numero")}>
                      #
                      <RangeFilter
                        min={numMin} max={numMax}
                        onChange={(mn, mx) => { upd("numMin", mn); upd("numMax", mx); }}
                        label="Rango de número"
                      />
                    </ThSort>
                    <ThSort onClick={() => toggleSort("fecha")} arrow={sortArrow("fecha")}>Fecha</ThSort>
                    <ThSort onClick={() => toggleSort("centro_costo")} arrow={sortArrow("centro_costo")}>
                      Centro
                      <MultiSelectFilter
                        options={CENTROS.map((c) => ({ value: c, label: c }))}
                        selected={centros}
                        onChange={(v) => upd("centros", v)}
                        label="Centro"
                      />
                    </ThSort>
                    <ThSort onClick={() => toggleSort("cuenta_codigo")} arrow={sortArrow("cuenta_codigo")}>
                      Cuenta
                      <MultiSelectFilter
                        groupedOptions={Object.entries(cuentasByGrupo).map(([grupo, items]) => ({
                          group: grupo,
                          items: items.map((c: any) => ({ value: c.codigo, label: `${c.codigo} — ${c.nombre}` })),
                        }))}
                        selected={cuentasSel}
                        onChange={(v) => upd("cuentas", v)}
                        label="Cuenta"
                      />
                    </ThSort>
                    <ThSort onClick={() => toggleSort("numero_factura")} arrow={sortArrow("numero_factura")}>
                      Factura
                      <TextFilter value={factura} onChange={(v) => upd("factura", v)} label="Contiene" />
                    </ThSort>
                    <th className="text-left py-2 px-2">
                      Proveedor/Cliente
                      <TextFilter value={tercero} onChange={(v) => upd("tercero", v)} label="Razón social contiene" />
                    </th>
                    <ThSort onClick={() => toggleSort("monto_bs")} arrow={sortArrow("monto_bs")} align="right">
                      Bs
                      <RangeFilter
                        min={bsMin} max={bsMax}
                        onChange={(mn, mx) => { upd("bsMin", mn); upd("bsMax", mx); }}
                        label="Rango de Bs (total)"
                      />
                      <div className="text-[10px] font-normal text-muted-foreground flex gap-2 mt-0.5">
                        <RangeFilter
                          min={netoMin} max={netoMax}
                          onChange={(mn, mx) => { upd("netoMin", mn); upd("netoMax", mx); }}
                          label="Rango de neto Bs"
                          triggerLabel="Neto"
                        />
                        <RangeFilter
                          min={ivaMin} max={ivaMax}
                          onChange={(mn, mx) => { upd("ivaMin", mn); upd("ivaMax", mx); }}
                          label="Rango de IVA Bs"
                          triggerLabel="IVA"
                        />
                      </div>
                    </ThSort>
                    <ThSort onClick={() => toggleSort("monto_usd")} arrow={sortArrow("monto_usd")} align="right"
                            title="USD calculado a tasa paralela. Neto sin IVA; el + IVA aparece debajo cuando aplica.">
                      USD paralelo
                      <RangeFilter
                        min={usdMin} max={usdMax}
                        onChange={(mn, mx) => { upd("usdMin", mn); upd("usdMax", mx); }}
                        label="Rango de USD"
                      />
                    </ThSort>
                    <th className="text-right py-2 px-2" title="USD calculado a tasa BCV — solo referencia">USD (BCV)</th>
                    <th className="text-left py-2 px-2">
                      Método
                      <MultiSelectFilter
                        options={Array.from(new Set([...METODOS, ...metodosEnData])).map((m) => ({ value: m, label: m }))}
                        selected={metodosSel}
                        onChange={(v) => upd("metodos", v)}
                        label="Método"
                      />
                    </th>
                    <th className="text-left py-2 px-2">
                      Modo
                      <MultiSelectFilter
                        options={[{ value: "on_balance", label: "on balance" }, { value: "off_balance", label: "off balance" }]}
                        selected={modos}
                        onChange={(v) => upd("modos", v)}
                        label="Modo"
                      />
                    </th>
                    <th className="text-left py-2 px-2">
                      Referencia
                      <TextFilter value={referencia} onChange={(v) => upd("referencia", v)} label="Contiene" />
                    </th>
                    <th className="text-left py-2 px-2">
                      Notas
                      <TextFilter value={notasF} onChange={(v) => upd("notas", v)} label="Contiene" />
                    </th>
                    <th className="text-center py-2 px-2">Adj.</th>
                    <th className="text-left py-2 px-2">Registrado por</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginadas.map((t: any) => {
                    const totalBs = Number(t.monto_bs) || 0;
                    const totalUsdParalelo = usdParaleloVisual(t);
                    const bcvUsdTotal = usdBcvVisual(t);
                    const ivaBs = Number(t.iva_bs) || 0;
                    const baseBs = Number(t.monto_base_bs) || 0;
                    const showSplit = ivaBs > 0 && baseBs > 0 && totalBs > 0;
                    const totalUsd = totalUsdParalelo;
                    const netoUsd = showSplit ? totalUsd * (baseBs / totalBs) : totalUsd;
                    const ivaUsd = showSplit ? Math.max(0, totalUsd - netoUsd) : 0;
                    const ter = t.tercero_id ? terceroById[t.tercero_id] : null;
                    return (
                      <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 px-2">
                          <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSel(t.id)} />
                        </td>
                        <td className="py-2 px-2 mono text-xs text-muted-foreground">{t.numero ?? "—"}</td>
                        <td className="py-2 px-2 mono whitespace-nowrap">{fmtDate(t.fecha)}</td>
                        <td className="py-2 px-2">{t.centro_costo}</td>
                        <td className="py-2 px-2">
                          <div className="mono text-xs flex items-center gap-1.5">
                            {t.cuenta_codigo}
                            {t.cuenta_codigo === "13.1" && (
                              <Badge className="text-[9px] bg-purple-100 text-purple-800 hover:bg-purple-100 border-purple-300">Propina</Badge>
                            )}
                            {typeof t.notas === "string" && t.notas.startsWith("Pago CxP") && (
                              <Badge className="text-[9px] bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-300">Pago CxP</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{cuentaNombre[t.cuenta_codigo] ?? ""}</div>
                        </td>
                        <td className="py-2 px-2 mono text-xs">{t.numero_factura ?? "—"}</td>
                        <td className="py-2 px-2 text-xs truncate max-w-[200px]" title={ter?.razon_social ?? ""}>
                          {ter?.razon_social ?? "—"}
                        </td>
                        <td className="py-2 px-2 text-right mono">
                          {showSplit ? (
                            <div className="leading-tight">
                              <div>{fmtBs(baseBs)}</div>
                              <div className="text-[10px] text-muted-foreground font-normal">+ IVA {fmtBs(ivaBs)}</div>
                            </div>
                          ) : fmtBs(totalBs)}
                        </td>
                        <td className="py-2 px-2 text-right mono">
                          {showSplit ? (
                            <div className="leading-tight">
                              <div>{fmtUsd(netoUsd)}</div>
                              <div className="text-[10px] text-muted-foreground font-normal">+ IVA {fmtUsd(ivaUsd)}</div>
                            </div>
                          ) : fmtUsd(totalUsd)}
                        </td>
                        <td className="py-2 px-2 text-right mono text-muted-foreground">
                          {bcvUsdTotal == null ? "—" : fmtUsd(bcvUsdTotal)}
                        </td>
                        <td className="py-2 px-2 text-xs">{t.metodo_pago ?? "—"}</td>
                        <td className="py-2 px-2">
                          {t.modo === "off_balance"
                            ? <Badge variant="outline" className="text-[10px]">off</Badge>
                            : <Badge className="text-[10px]">on</Badge>}
                        </td>
                        <td className="py-2 px-2 text-xs truncate max-w-[140px]" title={t.referencia ?? ""}>{t.referencia ?? "—"}</td>
                        <td className="py-2 px-2 text-xs truncate max-w-[220px]" title={t.notas ?? ""}>{t.notas ?? "—"}</td>
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
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(t)} title="Editar">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteTarget(t)} title="Eliminar">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pageSize !== "all" && totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    Mostrando {page * effectivePageSize + 1}–{Math.min((page + 1) * effectivePageSize, filtradas.length)} de {filtradas.length}
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

      <EliminarTransaccionDialog
        open={!!deleteTarget}
        transaccion={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => qc.invalidateQueries()}
      />

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
            <Input type="password" value={wipePwd} onChange={(e) => setWipePwd(e.target.value)}
                   placeholder="Contraseña de la página" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setWipeOpen(false); setWipePwd(""); }} disabled={wipeBusy}>Cancelar</Button>
            <Button variant="destructive" onClick={borrarTodo} disabled={wipeBusy || !wipePwd}>
              {wipeBusy ? "Borrando…" : "Sí, borrar todo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ========== Header helpers ==========
function ThSort({
  children, onClick, arrow, align = "left", title,
}: { children: React.ReactNode; onClick: () => void; arrow: React.ReactNode; align?: "left" | "right"; title?: string }) {
  return (
    <th className={`py-2 px-2 ${align === "right" ? "text-right" : "text-left"}`} title={title}>
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        <button type="button" onClick={onClick} className="hover:text-foreground inline-flex items-center">
          {children}
          {arrow}
        </button>
      </div>
    </th>
  );
}

function TextFilter({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`ml-1 inline-flex items-center rounded p-0.5 hover:bg-muted ${value ? "text-primary" : "text-muted-foreground"}`}
          aria-label="Filtrar"
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 pointer-events-auto" align="start">
        <Label className="text-xs">{label}</Label>
        <Input className="mt-1" value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
        {value && (
          <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => onChange("")}>Limpiar</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RangeFilter({
  min, max, onChange, label, triggerLabel,
}: {
  min: string; max: string;
  onChange: (min: string, max: string) => void;
  label: string;
  triggerLabel?: string;
}) {
  const active = min !== "" || max !== "";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`ml-1 inline-flex items-center gap-0.5 rounded p-0.5 hover:bg-muted ${active ? "text-primary" : "text-muted-foreground"}`}
          aria-label="Filtrar rango"
        >
          {triggerLabel && <span className="text-[10px]">{triggerLabel}</span>}
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 pointer-events-auto" align="start">
        <Label className="text-xs">{label}</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <Input placeholder="Desde" value={min} onChange={(e) => onChange(e.target.value, max)} type="number" />
          <Input placeholder="Hasta" value={max} onChange={(e) => onChange(min, e.target.value)} type="number" />
        </div>
        {active && (
          <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => onChange("", "")}>Limpiar</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

type OptionItem = { value: string; label: string };
function MultiSelectFilter({
  options, groupedOptions, selected, onChange, label,
}: {
  options?: OptionItem[];
  groupedOptions?: { group: string; items: OptionItem[] }[];
  selected: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const active = selected.length > 0;
  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter((x) => x !== val) : [...selected, val]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`ml-1 inline-flex items-center rounded p-0.5 hover:bg-muted ${active ? "text-primary" : "text-muted-foreground"}`}
          aria-label="Filtrar"
        >
          <Filter className="h-3 w-3" />
          {active && <span className="text-[10px] ml-0.5">{selected.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 pointer-events-auto" align="start">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">{label}</Label>
          {active && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([])}>Limpiar</Button>
          )}
        </div>
        <ScrollArea className="h-64">
          <div className="space-y-1 pr-2">
            {options?.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {groupedOptions?.map((g) => (
              <div key={g.group}>
                <div className="text-[10px] uppercase text-muted-foreground mt-2 mb-0.5 px-1">{g.group}</div>
                {g.items.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                    <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
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

  // Hermanos del grupo: se cargan al abrir el diálogo.
  const [hermanos, setHermanos] = useState<any[]>([]);
  const [propagar, setPropagar] = useState(true);
  useEffect(() => {
    if (!tx.grupo_transaccion_id) { setHermanos([]); return; }
    (async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, cuenta_codigo, centro_costo, monto_bs, monto_usd, tasa_bcv, tasa_paralela")
        .eq("grupo_transaccion_id", tx.grupo_transaccion_id)
        .neq("id", tx.id);
      setHermanos(data ?? []);
    })();
  }, [tx.id, tx.grupo_transaccion_id]);

  const usdN = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  // Bs se recalcula desde USD usando la tasa paralela registrada (o BCV como fallback).
  const tasaParalelaN = Number(tx.tasa_paralela) || 0;
  const tasaConvN = tasaParalelaN || tasaN;
  const baseUsd = tx.iva_aplica ? usdN / 1.16 : usdN;
  const total = usdN * tasaConvN;            // monto Bs total (con IVA si aplica)
  const base = baseUsd * tasaConvN;          // base Bs sin IVA
  const iva = tx.iva_aplica ? total - base : 0;

  // Detecta qué campos de propagación cambiaron respecto al original.
  const fechaCambio = fecha !== tx.fecha;
  const centroCambio = centro !== tx.centro_costo;
  const tasaCambio = tasaN !== Number(tx.tasa_bcv ?? 0);

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
    if (error) { setBusy(false); return toast.error(error.message); }
    if (updated) await logAudit("transacciones", "UPDATE", tx.id, tx, updated);

    // Propagación a hermanos del grupo (solo campos seguros: fecha, centro, tasas).
    let propagados = 0;
    if (propagar && hermanos.length > 0 && (fechaCambio || centroCambio || tasaCambio)) {
      // Validar mes cerrado en la fecha destino de los hermanos (usan la nueva fecha si se propaga).
      const fechaDestino = fechaCambio ? fecha : null;
      if (fechaDestino && await isPeriodClosed(fechaDestino)) {
        toast.warning("La nueva fecha cae en un mes cerrado — se guardó la transacción pero no se propagó al grupo.");
      } else {
        for (const h of hermanos) {
          const hPatch: any = {};
          if (fechaCambio) hPatch.fecha = fecha;
          if (centroCambio) hPatch.centro_costo = centro;
          if (tasaCambio) {
            hPatch.tasa_bcv = tasaN;
            // Recalcular monto_usd del hermano preservando su monto_bs.
            const hBs = Number(h.monto_bs) || 0;
            const hTasaPar = Number(h.tasa_paralela) || 0;
            const conv = hTasaPar || tasaN;
            if (conv > 0) hPatch.monto_usd = +(hBs / conv).toFixed(2);
          }
          const { error: eH } = await supabase
            .from("transacciones")
            .update(hPatch)
            .eq("id", h.id);
          if (!eH) {
            await logAudit("transacciones", "UPDATE", h.id, h, { ...h, ...hPatch });
            propagados++;
          }
        }
      }
    }
    setBusy(false);
    toast.success(
      propagados > 0
        ? `Movimiento actualizado · ${propagados} transacción(es) del grupo propagadas`
        : "Movimiento actualizado",
    );
    onSaved();
  };


  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar movimiento — {tx.cuenta_codigo}</DialogTitle>
        </DialogHeader>
        {hermanos.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
            <div className="font-medium text-foreground">
              Esta transacción tiene {hermanos.length} transacción{hermanos.length === 1 ? "" : "es"} relacionada{hermanos.length === 1 ? "" : "s"} en el mismo grupo:
            </div>
            <ul className="space-y-0.5 max-h-24 overflow-auto">
              {hermanos.map((h) => (
                <li key={h.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{h.cuenta_codigo}</Badge>
                  <span className="text-muted-foreground">{fmtDate(h.fecha)}</span>
                  <span className="mono">{fmtUsd(Number(h.monto_usd) || 0)}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <Checkbox
                checked={propagar}
                onCheckedChange={(v) => setPropagar(v === true)}
                className="mt-0.5"
              />
              <span className="text-foreground">
                Propagar cambios de <b>fecha</b>, <b>centro</b> y <b>tasa</b> a las {hermanos.length} transacción{hermanos.length === 1 ? "" : "es"} relacionada{hermanos.length === 1 ? "" : "s"}.
                <span className="block text-muted-foreground text-[11px] mt-0.5">
                  Los cambios de monto no se propagan automáticamente — si editas IVA, bono o propina hazlo en su registro.
                </span>
              </span>
            </label>
          </div>
        )}
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
