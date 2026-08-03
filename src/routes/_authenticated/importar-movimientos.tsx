import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { readSheetAOA, numFromCell, parseDateCell } from "@/lib/xetux-parse";
import { MesCerradoProvider, useMesCerradoGuard } from "@/lib/mes-cerrado-guard";
import { logAudit } from "@/lib/audit";
import { SIN_FACTURA_PREFIX, huellaBancaria } from "@/lib/conciliacion";

export const Route = createFileRoute("/_authenticated/importar-movimientos")({
  component: ImportarMovimientos,
});

const CUENTA_PAGO_CXP = "13.2";

// Mapa Categoría → cuenta del plan (fallback cuando el archivo no trae cuenta sugerida)
const CATEGORIA_CUENTA: Record<string, string> = {
  INV: "2.1",
  ADM: "4.8",
  MO: "3.16",
  OC: "5.6",
  MERCADEO: "6.2",
  INVERSION: "10.6",
};

type BankRow = {
  id: string;
  fecha: string;
  mes: string;
  bancoRaw: string;
  banco: string;
  referencia: string;
  concepto: string;
  montoBs: number;
  montoUsd: number;
  categoria: string;
  cuentaBancariaId: string | null;
  moneda: "Bs" | "USD";
  huella: string;
};

type CxPRow = {
  id: string;
  proveedor: string;
  numero_factura: string | null;
  monto_bs: number;
  monto_pendiente_bs: number | null;
  monto_pendiente_usd_bcv: number | null;
  usd_bcv_factura: number | null;
  tasa_bcv_factura: number | null;
  tasa_paralela_factura: number | null;
  estado: string;
  transaccion_id: string | null;
  centro_costo: string;
  tercero_id: string | null;
};

type Match = {
  bankRow: BankRow;
  /** Facturas cubiertas por este movimiento, en orden de aplicación. */
  cxps: CxPRow[];
  manual: boolean;
  selected: boolean;
  montoBs: number;
  cuentaCodigo: string | null;
  duplicado: boolean;
};

const pendienteBs = (c: CxPRow) => Number(c.monto_pendiente_bs ?? c.monto_bs) || 0;
const pendienteUsdBcv = (c: CxPRow) => Number(c.monto_pendiente_usd_bcv ?? c.usd_bcv_factura ?? 0) || 0;

function ImportarMovimientos() {
  return (
    <MesCerradoProvider>
      <ImportarMovimientosInner />
    </MesCerradoProvider>
  );
}

function ImportarMovimientosInner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const ensurePeriodoAbierto = useMesCerradoGuard();

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<BankRow[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [visibleCount, setVisibleCount] = useState(150);

  const { data: banks } = useQuery({
    queryKey: ["cuentas-bancarias-activas"],
    queryFn: async () => {
      const { data } = await supabase.from("cuentas_bancarias").select("*").eq("activa", true).order("nombre");
      return (data ?? []) as any[];
    },
  });

  const { data: plan } = useQuery({
    queryKey: ["plan-de-cuentas-activas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo, nombre, grupo").eq("activa", true).order("orden");
      return (data ?? []) as { codigo: string; nombre: string; grupo: string }[];
    },
  });

  const { data: cxpData } = useQuery({
    queryKey: ["cxp-pendientes-import"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cuentas_por_pagar")
        .select("*")
        .neq("estado", "pagada")
        .order("created_at", { ascending: true });
      return (data ?? []) as CxPRow[];
    },
  });

  const bankOptions = useMemo(() => banks ?? [], [banks]);
  const cxpOptions = useMemo(() => cxpData ?? [], [cxpData]);
  const planOptions = useMemo(() => plan ?? [], [plan]);
  const planCodes = useMemo(() => new Set(planOptions.map((p) => p.codigo)), [planOptions]);

  const normalizeBank = (raw: string) => {
    const s = String(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
    // Fuzzy mapping: typos are common
    if (s.includes("bcv") || s.includes("venezuela") || s.includes("bvc")) return "BVC";
    if (s.includes("bofa") || s.includes("america") || s.includes("bankofamerica")) return "BOFA";
    if (s.includes("merc") || s.includes("mercantil")) return "Mercantil";
    if (s.includes("bancamiga") || s.includes("bam") || s.includes("ba") || s.includes("banca")) return "Bancamiga";
    if (s.includes("cash") || s.includes("efectivo") || s.includes("caja")) return "Cash";
    return raw;
  };

  const findBankAccount = (banco: string) => {
    const norm = normalizeBank(banco);
    const byName = bankOptions.find((b) => b.nombre.toLowerCase().includes(norm.toLowerCase()) || norm.toLowerCase().includes(b.nombre.toLowerCase()));
    if (byName) return byName;
    const byBank = bankOptions.find((b) => b.banco.toLowerCase().includes(norm.toLowerCase()) || norm.toLowerCase().includes(b.banco.toLowerCase()));
    return byBank ?? null;
  };

  const extractInvoiceNumbers = (text: string) => {
    const clean = String(text).replace(/[^A-Za-z0-9\-]/g, " ");
    // Common patterns: 001-123456, A12345, INV123, etc.
    const matches = clean.match(/\b[A-Za-z]{0,3}\d[\w\-]*\b/g) ?? [];
    return matches.filter((m) => /\d/.test(m)).map((m) => m.toUpperCase().replace(/^0+/, ""));
  };

  // Extrae "2.1" de "2.1 — Compras de mercancía" o de "2.1"
  const parseCuentaCodigo = (raw: unknown): string | null => {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const m = s.match(/^\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const code = m[1];
    return planCodes.size === 0 || planCodes.has(code) ? code : null;
  };

  const cuentaDesdeCategoria = (categoria: string): string | null => {
    const key = String(categoria ?? "").trim().toUpperCase();
    return CATEGORIA_CUENTA[key] ?? null;
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    try {
      const aoa = await readSheetAOA(file);
      if (aoa.length < 2) return toast.error("El archivo no tiene filas de datos");
      const header = aoa[0].map((h) => String(h ?? "").toLowerCase().trim());
      const idx = (name: string) => header.findIndex((h) => h.includes(name));
      const idxBanco = idx("banco");
      const idxFecha = idx("fecha");
      const idxRef = idx("referencia") >= 0 ? idx("referencia") : idx("n°") >= 0 ? idx("n°") : idx("numero");
      const idxConcepto = idx("concepto") >= 0 ? idx("concepto") : idx("descripcion");
      const idxBs = idx("monto bs") >= 0 ? idx("monto bs") : idx("bs");
      const idxUsd = idx("monto usd") >= 0 ? idx("monto usd") : idx("usd");
      const idxCat = idx("categoria") >= 0 ? idx("categoria") : idx("categoría");
      const idxMes = idx("mes") >= 0 ? idx("mes") : -1;
      const idxSug = header.findIndex((h) => h.includes("sugerida"));
      const idxCuentaPlan = header.findIndex((h) => h.includes("cuenta plan"));

      if (idxFecha < 0 || idxConcepto < 0 || (idxBs < 0 && idxUsd < 0)) {
        return toast.error("Columnas requeridas no encontradas: Fecha, Concepto, Monto Bs/USD");
      }

      const parsed: BankRow[] = [];
      const cuentaPorFila: (string | null)[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i];
        const fecha = parseDateCell(row[idxFecha]);
        if (!fecha) continue;
        const bancoRaw = String(row[idxBanco] ?? "").trim();
        if (!bancoRaw) continue;
        const montoBs = idxBs >= 0 ? numFromCell(row[idxBs]) : 0;
        const montoUsd = idxUsd >= 0 ? numFromCell(row[idxUsd]) : 0;
        const monto = Math.abs(montoBs) > 0 ? -Math.abs(montoBs) : -Math.abs(montoUsd);
        const moneda = Math.abs(montoBs) > 0 ? "Bs" : "USD";
        const bankAccount = findBankAccount(bancoRaw);
        const cuentaBancariaId = bankAccount ? bankAccount.id : null;
        const categoria = idxCat >= 0 ? String(row[idxCat] ?? "") : "";
        const banco = normalizeBank(bancoRaw);
        const referencia = idxRef >= 0 ? String(row[idxRef] ?? "") : "";

        cuentaPorFila.push(
          (idxSug >= 0 ? parseCuentaCodigo(row[idxSug]) : null) ??
            (idxCuentaPlan >= 0 ? parseCuentaCodigo(row[idxCuentaPlan]) : null) ??
            cuentaDesdeCategoria(categoria)
        );

        parsed.push({
          id: crypto.randomUUID(),
          fecha,
          mes: idxMes >= 0 ? String(row[idxMes] ?? "") : "",
          bancoRaw,
          banco,
          referencia,
          concepto: String(row[idxConcepto] ?? ""),
          montoBs: moneda === "Bs" ? monto : 0,
          montoUsd: moneda === "USD" ? monto : 0,
          categoria,
          cuentaBancariaId,
          moneda,
          huella: huellaBancaria({ banco, fecha, referencia, monto: Math.abs(monto) }),
        });
      }
      setRows(parsed);

      // Auto-match (indexado: evita O(filas × CxP) con regex por par)
      const norm = (s: string) => s.toUpperCase().replace(/^0+/, "");
      const index = new Map<string, CxPRow[]>();
      for (const c of cxpOptions) {
        if (!c.numero_factura) continue;
        const key = norm(c.numero_factura);
        if (!key) continue;
        const list = index.get(key);
        if (list) list.push(c); else index.set(key, [c]);
      }

      // Anti-duplicados: huellas ya registradas en transacciones
      const huellas = Array.from(new Set(parsed.map((p) => p.huella)));
      const yaImportadas = new Set<string>();
      for (let i = 0; i < huellas.length; i += 200) {
        const chunk = huellas.slice(i, i + 200);
        const { data } = await supabase.from("transacciones").select("referencia").in("referencia", chunk);
        for (const r of data ?? []) if ((r as any).referencia) yaImportadas.add((r as any).referencia);
      }
      const vistas = new Set<string>();

      const initialMatches: Match[] = parsed.map((bankRow, i) => {
        const invs = extractInvoiceNumbers(bankRow.concepto + " " + bankRow.referencia);
        const found: CxPRow[] = [];
        for (const inv of invs) {
          const hit = index.get(inv);
          if (hit) found.push(...hit);
        }
        const uniq = Array.from(new Set(found));
        const best = uniq.length === 1 ? uniq[0] : null;
        const duplicado = yaImportadas.has(bankRow.huella) || vistas.has(bankRow.huella);
        vistas.add(bankRow.huella);
        const cuentaCodigo = cuentaPorFila[i] ?? null;
        return {
          bankRow,
          cxps: best ? [best] : [],
          manual: false,
          selected: !duplicado && (!!best || !!cuentaCodigo),
          montoBs: Math.abs(bankRow.montoBs || bankRow.montoUsd * 1),
          cuentaCodigo,
          duplicado,
        };
      });
      setMatches(initialMatches);

      const dups = initialMatches.filter((m) => m.duplicado).length;
      toast.success(`${parsed.length} movimientos cargados${dups ? ` · ${dups} ya importados` : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Error leyendo archivo");
    }
  };

  /** Reemplaza la factura principal (primera) del movimiento. */
  const setMatchCxp = (bankRowId: string, cxpId: string | null) => {
    setMatches((prev) =>
      prev.map((m) => {
        if (m.bankRow.id !== bankRowId) return m;
        const cxp = cxpId ? cxpOptions.find((c) => c.id === cxpId) ?? null : null;
        const cxps = cxp ? [cxp] : [];
        return { ...m, cxps, manual: true, selected: !m.duplicado && (cxps.length > 0 || !!m.cuentaCodigo) };
      })
    );
  };

  /** Agrega otra factura del mismo proveedor al mismo movimiento. */
  const addMatchCxp = (bankRowId: string, cxpId: string) => {
    setMatches((prev) =>
      prev.map((m) => {
        if (m.bankRow.id !== bankRowId) return m;
        if (m.cxps.some((c) => c.id === cxpId)) return m;
        const cxp = cxpOptions.find((c) => c.id === cxpId);
        if (!cxp) return m;
        return { ...m, cxps: [...m.cxps, cxp], manual: true };
      })
    );
  };

  const removeMatchCxp = (bankRowId: string, cxpId: string) => {
    setMatches((prev) =>
      prev.map((m) => {
        if (m.bankRow.id !== bankRowId) return m;
        const cxps = m.cxps.filter((c) => c.id !== cxpId);
        return { ...m, cxps, manual: true, selected: !m.duplicado && (cxps.length > 0 || !!m.cuentaCodigo) };
      })
    );
  };


  const setMatchCuenta = (bankRowId: string, codigo: string | null) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.bankRow.id === bankRowId
          ? { ...m, cuentaCodigo: codigo, selected: m.duplicado ? false : m.selected || !!codigo }
          : m
      )
    );
  };

  const setMatchSelected = (bankRowId: string, selected: boolean) => {
    setMatches((prev) => prev.map((m) => (m.bankRow.id === bankRowId ? { ...m, selected } : m)));
  };

  const setMatchBankAccount = (bankRowId: string, cuentaId: string) => {
    setRows((prev) => prev.map((r) => (r.id === bankRowId ? { ...r, cuentaBancariaId: cuentaId || null } : r)));
    setMatches((prev) => prev.map((m) => (m.bankRow.id === bankRowId ? { ...m, bankRow: { ...m.bankRow, cuentaBancariaId: cuentaId || null } } : m)));
  };

  const getRatesForDate = async (fecha: string) => {
    const { data: bcv } = await supabase.from("tasas_bcv").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
    const { data: par } = await supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
    return { bcv: Number(bcv?.tasa ?? 0), paralela: Number(par?.tasa ?? 0) };
  };

  const importable = (m: Match) =>
    m.selected && !m.duplicado && !!m.bankRow.cuentaBancariaId && (!!m.cxp || !!m.cuentaCodigo);

  const confirmar = async () => {
    if (!user) return;
    const toImport = matches.filter(importable);
    if (toImport.length === 0) return toast.error("Selecciona al menos un movimiento con cuenta bancaria y CxP o cuenta contable");

    const firstFecha = toImport[0]?.bankRow.fecha;
    if (firstFecha) {
      const canContinue = await ensurePeriodoAbierto(firstFecha);
      if (!canContinue) return;
    }

    setBusy(true);
    setProgress({ done: 0, total: toImport.length });
    let ok = 0, fail = 0, partial = 0, sinFactura = 0;
    const importados = new Set<string>();

    for (const m of toImport) {
      try {
        const bankRow = m.bankRow;
        const rates = await getRatesForDate(bankRow.fecha);
        const montoBs = Math.abs(bankRow.montoBs || bankRow.montoUsd * (rates.paralela || rates.bcv || 1));
        const montoUsd = rates.paralela > 0 ? +(montoBs / rates.paralela).toFixed(2) : (rates.bcv > 0 ? +(montoBs / rates.bcv).toFixed(2) : 0);

        if (!m.cxp) {
          // ── Movimiento sin factura en Xetux: se registra contra su cuenta contable ──
          const { data: tx, error } = await supabase.from("transacciones").insert({
            fecha: bankRow.fecha,
            cuenta_codigo: m.cuentaCodigo!,
            centro_costo: "Compartido" as any,
            monto_bs: montoBs,
            monto_base_bs: montoBs,
            iva_bs: 0,
            iva_aplica: false,
            tipo_iva: null,
            tasa_bcv: rates.bcv || null,
            tasa_paralela: rates.paralela || null,
            monto_usd: montoUsd,
            metodo_pago: "transferencia" as any,
            referencia: bankRow.huella,
            detalle: `${SIN_FACTURA_PREFIX} · ${bankRow.concepto}`.slice(0, 255),
            notas: `Conciliación bancaria sin factura · ${bankRow.banco} · Ref ${bankRow.referencia || "—"} · ${bankRow.concepto}`.slice(0, 255),
            modo: "on_balance" as any,
            cuenta_bancaria_id: bankRow.cuentaBancariaId,
            grupo_transaccion_id: crypto.randomUUID(),
            created_by: user.id,
          } as any).select().single();

          if (error) throw new Error(error.message);
          if (tx) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);
          sinFactura++;
          importados.add(bankRow.id);
          setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
          continue;
        }

        const cxp = m.cxp;

        const { data: txOrig } = await supabase
          .from("transacciones")
          .select("centro_costo, grupo_transaccion_id")
          .eq("id", cxp.transaccion_id ?? "")
          .maybeSingle();
        const grupoId = txOrig?.grupo_transaccion_id ?? crypto.randomUUID();

        const { calcularSplitIvaPagoCxp } = await import("@/lib/iva-helpers");
        const { data: ivaLegs } = await supabase
          .from("transacciones")
          .select("id")
          .eq("grupo_transaccion_id", grupoId)
          .eq("cuenta_codigo", "12.5")
          .gt("monto_bs", 0)
          .limit(1);
        const hasIva = (ivaLegs?.length ?? 0) > 0;
        const split = await calcularSplitIvaPagoCxp(grupoId, montoBs, hasIva);

        const { data: tx, error } = await supabase.from("transacciones").insert({
          fecha: bankRow.fecha,
          cuenta_codigo: CUENTA_PAGO_CXP,
          centro_costo: (txOrig?.centro_costo ?? cxp.centro_costo ?? "Compartido") as any,
          monto_bs: montoBs,
          monto_base_bs: split.monto_base_bs,
          iva_bs: split.iva_bs,
          iva_aplica: split.iva_bs > 0,
          tipo_iva: null,
          tasa_bcv: rates.bcv || null,
          tasa_paralela: rates.paralela || null,
          monto_usd: montoUsd,
          metodo_pago: "transferencia" as any,
          referencia: bankRow.huella,
          notas: `Conciliación bancaria · ${bankRow.concepto}`.slice(0, 255),
          modo: "on_balance" as any,
          cuenta_bancaria_id: bankRow.cuentaBancariaId,
          tercero_id: cxp.tercero_id ?? null,
          grupo_transaccion_id: grupoId,
          created_by: user.id,
        } as any).select().single();

        if (error) throw new Error(error.message);
        if (tx) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);

        // Update CxP
        const pendiente = Number(cxp.monto_pendiente_bs ?? cxp.monto_bs);
        const usdBcvPendiente = Number(cxp.monto_pendiente_usd_bcv ?? cxp.usd_bcv_factura ?? 0);
        const usdBcvPagado = rates.bcv > 0 ? +(montoBs / rates.bcv).toFixed(2) : 0;
        const nuevoUsdBcv = Math.max(0, +(usdBcvPendiente - usdBcvPagado).toFixed(2));
        const nuevoBs = Math.max(0, +(nuevoUsdBcv * (Number(cxp.tasa_bcv_factura) || rates.bcv || 1)).toFixed(2));
        const cubreTodo = nuevoUsdBcv <= 0.01;

        await supabase.from("cuentas_por_pagar").update({
          estado: cubreTodo ? "pagada" : "parcial",
          pagada_at: cubreTodo ? new Date().toISOString() : null,
          monto_pendiente_bs: nuevoBs,
          monto_pendiente_usd_bcv: nuevoUsdBcv,
        }).eq("id", cxp.id);

        if (cubreTodo) ok++; else partial++;
        importados.add(bankRow.id);
        setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      } catch (e: any) {
        fail++;
        toast.error(e?.message ?? "Error registrando movimiento");
        setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      }
    }

    setBusy(false);
    setProgress(null);
    qc.invalidateQueries();
    toast.success(`Pagados: ${ok} · Parciales: ${partial} · Sin factura: ${sinFactura} · Fallidos: ${fail}`);
    if (importados.size > 0) {
      setRows((prev) => prev.filter((r) => !importados.has(r.id)));
      setMatches((prev) => prev.filter((m) => !importados.has(m.bankRow.id)));
    }
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const matched = matches.filter((m) => m.cxp).length;
    const duplicados = matches.filter((m) => m.duplicado).length;
    const sinCuenta = matches.filter((m) => !m.duplicado && !m.cxp && !m.cuentaCodigo).length;
    const sinFactura = matches.filter((m) => !m.duplicado && !m.cxp && !!m.cuentaCodigo).length;
    const selected = matches.filter(importable).length;
    const withAccount = matches.filter((m) => m.bankRow.cuentaBancariaId).length;
    return { total, matched, selected, withAccount, duplicados, sinCuenta, sinFactura };
  }, [rows, matches]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar movimientos bancarios</h1>
        <p className="text-sm text-muted-foreground">
          Sube el reporte de movimientos bancarios. El sistema empareja cada egreso con una CxP pendiente por número de factura;
          lo que no se empareja se registra igual contra la cuenta de su categoría y queda marcado como <strong>sin factura</strong>.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Archivo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label>Reporte de movimientos bancarios (.xlsx / .xls)</Label>
          <Input
            type="file"
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          {fileName && <div className="text-xs text-muted-foreground mt-1">{fileName}</div>}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              2. Conciliación ({stats.matched} con factura · {stats.sinFactura} sin factura · {stats.duplicados} ya importadas)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Total: {stats.total}</Badge>
              <Badge variant="default">Nuevas seleccionadas: {stats.selected}</Badge>
              {stats.duplicados > 0 && <Badge variant="secondary">Ya importadas: {stats.duplicados}</Badge>}
              {stats.sinCuenta > 0 && <Badge variant="destructive">Sin cuenta contable: {stats.sinCuenta}</Badge>}
              {stats.withAccount < stats.selected && (
                <Badge variant="destructive">Falta cuenta bancaria en {stats.selected - stats.withAccount} filas</Badge>
              )}
            </div>

            <div className="border rounded overflow-x-auto max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0 z-10 shadow-sm">
                  <tr className="text-left">
                    <th className="p-2 bg-muted w-8"></th>
                    <th className="p-2 bg-muted">Fecha</th>
                    <th className="p-2 bg-muted">Banco</th>
                    <th className="p-2 bg-muted">Referencia</th>
                    <th className="p-2 bg-muted">Concepto</th>
                    <th className="p-2 bg-muted text-right">Monto Bs</th>
                    <th className="p-2 bg-muted text-right">Monto USD</th>
                    <th className="p-2 bg-muted">Cuenta destino</th>
                    <th className="p-2 bg-muted">CxP emparejada</th>
                    <th className="p-2 bg-muted">Cuenta contable (sin factura)</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.slice(0, visibleCount).map((m) => (
                    <tr
                      key={m.bankRow.id}
                      className={
                        "border-t " +
                        (m.duplicado
                          ? "opacity-50"
                          : !m.cxp && !m.cuentaCodigo
                            ? "bg-destructive/5"
                            : "")
                      }
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={m.selected && !m.duplicado}
                          onCheckedChange={(v) => setMatchSelected(m.bankRow.id, Boolean(v))}
                          disabled={m.duplicado || !m.bankRow.cuentaBancariaId || (!m.cxp && !m.cuentaCodigo)}
                        />
                      </td>
                      <td className="p-2">{fmtDate(m.bankRow.fecha)}</td>
                      <td className="p-2">
                        <div className="font-medium">{m.bankRow.banco}</div>
                        <div className="text-[10px] text-muted-foreground">{m.bankRow.bancoRaw}</div>
                      </td>
                      <td className="p-2 font-mono">{m.bankRow.referencia}</td>
                      <td className="p-2 max-w-[200px]">
                        <div className="truncate">{m.bankRow.concepto}</div>
                        <div className="flex gap-1 mt-1">
                          {m.bankRow.categoria && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{m.bankRow.categoria}</Badge>
                          )}
                          {m.duplicado && <Badge variant="secondary" className="text-[9px] px-1 py-0">Ya importado</Badge>}
                          {!m.duplicado && !m.cxp && m.cuentaCodigo && (
                            <Badge className="text-[9px] px-1 py-0 bg-orange-500 text-white hover:bg-orange-500">Sin factura</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-right mono">{m.bankRow.montoBs ? fmtBs(m.bankRow.montoBs) : "—"}</td>
                      <td className="p-2 text-right mono">{m.bankRow.montoUsd ? fmtUsd(m.bankRow.montoUsd) : "—"}</td>
                      <td className="p-2">
                        <Select
                          value={m.bankRow.cuentaBancariaId ?? "_none_"}
                          onValueChange={(v) => setMatchBankAccount(m.bankRow.id, v === "_none_" ? "" : v)}
                        >
                          <SelectTrigger className="w-[160px] text-xs">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none_">— Sin cuenta —</SelectItem>
                            {bankOptions.map((b) => (
                              <SelectItem key={b.id} value={b.id}>{b.nombre} ({b.banco})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Select
                          value={m.cxp?.id ?? "_none_"}
                          onValueChange={(v) => setMatchCxp(m.bankRow.id, v === "_none_" ? null : v)}
                        >
                          <SelectTrigger className="w-[220px] text-xs">
                            <SelectValue placeholder="Emparejar CxP" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none_">— Sin emparejar —</SelectItem>
                            {(m.cxp && !cxpOptions.slice(0, 200).some((c) => c.id === m.cxp!.id) ? [m.cxp, ...cxpOptions.slice(0, 200)] : cxpOptions.slice(0, 200)).map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.proveedor} · Fact {c.numero_factura ?? "—"} · {fmtBs(Number(c.monto_pendiente_bs ?? c.monto_bs))}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {m.cxp && (
                          <div className="text-[10px] text-muted-foreground mt-1">
                            Pendiente: {fmtBs(Number(m.cxp.monto_pendiente_bs ?? m.cxp.monto_bs))}
                            {m.cxp.monto_pendiente_usd_bcv ? ` · ${fmtUsd(Number(m.cxp.monto_pendiente_usd_bcv))} USD BCV` : ""}
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        <Select
                          value={m.cuentaCodigo ?? "_none_"}
                          onValueChange={(v) => setMatchCuenta(m.bankRow.id, v === "_none_" ? null : v)}
                          disabled={!!m.cxp}
                        >
                          <SelectTrigger className="w-[220px] text-xs">
                            <SelectValue placeholder="Elegir cuenta" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none_">— Sin cuenta —</SelectItem>
                            {planOptions.map((p) => (
                              <SelectItem key={p.codigo} value={p.codigo}>{p.codigo} — {p.nombre}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {matches.length > visibleCount && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span>Mostrando {visibleCount} de {matches.length} filas</span>
                <Button variant="outline" size="sm" onClick={() => setVisibleCount((v) => v + 150)}>Mostrar más</Button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {progress ? `Procesando ${progress.done}/${progress.total}...` : `Confirmar ${stats.selected} movimientos seleccionados.`}
              </div>
              <Button onClick={confirmar} disabled={busy || stats.selected === 0}>
                {busy ? "Procesando..." : "Confirmar movimientos seleccionados"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {progress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border rounded-lg shadow-xl px-8 py-6 min-w-[320px] text-center space-y-3">
            <div className="text-sm text-muted-foreground">Registrando movimientos...</div>
            <div className="text-3xl font-bold mono">
              {progress.done} <span className="text-muted-foreground text-xl">/ {progress.total}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-150"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
