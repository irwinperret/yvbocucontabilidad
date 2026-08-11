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
import { crearBatch, cerrarBatch, type BatchHandle } from "@/lib/import-batches";
import {
  SIN_FACTURA_PREFIX,
  huellaBancaria,
  parseCodigosDoc,
  normalizarCodigo,
  cuentaSinFactura,
  cuentaServicio,
  monedaBase,
  type CodigoDoc,
} from "@/lib/conciliacion";
import { SearchCombobox } from "@/components/search-combobox";

export const Route = createFileRoute("/_authenticated/importar-movimientos")({
  component: ImportarMovimientos,
});

const CUENTA_PAGO_CXP = "13.2";

// Mapa Categoría → cuenta del plan (fallback cuando el archivo no trae cuenta sugerida)
// OJO: INV no se mapea a 2.1 — esas filas son pagos de compras que ya existen como CxP
// y deben emparejarse manualmente (o asignarse a 99 — POR DETERMINAR).
const CATEGORIA_CUENTA: Record<string, string> = {
  ADM: "4.8",
  MO: "3.16",
  OC: "5.6",
  MERCADEO: "6.2",
  INVERSION: "10.6",
};

/** Categorías cuyos movimientos siempre deben emparejarse contra una CxP existente. */
const requiereCxP = (categoria: string | null | undefined) =>
  String(categoria ?? "").trim().toUpperCase() === "INV";


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
  codigos: CodigoDoc[];
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
  const [fileSize, setFileSize] = useState<number | null>(null);
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
    setFileSize(file.size);
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
      const idxCodigos = header.findIndex(
        (h) => (h.includes("factura") && h.includes("orden")) || h.includes("orden de ent")
      );

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
        const valBs = idxBs >= 0 ? numFromCell(row[idxBs]) : 0;
        const valUsd = idxUsd >= 0 ? numFromCell(row[idxUsd]) : 0;
        // La moneda base depende del banco (col. C), no de qué celda venga llena.
        let moneda = monedaBase(bancoRaw);
        if (moneda === "Bs" && Math.abs(valBs) === 0 && Math.abs(valUsd) > 0) moneda = "USD";
        if (moneda === "USD" && Math.abs(valUsd) === 0 && Math.abs(valBs) > 0) moneda = "Bs";
        const monto = moneda === "Bs" ? -Math.abs(valBs) : -Math.abs(valUsd);
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
          codigos: idxCodigos >= 0 ? parseCodigosDoc(row[idxCodigos]) : [],
          huella: huellaBancaria({ banco, fecha, referencia, monto: Math.abs(monto) }),
        });
      }
      setRows(parsed);

      // ── Índice de CxP por código normalizado (exacto + sufijos) ──
      const index = new Map<string, CxPRow[]>();
      const push = (key: string, c: CxPRow) => {
        if (!key) return;
        const list = index.get(key);
        if (list) { if (!list.includes(c)) list.push(c); } else index.set(key, [c]);
      };
      for (const c of cxpOptions) {
        if (!c.numero_factura) continue;
        const key = normalizarCodigo(c.numero_factura);
        if (!key) continue;
        push(key, c);
        // sufijos: permite cruzar "1404" contra factura "00011404"
        for (let l = 3; l < key.length; l++) push("~" + key.slice(key.length - l), c);
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
        const cuentaCodigo = cuentaPorFila[i] ?? null;
        const noAplica =
          !requiereCxP(bankRow.categoria) &&
          (cuentaSinFactura(cuentaCodigo) || cuentaServicio(cuentaCodigo));


        const found: CxPRow[] = [];
        if (!noAplica) {
          // 1) códigos explícitos de la columna K (fuente principal)
          const claves = bankRow.codigos.map((c) => c.norm);
          // 2) respaldo: números detectados en concepto/referencia
          if (claves.length === 0) {
            for (const inv of extractInvoiceNumbers(bankRow.concepto + " " + bankRow.referencia)) {
              claves.push(normalizarCodigo(inv));
            }
          }
          for (const k of claves) {
            if (!k) continue;
            const hit = index.get(k) ?? index.get("~" + k);
            if (hit) for (const c of hit) if (!found.includes(c)) found.push(c);
          }
        }
        // Con varios códigos distintos se emparejan todas las facturas halladas;
        // con un solo código ambiguo (varias candidatas) se deja elegir al usuario.
        const auto = found.length === 1 || bankRow.codigos.length > 1 ? found : [];
        const duplicado = yaImportadas.has(bankRow.huella) || vistas.has(bankRow.huella);
        vistas.add(bankRow.huella);
        return {
          bankRow,
          cxps: auto,
          manual: false,
          selected: !duplicado && (auto.length > 0 || !!cuentaCodigo),
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

  /** Asigna la cuenta 99 — POR DETERMINAR a todas las filas nuevas sin cuenta ni CxP. */
  const asignarPorDeterminar = () => {
    let n = 0;
    setMatches((prev) =>
      prev.map((m) => {
        if (m.duplicado || m.cxps.length > 0 || m.cuentaCodigo) return m;
        n++;
        return { ...m, cuentaCodigo: "99", selected: true };
      })
    );
    toast.success(n > 0 ? `${n} movimientos asignados a 99 — POR DETERMINAR` : "No hay filas sin cuenta");
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
    m.selected && !m.duplicado && !!m.bankRow.cuentaBancariaId && (m.cxps.length > 0 || !!m.cuentaCodigo);

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
    const fechasSort = toImport.map((m) => m.bankRow.fecha).filter(Boolean).sort();
    const batch: BatchHandle | null = await crearBatch({
      tipo: "movimientos",
      archivoNombre: fileName,
      archivoTamano: fileSize,
      fechaDesde: fechasSort[0] ?? null,
      fechaHasta: fechasSort[fechasSort.length - 1] ?? null,
      filasLeidas: matches.length,
      userId: user.id,
    });
    let ok = 0, fail = 0, partial = 0, sinFactura = 0, noAplicaCount = 0, anticipos = 0;
    const importados = new Set<string>();

    for (const m of toImport) {
      try {
        const bankRow = m.bankRow;
        const rates = await getRatesForDate(bankRow.fecha);
        // Variable independiente según el banco: Bs (BA/BCV/BM/BVC/MERC/CxP) o USD (CASH/BOFA).
        const montoBs =
          bankRow.moneda === "USD"
            ? +(Math.abs(bankRow.montoUsd) * (rates.paralela || rates.bcv || 1)).toFixed(2)
            : Math.abs(bankRow.montoBs);
        const toUsd = (bs: number) =>
          rates.paralela > 0 ? +(bs / rates.paralela).toFixed(2) : (rates.bcv > 0 ? +(bs / rates.bcv).toFixed(2) : 0);

        if (m.cxps.length === 0) {
          // ── Movimiento sin CxP emparejada ──
          const noAplica =
            !requiereCxP(bankRow.categoria) &&
            (cuentaSinFactura(m.cuentaCodigo) || cuentaServicio(m.cuentaCodigo));

          const detalle = noAplica
            ? (cuentaServicio(m.cuentaCodigo)
                ? `Servicio público · Ref ${bankRow.referencia || "—"} · ${bankRow.concepto}`
                : bankRow.concepto)
            : `${SIN_FACTURA_PREFIX} · ${bankRow.concepto}`;
          const notas = noAplica
            ? `Conciliación bancaria (no aplica factura) · ${bankRow.banco} · Ref ${bankRow.referencia || "—"} · ${bankRow.concepto}`
            : `Conciliación bancaria sin factura · ${bankRow.banco} · Ref ${bankRow.referencia || "—"} · ${bankRow.concepto}`;

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
            monto_usd:
              bankRow.moneda === "USD" ? +Math.abs(bankRow.montoUsd).toFixed(2) : toUsd(montoBs),
            metodo_pago: "transferencia" as any,
            referencia: bankRow.huella,
            detalle: detalle.slice(0, 255),
            notas: notas.slice(0, 255),
            modo: "on_balance" as any,
            cuenta_bancaria_id: bankRow.cuentaBancariaId,
            grupo_transaccion_id: crypto.randomUUID(),
            created_by: user.id,
          } as any).select().single();

          if (error) throw new Error(error.message);
          if (tx) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);
          if (noAplica) noAplicaCount++; else sinFactura++;
          importados.add(bankRow.id);
          setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
          continue;
        }

        // ── Distribución del pago en USD BCV entre las facturas seleccionadas ──
        const { calcularSplitIvaPagoCxp } = await import("@/lib/iva-helpers");
        let restanteUsdBcv = rates.bcv > 0 ? +(montoBs / rates.bcv).toFixed(2) : 0;
        let restanteBs = montoBs;
        let idx = 0;

        for (const cxp of m.cxps) {
          if (restanteBs <= 0.01) break;
          const pendUsdBcv = pendienteUsdBcv(cxp);
          const aplicarUsdBcv = rates.bcv > 0
            ? Math.min(pendUsdBcv, restanteUsdBcv)
            : restanteUsdBcv;
          const tramoBs = rates.bcv > 0
            ? Math.min(restanteBs, +(aplicarUsdBcv * rates.bcv).toFixed(2))
            : restanteBs;
          if (tramoBs <= 0.01) { idx++; continue; }

          const { data: txOrig } = await supabase
            .from("transacciones")
            .select("centro_costo, grupo_transaccion_id")
            .eq("id", cxp.transaccion_id ?? "")
            .maybeSingle();
          const grupoId = txOrig?.grupo_transaccion_id ?? crypto.randomUUID();

          const { data: ivaLegs } = await supabase
            .from("transacciones")
            .select("id")
            .eq("grupo_transaccion_id", grupoId)
            .eq("cuenta_codigo", "12.5")
            .gt("monto_bs", 0)
            .limit(1);
          const hasIva = (ivaLegs?.length ?? 0) > 0;
          const split = await calcularSplitIvaPagoCxp(grupoId, tramoBs, hasIva);

          const { data: tx, error } = await supabase.from("transacciones").insert({
            fecha: bankRow.fecha,
            cuenta_codigo: CUENTA_PAGO_CXP,
            centro_costo: (txOrig?.centro_costo ?? cxp.centro_costo ?? "Compartido") as any,
            monto_bs: tramoBs,
            monto_base_bs: split.monto_base_bs,
            iva_bs: split.iva_bs,
            iva_aplica: split.iva_bs > 0,
            tipo_iva: null,
            tasa_bcv: rates.bcv || null,
            tasa_paralela: rates.paralela || null,
            monto_usd: toUsd(tramoBs),
            metodo_pago: "transferencia" as any,
            referencia: idx === 0 ? bankRow.huella : `${bankRow.huella}#${idx}`,
            notas: `Conciliación bancaria · ${bankRow.concepto}`.slice(0, 255),
            modo: "on_balance" as any,
            cuenta_bancaria_id: bankRow.cuentaBancariaId,
            tercero_id: cxp.tercero_id ?? null,
            grupo_transaccion_id: grupoId,
            created_by: user.id,
          } as any).select().single();

          if (error) throw new Error(error.message);
          if (tx) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);

          const nuevoUsdBcv = Math.max(0, +(pendUsdBcv - aplicarUsdBcv).toFixed(2));
          const nuevoBs = Math.max(0, +(nuevoUsdBcv * (Number(cxp.tasa_bcv_factura) || rates.bcv || 1)).toFixed(2));
          const cubreTodo = nuevoUsdBcv <= 0.01;

          await supabase.from("cuentas_por_pagar").update({
            revert_batch_id: (cxp as any).revert_batch_id ?? batch?.id ?? null,
            revert_estado_anterior: (cxp as any).revert_estado_anterior ?? cxp.estado ?? "pendiente",
            revert_pendiente_bs_anterior: (cxp as any).revert_pendiente_bs_anterior ?? cxp.monto_pendiente_bs ?? cxp.monto_bs,
            revert_pendiente_usd_bcv_anterior: (cxp as any).revert_pendiente_usd_bcv_anterior ?? cxp.monto_pendiente_usd_bcv ?? cxp.usd_bcv_factura,
            revert_pagada_at_anterior: (cxp as any).revert_pagada_at_anterior ?? (cxp as any).pagada_at ?? null,
            estado: cubreTodo ? "pagada" : "parcial",
            pagada_at: cubreTodo ? new Date().toISOString() : null,
            monto_pendiente_bs: nuevoBs,
            monto_pendiente_usd_bcv: nuevoUsdBcv,
          }).eq("id", cxp.id);

          if (cubreTodo) ok++; else partial++;
          restanteBs = +(restanteBs - tramoBs).toFixed(2);
          restanteUsdBcv = +(restanteUsdBcv - aplicarUsdBcv).toFixed(2);
          idx++;
        }

        // ── Remanente: anticipo a proveedor (14.2) ──
        if (restanteUsdBcv > 0.01 && restanteBs > 0.01) {
          const proveedor = m.cxps[0];
          const { data: txAnt, error: eAnt } = await supabase.from("transacciones").insert({
            fecha: bankRow.fecha,
            cuenta_codigo: "14.2",
            centro_costo: (proveedor.centro_costo ?? "Compartido") as any,
            monto_bs: restanteBs,
            monto_base_bs: restanteBs,
            iva_bs: 0,
            iva_aplica: false,
            tipo_iva: null,
            tasa_bcv: rates.bcv || null,
            tasa_paralela: rates.paralela || null,
            monto_usd: toUsd(restanteBs),
            metodo_pago: "transferencia" as any,
            referencia: `${bankRow.huella}#ANT`,
            detalle: `Anticipo por excedente de pago · ${proveedor.proveedor}`.slice(0, 255),
            notas: `Excedente de conciliación bancaria · ${bankRow.banco} · Ref ${bankRow.referencia || "—"}`.slice(0, 255),
            modo: "on_balance" as any,
            cuenta_bancaria_id: bankRow.cuentaBancariaId,
            tercero_id: proveedor.tercero_id ?? null,
            anticipo_estado: "abierto",
            grupo_transaccion_id: crypto.randomUUID(),
            created_by: user.id,
          } as any).select().single();
          if (eAnt) throw new Error(eAnt.message);
          if (txAnt) await logAudit("transacciones", "INSERT", (txAnt as any).id, null, txAnt);
          anticipos++;
        }

        importados.add(bankRow.id);
        setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      } catch (e: any) {
        fail++;
        toast.error(e?.message ?? "Error registrando movimiento");
        setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      }
    }

    await cerrarBatch(batch, {
      filasRegistradas: importados.size,
      filasOmitidas: fail,
      totalBs: toImport.reduce((s, m) => s + Math.abs(Number(m.bankRow.montoBs) || 0), 0),
      totalUsd: toImport.reduce((s, m) => s + Math.abs(Number(m.bankRow.montoUsd) || 0), 0),
    });

    setBusy(false);
    setProgress(null);
    qc.invalidateQueries();
    toast.success(
      `Facturas pagadas: ${ok} · Parciales: ${partial} · Anticipos: ${anticipos} · No aplica factura: ${noAplicaCount} · Sin factura: ${sinFactura} · Fallidos: ${fail}`
    );
    if (sinFactura > 0 || noAplicaCount > 0) {
      toast("Movimientos sin factura identificada", {
        description: "Cuando importes las compras de Xetux, usa “Recalcular pareos” para vincularlos.",
        action: {
          label: "Ir a Movimientos bancarios",
          onClick: () => { window.location.href = "/movimientos-bancarios"; },
        },
        duration: 12000,
      });
    }
    if (importados.size > 0) {
      setRows((prev) => prev.filter((r) => !importados.has(r.id)));
      setMatches((prev) => prev.filter((m) => !importados.has(m.bankRow.id)));
    }
  };

  /** Diferencia (solo informativa) entre lo que valen las facturas y lo que se paga. */
  const difBs = (m: Match) => {
    if (m.cxps.length === 0) return null;
    const facturado = m.cxps.reduce((s, c) => s + pendienteBs(c), 0);
    const pagado = Math.abs(m.bankRow.montoBs || 0);
    if (!pagado) return null;
    return +(pagado - facturado).toFixed(2);
  };

  const noAplicaFactura = (m: Match) => cuentaSinFactura(m.cuentaCodigo) || cuentaServicio(m.cuentaCodigo);

  const cxpComboOptions = useMemo(
    () =>
      cxpOptions.map((c) => ({
        value: c.id,
        label: `${c.proveedor ?? "—"} · Fact ${c.numero_factura ?? "—"} · ${fmtBs(pendienteBs(c))}`,
        keywords: `${c.proveedor ?? ""} ${c.numero_factura ?? ""}`,
      })),
    [cxpOptions]
  );

  const planComboOptions = useMemo(
    () => planOptions.map((p) => ({ value: p.codigo, label: `${p.codigo} — ${p.nombre}`, keywords: p.nombre })),
    [planOptions]
  );



  const stats = useMemo(() => {
    const total = rows.length;
    const matched = matches.filter((m) => m.cxps.length > 0).length;
    const duplicados = matches.filter((m) => m.duplicado).length;
    const sinCuenta = matches.filter((m) => !m.duplicado && m.cxps.length === 0 && !m.cuentaCodigo).length;
    const noAplica = matches.filter((m) => !m.duplicado && m.cxps.length === 0 && noAplicaFactura(m)).length;
    const sinFactura = matches.filter(
      (m) => !m.duplicado && m.cxps.length === 0 && !!m.cuentaCodigo && !noAplicaFactura(m)
    ).length;
    const selected = matches.filter(importable).length;
    const withAccount = matches.filter((m) => m.bankRow.cuentaBancariaId).length;
    const difTotal = matches.reduce((s, m) => s + (m.duplicado ? 0 : (difBs(m) ?? 0)), 0);
    return { total, matched, selected, withAccount, duplicados, sinCuenta, sinFactura, noAplica, difTotal };
  }, [rows, matches]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar movimientos bancarios</h1>
        <p className="text-sm text-muted-foreground">
          Sube el reporte de movimientos bancarios. El sistema cruza la columna <strong>N° Factura o N° Orden de Entrega</strong>
          {" "}(acepta <code>NE:</code>, <code>PED:</code> y varios códigos separados por coma) contra las CxP pendientes.
          Los movimientos que por naturaleza no tienen factura (nómina, impuestos, préstamos, fees bancarios, servicios públicos)
          se registran igual y quedan marcados como <strong>no aplica factura</strong>.
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
              2. Conciliación ({stats.matched} con factura · {stats.noAplica} no aplica · {stats.sinFactura} sin factura · {stats.duplicados} ya importadas)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Total: {stats.total}</Badge>
              <Badge variant="default">Nuevas seleccionadas: {stats.selected}</Badge>
              {stats.noAplica > 0 && <Badge variant="outline">No aplica factura: {stats.noAplica}</Badge>}
              {stats.duplicados > 0 && <Badge variant="secondary">Ya importadas: {stats.duplicados}</Badge>}
              {stats.sinCuenta > 0 && (
                <>
                  <Badge variant="destructive">Sin cuenta contable: {stats.sinCuenta}</Badge>
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={asignarPorDeterminar}>
                    Asignar 99 — POR DETERMINAR
                  </Button>
                </>
              )}
              {stats.withAccount < stats.selected && (
                <Badge variant="destructive">Falta cuenta bancaria en {stats.selected - stats.withAccount} filas</Badge>
              )}
              {Math.abs(stats.difTotal) > 0.01 && (
                <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
                  Diferencia total (informativa): {fmtBs(stats.difTotal)}
                </Badge>
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
                    <th className="p-2 bg-muted">CxP emparejadas</th>
                    <th className="p-2 bg-muted text-right">Dif. Bs</th>
                    <th className="p-2 bg-muted">Cuenta contable (sin factura)</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.slice(0, visibleCount).map((m) => {
                    const dif = difBs(m);
                    const proveedorRef = m.cxps[0];
                    const candidatas = proveedorRef
                      ? cxpOptions
                          .filter((c) =>
                            !m.cxps.some((x) => x.id === c.id) &&
                            (proveedorRef.tercero_id
                              ? c.tercero_id === proveedorRef.tercero_id
                              : c.proveedor === proveedorRef.proveedor),
                          )
                          .slice(0, 50)
                      : [];
                    return (
                    <tr
                      key={m.bankRow.id}
                      className={
                        "border-t " +
                        (m.duplicado
                          ? "opacity-50"
                          : m.cxps.length === 0 && !m.cuentaCodigo
                            ? "bg-destructive/5"
                            : "")
                      }
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={m.selected && !m.duplicado}
                          onCheckedChange={(v) => setMatchSelected(m.bankRow.id, Boolean(v))}
                          disabled={m.duplicado || !m.bankRow.cuentaBancariaId || (m.cxps.length === 0 && !m.cuentaCodigo)}
                        />
                      </td>
                      <td className="p-2">{fmtDate(m.bankRow.fecha)}</td>
                      <td className="p-2">
                        <div className="font-medium">{m.bankRow.banco}</div>
                        <div className="text-[10px] text-muted-foreground">{m.bankRow.bancoRaw}</div>
                      </td>
                      <td className="p-2 font-mono">
                        <div>{m.bankRow.referencia}</div>
                        {m.bankRow.codigos.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {m.bankRow.codigos.map((c) => (
                              <Badge key={c.raw} variant="outline" className="text-[9px] px-1 py-0">
                                {c.raw}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-2 max-w-[200px]">
                        <div className="truncate">{m.bankRow.concepto}</div>
                        <div className="flex gap-1 mt-1">
                          {m.bankRow.categoria && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{m.bankRow.categoria}</Badge>
                          )}
                          {m.duplicado && <Badge variant="secondary" className="text-[9px] px-1 py-0">Ya importado</Badge>}
                          {!m.duplicado && m.cxps.length === 0 && m.cuentaCodigo && noAplicaFactura(m) && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">No aplica factura</Badge>
                          )}
                          {!m.duplicado && m.cxps.length === 0 && m.cuentaCodigo && !noAplicaFactura(m) && (
                            <Badge className="text-[9px] px-1 py-0 bg-orange-500 text-white hover:bg-orange-500">Sin factura</Badge>
                          )}
                          {!m.duplicado && dif !== null && dif > 0.01 && (
                            <Badge className="text-[9px] px-1 py-0 bg-amber-500 text-white hover:bg-amber-500">Excedente → anticipo</Badge>
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
                        <SearchCombobox
                          triggerClassName="w-[240px]"
                          placeholder="Emparejar CxP"
                          searchPlaceholder="Buscar proveedor o factura..."
                          value={proveedorRef?.id ?? null}
                          onChange={(v) => setMatchCxp(m.bankRow.id, v)}
                          options={cxpComboOptions}
                        />
                        {m.cxps.map((c, i) => (
                          <div key={c.id} className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="truncate max-w-[190px]">
                              {i > 0 ? `+ Fact ${c.numero_factura ?? "—"} · ` : ""}
                              Pendiente: {fmtBs(pendienteBs(c))}
                              {c.monto_pendiente_usd_bcv ? ` · ${fmtUsd(Number(c.monto_pendiente_usd_bcv))} USD BCV` : ""}
                            </span>
                            {i > 0 && (
                              <button
                                type="button"
                                className="text-destructive hover:underline"
                                onClick={() => removeMatchCxp(m.bankRow.id, c.id)}
                              >
                                quitar
                              </button>
                            )}
                          </div>
                        ))}
                        {proveedorRef && candidatas.length > 0 && (
                          <SearchCombobox
                            triggerClassName="w-[240px] h-7 mt-1"
                            placeholder="+ Agregar otra factura"
                            searchPlaceholder="Buscar factura..."
                            value={null}
                            onChange={(v) => { if (v) addMatchCxp(m.bankRow.id, v); }}
                            options={candidatas.map((c) => ({
                              value: c.id,
                              label: `Fact ${c.numero_factura ?? "—"} · ${fmtBs(pendienteBs(c))}`,
                              keywords: `${c.proveedor ?? ""} ${c.numero_factura ?? ""}`,
                            }))}
                          />
                        )}
                      </td>
                      <td className={"p-2 text-right mono " + (dif !== null && Math.abs(dif) > 0.01 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                        {dif === null ? "—" : fmtBs(dif)}
                      </td>
                      <td className="p-2">
                        <SearchCombobox
                          triggerClassName="w-[240px]"
                          placeholder="Elegir cuenta"
                          searchPlaceholder="Buscar cuenta..."
                          value={m.cuentaCodigo}
                          onChange={(v) => setMatchCuenta(m.bankRow.id, v)}
                          disabled={m.cxps.length > 0}
                          options={planComboOptions}
                        />
                      </td>

                    </tr>
                    );
                  })}
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
