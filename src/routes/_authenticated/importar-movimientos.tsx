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
import { ordenarPorCodigo } from "@/lib/account-helpers";
import { toast } from "sonner";
import { readSheetAOASmart, numFromCell, parseDateCell } from "@/lib/xetux-parse";
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
  esGastoDirectoAuto,
  monedaBase,
  limpiarReferencia,
  marcarEstadoConciliacion,
  type CodigoDoc,
} from "@/lib/conciliacion";
import { SearchCombobox } from "@/components/search-combobox";
import { CUENTA_CAMBIO, esCambio } from "@/lib/operaciones-cambio";
import { tasaBcvQuery } from "@/lib/tasas";
import { pendienteBsAFecha, pendienteUsdBcv } from "@/lib/cxp-saldo";
import {
  clasificarPagoPersonal,
  esPagoPersonal,
  descargaPasivo,
  requiereSignoNegativo,
  tipoRegistroDeCuenta,
  TIPO_REGISTRO_LABEL,
  type TipoRegistro,
} from "@/lib/clasificar-personal";


export const Route = createFileRoute("/_authenticated/importar-movimientos")({
  component: ImportarMovimientos,
});

const CUENTA_PAGO_CXP = "8.2";

// Mapa Categoría → cuenta del plan (fallback cuando el archivo no trae cuenta sugerida)
// OJO: INV no se mapea a 2.1 — esas filas son pagos de compras que ya existen como CxP
// y deben emparejarse manualmente (o asignarse a 99 — POR DETERMINAR).
const CATEGORIA_CUENTA: Record<string, string> = {
  ADM: "4.1",
  MO: "3.3",
  OC: "4.6",
  MERCADEO: "3.12",
  INVERSION: "5.6",
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
  /** Duplicado cuya cuenta sugerida en el archivo difiere de la ya guardada:
   * en vez de importarse de nuevo, se ofrece actualizar la cuenta existente. */
  duplicadoActualizable?: boolean;
  existenteId?: string | null;
  existenteCuentaAnterior?: string | null;
  notasNuevas?: string;
  detalleNuevo?: string;
  montoCambio?: boolean;
  montoNuevoBs?: number;
  /** Operación de cambio: contrapartida recibida (la otra pata). */
  esCambio?: boolean;
  cambioRecibido?: string;
  cambioMoneda?: "Bs" | "USD";
};

const pendienteBs = (c: CxPRow, tasaBcv?: number) => pendienteBsAFecha(c, Number(tasaBcv) || 0);

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
      const { data } = await supabase.from("plan_de_cuentas").select("codigo, nombre, grupo").eq("activa", true);
      return ordenarPorCodigo((data ?? []) as { codigo: string; nombre: string; grupo: string }[]);
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

  const { data: tasasBcv } = useQuery({
    queryKey: ["tasas-bcv-import-mov"],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("fecha,tasa").order("fecha");
      return (data ?? []) as { fecha: string; tasa: number }[];
    },
  });

  /** Tasa BCV de la fecha; si no hay, la PRÓXIMA publicada (regla del sistema). */
  const tasaBcvDe = (fecha: string) => {
    const lista = tasasBcv ?? [];
    if (!fecha || lista.length === 0) return 0;
    const next = lista.find((t) => t.fecha >= fecha);
    if (next) return Number(next.tasa) || 0;
    return Number(lista[lista.length - 1]?.tasa) || 0;
  };


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
      const aoa = await readSheetAOASmart(file, [
        ["fecha"],
        ["concepto", "descripci"],
        ["monto bs", "monto usd", "bs", "usd"],
      ]);
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
        // No se descartan filas con Monto Bs = 0 (BOFA/CASH pagan en USD).
        if (Math.abs(valBs) === 0 && Math.abs(valUsd) === 0) continue;
        // La moneda base depende del banco (col. C), no de qué celda venga llena.
        let moneda = monedaBase(bancoRaw);
        if (moneda === "Bs" && Math.abs(valBs) === 0 && Math.abs(valUsd) > 0) moneda = "USD";
        if (moneda === "USD" && Math.abs(valUsd) === 0 && Math.abs(valBs) > 0) moneda = "Bs";
        const monto = moneda === "Bs" ? -Math.abs(valBs) : -Math.abs(valUsd);
        const bankAccount = findBankAccount(bancoRaw);
        const cuentaBancariaId = bankAccount ? bankAccount.id : null;
        const categoria = idxCat >= 0 ? String(row[idxCat] ?? "") : "";
        const banco = normalizeBank(bancoRaw);
        // BA/Banesco exporta las referencias con apóstrofe inicial ('122347217146)
        const referencia = idxRef >= 0 ? limpiarReferencia(row[idxRef]) : "";

        const conceptoRaw = String(row[idxConcepto] ?? "");
        // Pagos al personal: clasificación por palabras clave (nómina, parafiscales,
        // propinas 13.1, bono 10% 13.4, liquidaciones, anticipos…).
        const clasifPersonal = esPagoPersonal(conceptoRaw, categoria)
          ? clasificarPagoPersonal(conceptoRaw, categoria)
          : null;

        cuentaPorFila.push(
          (esCambio(conceptoRaw) ? CUENTA_CAMBIO : null) ??
            (idxSug >= 0 ? parseCuentaCodigo(row[idxSug]) : null) ??
            (idxCuentaPlan >= 0 ? parseCuentaCodigo(row[idxCuentaPlan]) : null) ??
            clasifPersonal?.cuenta ??
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
          // Se conservan ambos montos tal cual vienen del Excel.
          montoBs: -Math.abs(valBs),
          montoUsd: -Math.abs(valUsd),
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

      // Anti-duplicados: huellas ya registradas en transacciones. Se trae también
      // id, cuenta_codigo, notas y detalle para poder ofrecer "actualizar" cuando
      // algo cambió respecto a lo ya guardado.
      const huellas = Array.from(new Set(parsed.map((p) => p.huella)));
      type Existente = { id: string; cuenta_codigo: string | null; notas: string | null; detalle: string | null; monto_bs: number | null; monto_usd: number | null };
      const yaImportadas = new Map<string, Existente>();
      for (let i = 0; i < huellas.length; i += 200) {
        const chunk = huellas.slice(i, i + 200);
        const { data } = await supabase.from("transacciones").select("id, referencia, cuenta_codigo, notas, detalle, monto_bs, monto_usd").in("referencia", chunk);
        for (const r of data ?? []) {
          const ref = (r as any).referencia;
          if (ref) yaImportadas.set(ref, {
            id: (r as any).id,
            cuenta_codigo: (r as any).cuenta_codigo ?? null,
            notas: (r as any).notas ?? null,
            detalle: (r as any).detalle ?? null,
            monto_bs: Number((r as any).monto_bs) || null,
            monto_usd: Number((r as any).monto_usd) || null,
          });
        }
      }

      // Búsqueda secundaria: mismo banco+fecha+referencia pero SIN exigir que el
      // monto coincida, para detectar cuando el monto se corrigió en el archivo.
      // Solo aplica a filas con una referencia real (no "SINREF"), porque sin
      // referencia distintiva no hay forma confiable de saber si es el mismo
      // movimiento u otro distinto del mismo día.
      const prefijosConRef = Array.from(
        new Set(
          parsed
            .filter((p) => !p.huella.includes("|SINREF|"))
            .map((p) => p.huella.split("|").slice(0, 3).join("|") + "|"),
        ),
      );
      const porPrefijo = new Map<string, Existente & { montoStr: string }>();
      if (prefijosConRef.length > 0) {
        const fechas = parsed.map((p) => p.fecha).filter(Boolean).sort();
        const { data: candidatas } = await supabase
          .from("transacciones")
          .select("id, referencia, cuenta_codigo, notas, detalle, monto_bs, monto_usd")
          .like("referencia", "BANK:%")
          .gte("fecha", fechas[0])
          .lte("fecha", fechas[fechas.length - 1]);
        for (const r of candidatas ?? []) {
          const ref = String((r as any).referencia ?? "");
          if (ref.includes("|SINREF|")) continue;
          const partes = ref.split("|");
          if (partes.length < 4) continue;
          const prefijo = partes.slice(0, 3).join("|") + "|";
          if (!prefijosConRef.includes(prefijo)) continue;
          porPrefijo.set(prefijo, {
            id: (r as any).id,
            cuenta_codigo: (r as any).cuenta_codigo ?? null,
            notas: (r as any).notas ?? null,
            detalle: (r as any).detalle ?? null,
            monto_bs: Number((r as any).monto_bs) || null,
            monto_usd: Number((r as any).monto_usd) || null,
            montoStr: partes[3],
          });
        }
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
        const prefijoHuella = bankRow.huella.split("|").slice(0, 3).join("|") + "|";
        const porMonto = yaImportadas.get(bankRow.huella);
        const porRefSinMonto = !bankRow.huella.includes("|SINREF|") ? porPrefijo.get(prefijoHuella) : undefined;
        const existente = porMonto ?? porRefSinMonto;
        const montoCambio = !porMonto && !!porRefSinMonto; // se encontró solo por ref, el monto es distinto
        const duplicado = !!existente || vistas.has(bankRow.huella);
        vistas.add(bankRow.huella);
        const cambio = cuentaCodigo === CUENTA_CAMBIO;

        // Reconstruye el mismo texto que se generaría al importar esta fila
        // (igual que en confirmar()), para comparar contra lo ya guardado y
        // detectar cualquier cambio relevante, no solo la cuenta: corregir el
        // concepto, la categoría, el monto o la cuenta sugerida en el archivo
        // cuenta.
        const noAplicaCalc = !requiereCxP(bankRow.categoria) && (cuentaSinFactura(cuentaCodigo) || cuentaServicio(cuentaCodigo));
        const detalleCalc = noAplicaCalc
          ? (cuentaServicio(cuentaCodigo)
              ? `Servicio público · Ref ${bankRow.referencia || "—"} · ${bankRow.concepto}`
              : bankRow.concepto)
          : `${SIN_FACTURA_PREFIX} · ${bankRow.concepto}`;
        const notasCalc = (noAplicaCalc
          ? `Conciliación bancaria (no aplica factura) · ${bankRow.banco} · Ref ${bankRow.referencia || "—"} · ${bankRow.concepto}`
          : `Conciliación bancaria sin factura · ${bankRow.banco} · Ref ${bankRow.referencia || "—"} · ${bankRow.concepto}`
        ).slice(0, 255);
        const montoNuevoBs = Math.abs(bankRow.montoBs || bankRow.montoUsd);

        // Duplicado "sin factura" (no matcheó ninguna CxP) donde algo relevante
        // cambió respecto a lo ya guardado (cuenta, texto o monto): se puede
        // actualizar en vez de reimportarse. No cubre el caso de que la fila
        // pase a matchear una CxP nueva (eso requiere un tipo de registro
        // distinto).
        const duplicadoActualizable =
          !!existente &&
          auto.length === 0 &&
          !!cuentaCodigo &&
          (existente.cuenta_codigo !== cuentaCodigo ||
            existente.notas !== notasCalc ||
            existente.detalle !== detalleCalc.slice(0, 255) ||
            montoCambio);
        return {
          bankRow,
          cxps: cambio ? [] : auto,
          manual: false,
          // Las operaciones de cambio requieren que el usuario indique la
          // contrapartida (lo recibido) antes de poder confirmarse.
          selected: duplicadoActualizable || (!duplicado && !cambio && (auto.length > 0 || !!cuentaCodigo)),
          montoBs: Math.abs(bankRow.montoBs || bankRow.montoUsd),
          cuentaCodigo,
          duplicado,
          duplicadoActualizable,
          existenteId: existente?.id ?? null,
          existenteCuentaAnterior: existente?.cuenta_codigo ?? null,
          notasNuevas: notasCalc,
          detalleNuevo: detalleCalc.slice(0, 255),
          montoCambio,
          montoNuevoBs,
          esCambio: cambio,
          cambioRecibido: "",
          cambioMoneda: bankRow.moneda === "USD" ? "Bs" : "USD",
        };
      });

      // Operaciones de cambio: en vez de pedir el monto recibido a mano, se
      // calcula automático con la tasa paralela del día de cada movimiento.
      // El usuario puede seguir corrigiéndolo si la tasa real de esa
      // operación puntual fue distinta.
      const fechasCambio = Array.from(new Set(initialMatches.filter((m) => m.esCambio).map((m) => m.bankRow.fecha)));
      if (fechasCambio.length > 0) {
        const paralelaPorFecha = new Map<string, number>();
        for (const f of fechasCambio) {
          const { data: par } = await supabase
            .from("tasas_paralela")
            .select("tasa")
            .lte("fecha", f)
            .order("fecha", { ascending: false })
            .limit(1)
            .maybeSingle();
          paralelaPorFecha.set(f, Number((par as any)?.tasa) || 0);
        }
        for (const m of initialMatches) {
          if (!m.esCambio) continue;
          const tasa = paralelaPorFecha.get(m.bankRow.fecha) || 0;
          if (tasa <= 0) continue;
          const recibeUsd = (m.cambioMoneda ?? "USD") === "USD";
          const montoOrigen = Math.abs(m.bankRow.montoBs || m.bankRow.montoUsd);
          // Si el movimiento original es en Bs, lo recibido en USD = Bs / tasa paralela.
          // Si el movimiento original es en USD, lo recibido en Bs = USD * tasa paralela.
          const calculado = recibeUsd ? montoOrigen / tasa : montoOrigen * tasa;
          m.cambioRecibido = calculado.toFixed(2);
          m.selected = !m.duplicado && Number(m.cambioRecibido) > 0;
        }
      }

      setMatches(initialMatches);

      const dups = initialMatches.filter((m) => m.duplicado).length;
      const actualizables = initialMatches.filter((m) => m.duplicadoActualizable).length;
      toast.success(
        `${parsed.length} movimientos cargados${dups ? ` · ${dups} ya importados` : ""}${
          actualizables ? ` · ${actualizables} con cuenta distinta (se pueden actualizar)` : ""
        }`,
      );
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
    const { data: bcv } = await tasaBcvQuery(fecha, "tasa");
    const { data: par } = await supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
    return { bcv: Number(bcv?.tasa ?? 0), paralela: Number(par?.tasa ?? 0) };
  };

  const importable = (m: Match) =>
    m.selected &&
    (!m.duplicado || m.duplicadoActualizable) &&
    !!m.bankRow.cuentaBancariaId &&
    (m.cxps.length > 0 || !!m.cuentaCodigo) &&
    (!m.esCambio || Number(m.cambioRecibido) > 0);

  const setCambioRecibido = (bankRowId: string, valor: string) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.bankRow.id === bankRowId
          ? { ...m, cambioRecibido: valor, selected: !m.duplicado && Number(valor) > 0 }
          : m
      )
    );
  };

  const setCambioMoneda = (bankRowId: string, moneda: "Bs" | "USD") => {
    setMatches((prev) => prev.map((m) => (m.bankRow.id === bankRowId ? { ...m, cambioMoneda: moneda } : m)));
  };

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
    let ok = 0, fail = 0, partial = 0, sinFactura = 0, noAplicaCount = 0, actualizados = 0;
    const importados = new Set<string>();

    // Catálogo de proveedores para adivinar el tercero de los movimientos
    // sin factura (evita filas "en blanco" en la tabla de compras del mes).
    const { proveedorDeMemo } = await import("@/lib/conciliacion-matching");
    const { data: tercerosCat } = await supabase.from("terceros").select("id, razon_social");
    const tercerosRef = (tercerosCat ?? []).map((t: any) => ({ id: t.id, nombre: t.razon_social as string }));
    const facturaDeMemo = (texto: string) => {
      const t = String(texto ?? "").toUpperCase();
      // Con la palabra explícita de factura: separador flexible, número desde 1 dígito/letra.
      let m = t.match(/\b(?:FACTURAS?|FACTS?|FAC)[\s.:#-]*([A-Z0-9-]{1,20})\b/);
      if (m) return m[1];
      // "F" sola (con o sin un espacio después): solo cuenta si justo antes de
      // un dígito (ej. "F4704", "F 9424", "F30FP0885333"). Sin esto, nombres
      // de proveedor o de persona que empiezan con F (FEMSA, Ferretería,
      // Floristería, Franklin, Fonseca, Farfán...) se leían como si el resto
      // del nombre fuera el número de factura.
      m = t.match(/\bF\s?(\d[A-Z0-9-]{0,19})\b/);
      return m ? m[1] : null;
    };

    for (const m of toImport) {
      try {
        const bankRow = m.bankRow;

        // Duplicado con algo distinto: actualizar la transacción existente en
        // vez de crear una nueva. Si solo cambió la cuenta o el texto, no se
        // toca monto/fecha/tasa. Si el monto también cambió (se encontró por
        // referencia, no por huella exacta), se recalcula igual que en un
        // registro nuevo.
        if (m.duplicadoActualizable && m.existenteId) {
          const antes = { cuenta_codigo: m.existenteCuentaAnterior };
          const patch: Record<string, any> = {
            cuenta_codigo: m.cuentaCodigo,
            notas: m.notasNuevas,
            detalle: m.detalleNuevo,
          };
          if (m.montoCambio) {
            const rates = await getRatesForDate(bankRow.fecha);
            const montoBsNuevo =
              bankRow.moneda === "USD" || Math.abs(bankRow.montoBs) === 0
                ? +(Math.abs(bankRow.montoUsd) * (rates.paralela || rates.bcv || 1)).toFixed(2)
                : Math.abs(bankRow.montoBs);
            const montoUsdNuevo =
              rates.paralela > 0 ? +(montoBsNuevo / rates.paralela).toFixed(2) : (rates.bcv > 0 ? +(montoBsNuevo / rates.bcv).toFixed(2) : 0);
            const signo = requiereSignoNegativo(m.cuentaCodigo) ? -1 : 1;
            patch.monto_bs = +(signo * montoBsNuevo).toFixed(2);
            patch.monto_base_bs = +(signo * montoBsNuevo).toFixed(2);
            patch.monto_usd = +(signo * montoUsdNuevo).toFixed(2);
            patch.tasa_bcv = rates.bcv || null;
            patch.tasa_paralela = rates.paralela || null;
            patch.referencia = bankRow.huella; // la huella nueva refleja el monto corregido
          }
          const { data: updated, error: errUpd } = await supabase
            .from("transacciones")
            .update(patch as any)
            .eq("id", m.existenteId)
            .select()
            .maybeSingle();
          if (errUpd) {
            fail++;
          } else {
            actualizados++;
            if (updated) await logAudit("transacciones", "UPDATE", m.existenteId, antes, updated);
          }
          importados.add(bankRow.huella);
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          continue;
        }

        const rates = await getRatesForDate(bankRow.fecha);
        // Variable independiente según el banco: Bs (BA/BCV/BM/BVC/MERC/CxP) o USD (CASH/BOFA).
        const montoBs =
          bankRow.moneda === "USD" || Math.abs(bankRow.montoBs) === 0
            ? +(Math.abs(bankRow.montoUsd) * (rates.paralela || rates.bcv || 1)).toFixed(2)
            : Math.abs(bankRow.montoBs);
        const toUsd = (bs: number) =>
          rates.paralela > 0 ? +(bs / rates.paralela).toFixed(2) : (rates.bcv > 0 ? +(bs / rates.bcv).toFixed(2) : 0);
        // Monto USD del movimiento: si el banco es en USD, el Excel manda (variable independiente).
        const montoUsdMov =
          bankRow.moneda === "USD" || Math.abs(bankRow.montoBs) === 0
            ? +Math.abs(bankRow.montoUsd).toFixed(2)
            : toUsd(montoBs);


        if (m.esCambio) {
          // ── Operación de cambio: dos patas en la cuenta 98 (efecto neto cero) ──
          const recibido = Math.abs(Number(m.cambioRecibido) || 0);
          const recibeUsd = (m.cambioMoneda ?? "USD") === "USD";
          const opBs = recibeUsd ? montoBs : recibido;
          const opUsd = recibeUsd ? recibido : montoUsdMov;
          const tipoOp = recibeUsd ? "Compra USD" : "Venta USD";
          const implicita = opUsd > 0 ? +(opBs / opUsd).toFixed(4) : 0;
          const grupo = crypto.randomUUID();
          const nota = `${tipoOp} · ${bankRow.banco} · Tasa implícita ${implicita} · ${bankRow.concepto}`.slice(0, 255);
          const leg = (signo: 1 | -1, refer: string | null, cuentaBancaria: string | null) => ({
            fecha: bankRow.fecha,
            cuenta_codigo: CUENTA_CAMBIO,
            centro_costo: "Compartido" as any,
            monto_bs: +(signo * opBs).toFixed(2),
            monto_base_bs: +(signo * opBs).toFixed(2),
            iva_bs: 0,
            iva_aplica: false,
            tasa_bcv: rates.bcv || null,
            tasa_paralela: rates.paralela || null,
            monto_usd: +(signo * opUsd).toFixed(2),
            metodo_pago: "transferencia" as any,
            referencia: refer,
            detalle: `${tipoOp} — ${signo < 0 ? "salida" : "entrada"}`,
            notas: nota,
            modo: "on_balance" as any,
            cuenta_bancaria_id: cuentaBancaria,
            grupo_transaccion_id: grupo,
            import_batch_id: batch?.id ?? null,
            created_by: user.id,
          });
          const { data: legs, error: errCambio } = await supabase
            .from("transacciones")
            .insert([leg(-1, bankRow.huella, bankRow.cuentaBancariaId), leg(1, null, null)] as any)
            .select();
          if (errCambio) throw new Error(errCambio.message);
          for (const tx of legs ?? []) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);
          // La pata bancaria queda conciliada de una vez como "no contable":
          // una operación de cambio nunca va a tener factura ni proveedor.
          const legBanco = (legs ?? []).find((l: any) => l.referencia === bankRow.huella) ?? (legs ?? [])[0];
          if (legBanco) {
            await marcarEstadoConciliacion({
              movimientoId: (legBanco as any).id,
              estado: "no_contable",
              userId: user.id,
            });
          }
          noAplicaCount++;
          importados.add(bankRow.id);
          setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
          continue;
        }

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

          // Propinas (13.1) y bono 10% (13.4) ya se devengaron al importar las
          // ventas: el pago bancario descarga el pasivo (signo negativo) y no
          // vuelve a registrar gasto. Devoluciones/NC (1.7) y descuentos (1.6)
          // son contra-ingreso: también van con signo negativo para restar del
          // total de Ingresos en vez de sumar como si fueran una venta más.
          const signo = requiereSignoNegativo(m.cuentaCodigo) ? -1 : 1;
          const montoBsFirmado = +(signo * montoBs).toFixed(2);
          const montoUsdFirmado = +(signo * montoUsdMov).toFixed(2);

          // Proveedor y N° de factura deducidos del concepto bancario, para que
          // la fila no quede "en blanco" en la tabla de compras del mes.
          const provAdivinado = noAplica ? null : proveedorDeMemo(bankRow.concepto, tercerosRef);
          const factAdivinada = noAplica ? null : facturaDeMemo(bankRow.concepto);

          const { data: tx, error } = await supabase.from("transacciones").insert({
            fecha: bankRow.fecha,
            cuenta_codigo: m.cuentaCodigo!,
            centro_costo: "Compartido" as any,
            monto_bs: montoBsFirmado,
            monto_base_bs: montoBsFirmado,
            iva_bs: 0,
            iva_aplica: false,
            tipo_iva: null,
            tasa_bcv: rates.bcv || null,
            tasa_paralela: rates.paralela || null,
            monto_usd: montoUsdFirmado,


            metodo_pago: "transferencia" as any,
            referencia: bankRow.huella,
            detalle: detalle.slice(0, 255),
            notas: notas.slice(0, 255),
            modo: "on_balance" as any,
            cuenta_bancaria_id: bankRow.cuentaBancariaId,
            tercero_id: provAdivinado?.id ?? null,
            numero_factura: factAdivinada,
            grupo_transaccion_id: crypto.randomUUID(),
            import_batch_id: batch?.id ?? null,
            created_by: user.id,
          } as any).select().single();

          if (error) throw new Error(error.message);
          if (tx) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);
          // Cuentas que por naturaleza nunca van a tener factura de Xetux (servicios,
          // transporte, mantenimiento, devoluciones) quedan conciliadas de una vez
          // como "gasto directo", sin esperar revisión manual.
          if (tx && esGastoDirectoAuto(m.cuentaCodigo)) {
            await marcarEstadoConciliacion({
              movimientoId: (tx as any).id,
              estado: "gasto_directo",
              userId: user.id,
            });
          }
          if (noAplica) noAplicaCount++; else sinFactura++;
          importados.add(bankRow.id);
          setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
          continue;
        }

        // ── UNA sola transacción por movimiento (igual que la línea del Excel) ──
        const { calcularSplitIvaPagoCxp } = await import("@/lib/iva-helpers");
        const primera = m.cxps[0];

        const { data: txOrig } = await supabase
          .from("transacciones")
          .select("centro_costo, grupo_transaccion_id")
          .eq("id", primera.transaccion_id ?? "")
          .maybeSingle();
        const grupoId = txOrig?.grupo_transaccion_id ?? crypto.randomUUID();

        const { data: ivaLegs } = await supabase
          .from("transacciones")
          .select("id")
          .eq("grupo_transaccion_id", grupoId)
          .eq("cuenta_codigo", "7.4")
          .gt("monto_bs", 0)
          .limit(1);
        const hasIva = (ivaLegs?.length ?? 0) > 0;
        const split = await calcularSplitIvaPagoCxp(grupoId, montoBs, hasIva);

        const facturasTxt = m.cxps
          .map((c) => c.numero_factura)
          .filter(Boolean)
          .join(", ");

        const { data: tx, error } = await supabase.from("transacciones").insert({
          fecha: bankRow.fecha,
          cuenta_codigo: CUENTA_PAGO_CXP,
          centro_costo: (txOrig?.centro_costo ?? primera.centro_costo ?? "Compartido") as any,
          monto_bs: montoBs,
          monto_base_bs: split.monto_base_bs,
          iva_bs: split.iva_bs,
          iva_aplica: split.iva_bs > 0,
          tipo_iva: null,
          tasa_bcv: rates.bcv || null,
          tasa_paralela: rates.paralela || null,
          monto_usd: montoUsdMov,
          metodo_pago: "transferencia" as any,
          referencia: bankRow.huella,
          detalle: facturasTxt ? `Pago facturas ${facturasTxt}`.slice(0, 255) : null,
          notas: `Conciliación bancaria · ${bankRow.banco} · ${bankRow.concepto}`.slice(0, 255),
          modo: "on_balance" as any,
          cuenta_bancaria_id: bankRow.cuentaBancariaId,
          tercero_id: primera.tercero_id ?? null,
          grupo_transaccion_id: grupoId,
          import_batch_id: batch?.id ?? null,
          created_by: user.id,
        } as any).select().single();

        if (error) throw new Error(error.message);
        if (tx) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);

        // ── Aplicación del pago a las facturas (deuda revaluada a la tasa BCV del día) ──
        const {
          pendienteUsdBcv: pendUsdBcvFn,
          dentroDeTolerancia,
        } = await import("@/lib/cxp-saldo");



        let restanteUsdBcv = rates.bcv > 0 ? +(montoBs / rates.bcv).toFixed(2) : 0;
        for (const cxp of m.cxps) {
          if (restanteUsdBcv <= 0.01) break;
          const pendUsdBcv = pendUsdBcvFn(cxp);
          const aplicarUsdBcv = Math.min(pendUsdBcv, restanteUsdBcv);
          if (aplicarUsdBcv <= 0.01) continue;

          let nuevoUsdBcv = Math.max(0, +(pendUsdBcv - aplicarUsdBcv).toFixed(2));
          // Diferencia despreciable frente a la deuda revaluada → factura pagada.
          const deudaBs = +(pendUsdBcv * (rates.bcv || 1)).toFixed(2);
          const pagadoBs = +(aplicarUsdBcv * (rates.bcv || 1)).toFixed(2);
          if (nuevoUsdBcv > 0 && dentroDeTolerancia(pagadoBs - deudaBs, deudaBs)) nuevoUsdBcv = 0;

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

          // Sin asiento de diferencial cambiario: la variación de tasa queda
          // absorbida en el monto realmente pagado.


          if (cubreTodo) ok++; else partial++;
          restanteUsdBcv = +(restanteUsdBcv - aplicarUsdBcv).toFixed(2);
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
      `Facturas pagadas: ${ok} · Parciales: ${partial} · No aplica factura: ${noAplicaCount} · Sin factura: ${sinFactura}${
        actualizados ? ` · Cuentas actualizadas: ${actualizados}` : ""
      } · Fallidos: ${fail}`
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

  /**
   * Diferencia (solo informativa) entre la deuda revaluada a la tasa BCV del
   * día del pago y lo que efectivamente se paga.
   */
  const difBs = (m: Match) => {
    if (m.cxps.length === 0) return null;
    const tasa = tasaBcvDe(m.bankRow.fecha);
    const facturado = m.cxps.reduce(
      (s, c) => s + pendienteBs(c, tasa),
      0,
    );
    const pagado = Math.abs(m.bankRow.montoBs || 0);
    if (!pagado) return null;
    return +(pagado - facturado).toFixed(2);
  };


  const noAplicaFactura = (m: Match) =>
    !requiereCxP(m.bankRow.categoria) &&
    (cuentaSinFactura(m.cuentaCodigo) || cuentaServicio(m.cuentaCodigo));

  /** Tipo de registro + nota explicativa para la columna de la vista previa. */
  const tipoDe = (m: Match): { tipo: TipoRegistro; nota?: string } => {
    if (m.cxps.length > 0) return { tipo: "pasivo", nota: "Pago de factura (CxP)" };
    const clasif = esPagoPersonal(m.bankRow.concepto, m.bankRow.categoria)
      ? clasificarPagoPersonal(m.bankRow.concepto, m.bankRow.categoria)
      : null;
    const tipo = tipoRegistroDeCuenta(m.cuentaCodigo);
    const nota = clasif && clasif.cuenta === m.cuentaCodigo ? clasif.nota : undefined;
    return { tipo, nota };
  };


  const cxpComboOptions = useMemo(
    () =>
      cxpOptions.map((c) => ({
        value: c.id,
        label: `${c.proveedor ?? "—"} · Fact ${c.numero_factura ?? "—"} · ${fmtUsd(pendienteUsdBcv(c))} USD BCV`,
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
    const actualizables = matches.filter((m) => m.duplicadoActualizable).length;
    const duplicados = matches.filter((m) => m.duplicado && !m.duplicadoActualizable).length;
    const sinCuenta = matches.filter((m) => !m.duplicado && m.cxps.length === 0 && !m.cuentaCodigo).length;
    const noAplica = matches.filter((m) => !m.duplicado && m.cxps.length === 0 && noAplicaFactura(m)).length;
    const sinFactura = matches.filter(
      (m) => !m.duplicado && m.cxps.length === 0 && !!m.cuentaCodigo && !noAplicaFactura(m)
    ).length;
    const selected = matches.filter(importable).length;
    const withAccount = matches.filter((m) => m.bankRow.cuentaBancariaId).length;
    const dudaCuenta = matches.filter((m) => !m.bankRow.cuentaBancariaId).length;
    const difTotal = matches.reduce((s, m) => s + (m.duplicado ? 0 : (difBs(m) ?? 0)), 0);
    return { total, matched, selected, withAccount, dudaCuenta, duplicados, actualizables, sinCuenta, sinFactura, noAplica, difTotal };
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
              {stats.actualizables > 0 && (
                <Badge className="bg-sky-600">Con cuenta distinta (se actualizan): {stats.actualizables}</Badge>
              )}
              {stats.sinCuenta > 0 && (
                <>
                  <Badge variant="destructive">Sin cuenta contable: {stats.sinCuenta}</Badge>
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={asignarPorDeterminar}>
                    Asignar 99 — POR DETERMINAR
                  </Button>
                </>
              )}
              {stats.dudaCuenta > 0 && (
                <Badge className="bg-red-600 text-white hover:bg-red-600">DUDA / NO SABE CUENTA: {stats.dudaCuenta} filas</Badge>
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
                    <th className="p-2 bg-muted">Tipo de registro</th>

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
                        (m.duplicado && !m.duplicadoActualizable
                          ? "opacity-50"
                          : m.duplicadoActualizable
                            ? "bg-sky-50"
                            : m.cxps.length === 0 && !m.cuentaCodigo
                              ? "bg-destructive/5"
                              : "")
                      }
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={m.selected && (!m.duplicado || m.duplicadoActualizable)}
                          onCheckedChange={(v) => setMatchSelected(m.bankRow.id, Boolean(v))}
                          disabled={
                            (m.duplicado && !m.duplicadoActualizable) ||
                            !m.bankRow.cuentaBancariaId ||
                            (m.cxps.length === 0 && !m.cuentaCodigo)
                          }
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
                          {m.duplicado && !m.duplicadoActualizable && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0">Ya importado</Badge>
                          )}
                          {m.duplicadoActualizable && (
                            <Badge className="bg-sky-600 text-[9px] px-1 py-0">
                              Actualizar{m.existenteCuentaAnterior !== m.cuentaCodigo ? ` cuenta: ${m.existenteCuentaAnterior ?? "—"} → ${m.cuentaCodigo}` : ""}
                              {m.montoCambio ? " · monto corregido" : ""}
                            </Badge>
                          )}
                          {!m.duplicado && m.cxps.length === 0 && requiereCxP(m.bankRow.categoria) && (
                            <Badge className="text-[9px] px-1 py-0 bg-blue-600 text-white hover:bg-blue-600">
                              Requiere emparejamiento con CxP
                            </Badge>
                          )}
                          {!m.duplicado && m.cxps.length === 0 && m.cuentaCodigo && noAplicaFactura(m) && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              Gasto directo (sin factura) — afecta G&P y FC
                            </Badge>
                          )}
                          {!m.duplicado && m.cxps.length === 0 && m.cuentaCodigo && !noAplicaFactura(m) && !requiereCxP(m.bankRow.categoria) && (
                            <Badge className="text-[9px] px-1 py-0 bg-orange-500 text-white hover:bg-orange-500">Sin factura</Badge>
                          )}
                          {!m.duplicado && m.cuentaCodigo === "99" && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0">
                              Por determinar — no entra a G&P/FC hasta reclasificar
                            </Badge>
                          )}


                          {!m.duplicado && m.esCambio && (
                            <Badge className="text-[9px] px-1 py-0 bg-violet-600 text-white hover:bg-violet-600">
                              Operación de cambio — no afecta G&P ni FC
                            </Badge>
                          )}
                          {!m.duplicado && dif !== null && dif > 0.01 && (
                            <Badge className="text-[9px] px-1 py-0 bg-amber-500 text-white hover:bg-amber-500">Excedente sin aplicar</Badge>
                          )}
                          {!m.bankRow.cuentaBancariaId && (
                            <Badge className="text-[9px] px-1 py-0 bg-red-600 text-white hover:bg-red-600">
                              DUDA / NO SABE CUENTA
                            </Badge>
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
                          <SelectTrigger className={"w-[160px] text-xs " + (!m.bankRow.cuentaBancariaId ? "border-red-500 text-red-600" : "")}>
                            <SelectValue placeholder="DUDA / NO SABE CUENTA" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none_">DUDA / NO SABE CUENTA</SelectItem>
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
                              Pendiente al {fmtDate(m.bankRow.fecha)}: {fmtBs(pendienteBs(c, tasaBcvDe(m.bankRow.fecha)))}
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
                              label: `Fact ${c.numero_factura ?? "—"} · ${fmtUsd(pendienteUsdBcv(c))} USD BCV · ${fmtBs(pendienteBs(c, tasaBcvDe(m.bankRow.fecha)))} al pago`,
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
                        {m.esCambio && (
                          <div className="mt-1 space-y-1">
                            <div className="text-[10px] text-muted-foreground">
                              Contrapartida recibida (calculada automático con la tasa paralela del día, corrígela si esta operación puntual usó otra tasa):
                            </div>
                            <div className="flex gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                className="h-7 w-[110px] text-xs"
                                placeholder="Recibido"
                                value={m.cambioRecibido ?? ""}
                                onChange={(e) => setCambioRecibido(m.bankRow.id, e.target.value)}
                              />
                              <Select
                                value={m.cambioMoneda ?? "USD"}
                                onValueChange={(v) => setCambioMoneda(m.bankRow.id, v as "Bs" | "USD")}
                              >
                                <SelectTrigger className="h-7 w-[80px] text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="USD">USD</SelectItem>
                                  <SelectItem value="Bs">Bs</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        {(() => {
                          const t = tipoDe(m);
                          return (
                            <>
                              <Badge
                                variant={t.tipo === "pasivo" ? "secondary" : t.tipo === "sin_clasificar" ? "destructive" : "outline"}
                                className="text-[9px] px-1 py-0"
                              >
                                {TIPO_REGISTRO_LABEL[t.tipo]}
                              </Badge>
                              {t.nota && (
                                <div className="text-[10px] text-muted-foreground mt-1 max-w-[180px]">{t.nota}</div>
                              )}
                            </>
                          );
                        })()}
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
