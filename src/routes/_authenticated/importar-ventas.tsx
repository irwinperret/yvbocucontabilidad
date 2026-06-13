import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { METODOS, cuentaVenta, type Centro, type Metodo } from "@/lib/account-helpers";
import { fmtUsd } from "@/lib/format";
import { logAudit } from "@/lib/audit";
import { numFromCell, parseDateCell, readSheetAOA } from "@/lib/xetux-parse";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/importar-ventas")({
  component: ImportarVentasPage,
});

type Clase = "factura" | "descuento" | "nota_credito" | "por_determinar";

type ParsedRow = {
  idx: number;
  numero_factura: string;   // puede ser ""
  numero_orden: string;     // puede ser ""
  clase: Clase;
  tipo_raw: string;         // valor de la columna B tal cual
  cliente: string;
  fecha: string; // YYYY-MM-DD
  total_usd: number;        // absoluto (para descuentos/NC)
  iva_usd: number;
  base_usd: number;         // base = V - IVA (incluye servicio)
  servicio_usd: number;     // columna T — bono de servicio 10%
  propina_usd: number;      // columna W — propina (NO va a ingresos)
  forma_pago_raw: string;
  formas: string[];
  esCxC: boolean;
  esMixto: boolean;
};

const norm = (s: any) => String(s ?? "").trim().toUpperCase();

function centroDeFactura(numero_factura: string): Centro {
  const n = parseInt(String(numero_factura).replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n >= 11000 ? "YV" : "Bocu";
}

function clasificarPorTipo(tipoRaw: string): Clase {
  const t = String(tipoRaw ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (t.includes("nota de credito") || t.includes("nota credito") || t.includes("n/c")) return "nota_credito";
  if (t.includes("desc")) return "descuento";
  return "por_determinar";
}

function ImportarVentasPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: cuentasBancarias = [] } = useQuery({
    queryKey: ["cuentas-bancarias-activas-importar"],
    queryFn: async () => {
      const { data } = await supabase.from("cuentas_bancarias").select("*").eq("activa", true).order("nombre");
      return data ?? [];
    },
  });

  const { data: mapeo = [], refetch: refetchMapeo } = useQuery({
    queryKey: ["xetux-payment-map"],
    queryFn: async () => {
      const { data } = await supabase.from("xetux_payment_map" as any).select("*");
      return (data as any[]) ?? [];
    },
  });

  const mapByForma = useMemo(() => {
    const m = new Map<string, { cuenta_bancaria_id: string | null; metodo_pago: string }>();
    for (const r of mapeo) m.set(norm(r.forma_pago), { cuenta_bancaria_id: r.cuenta_bancaria_id, metodo_pago: r.metodo_pago });
    return m;
  }, [mapeo]);

  const formaKeyOf = (r: ParsedRow) => (r.esMixto ? "MIXTO" : norm(r.forma_pago_raw));

  // Para mapeo solo nos importan las filas tipo "factura" con forma de pago.
  const formasUsadas = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.clase !== "factura") continue;
      const k = formaKeyOf(r);
      if (k) set.add(k);
    }
    return Array.from(set).sort();
  }, [rows]);

  const formasSinMapear = formasUsadas.filter((f) => f !== "CXC" && !mapByForma.has(f));

  const onFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    const aoa = await readSheetAOA(file);
    if (!aoa.length) return toast.error("El archivo está vacío o no se pudo leer");
    const parsed: ParsedRow[] = [];
    // Skip header row (index 0). Columns 0-indexed: B=1, C=2, F=5, H=7, R=17, V=21, AF=31, AK=36.
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const rowNumber = i + 1;
      const tipoRaw = String(row[1] ?? "").trim();
      const numero_factura = String(row[2] ?? "").trim();
      const numero_orden = String(row[5] ?? "").trim();
      const totalRaw = numFromCell(row[21]); // V "Total Venta"
      const cliente = String(row[7] ?? "").trim() || "Contado";
      const iva = numFromCell(row[17]); // R
      const servicio = numFromCell(row[19]); // T "Servicio"
      const propina = numFromCell(row[22]); // W "Propina"
      const formaRaw = String(row[31] ?? "").trim(); // AF
      const fecha = parseDateCell(row[36]); // AK
      const formas = formaRaw.split("|").map((s) => s.trim()).filter(Boolean);
      const esMixto = formas.length > 1;
      const esCxC = formas.length === 1 && norm(formas[0]) === "CXC";

      // Caso A: factura normal
      if (tipoRaw === "Facturada" && numero_factura && totalRaw > 0) {
        parsed.push({
          idx: rowNumber,
          numero_factura,
          numero_orden,
          clase: "factura",
          tipo_raw: tipoRaw,
          cliente, fecha,
          total_usd: totalRaw,
          iva_usd: iva,
          base_usd: Math.max(0, totalRaw - iva),
          servicio_usd: Math.max(0, servicio),
          propina_usd: Math.max(0, propina),
          forma_pago_raw: formaRaw,
          formas, esMixto, esCxC,
        });
        continue;
      }

      // Caso B: sin factura pero con número de orden → clasificar por col B
      if (!numero_factura && numero_orden) {
        const clase = clasificarPorTipo(tipoRaw);
        const absTotal = Math.abs(totalRaw);
        if (absTotal === 0 && clase !== "por_determinar") continue;
        parsed.push({
          idx: rowNumber,
          numero_factura: "",
          numero_orden,
          clase,
          tipo_raw: tipoRaw,
          cliente, fecha,
          total_usd: absTotal,
          iva_usd: Math.abs(iva),
          base_usd: Math.max(0, absTotal - Math.abs(iva)),
          servicio_usd: Math.max(0, servicio),
          propina_usd: Math.max(0, propina),
          forma_pago_raw: formaRaw,
          formas, esMixto, esCxC,
        });
      }
      // En cualquier otro caso (sin factura y sin orden) se descarta.
    }
    setRows(parsed);
    toast.success(`${parsed.length} filas detectadas`);
  };


  const defaultMetodoFor = (forma: string) => (norm(forma) === "MIXTO" ? "tarjeta" : "transferencia");

  const updateMap = async (forma: string, patch: { cuenta_bancaria_id?: string | null; metodo_pago?: string }) => {
    const existing = mapByForma.get(norm(forma));
    const payload = {
      forma_pago: norm(forma),
      cuenta_bancaria_id: patch.cuenta_bancaria_id ?? existing?.cuenta_bancaria_id ?? null,
      metodo_pago: patch.metodo_pago ?? existing?.metodo_pago ?? defaultMetodoFor(forma),
    };
    const { error } = await supabase.from("xetux_payment_map" as any).upsert(payload as any);
    if (error) return toast.error(error.message);
    refetchMapeo();
  };

  const filaImportable = (r: ParsedRow): boolean => {
    if (r.clase === "descuento" || r.clase === "nota_credito" || r.clase === "por_determinar") return true;
    // factura
    if (r.esCxC) return true;
    return mapByForma.has(formaKeyOf(r));
  };

  // Stats
  const stats = useMemo(() => {
    let importable = 0, mixto = 0, cxc = 0, sinMapeo = 0, descuento = 0, notaCredito = 0, porDeterminar = 0, totalUsd = 0;
    for (const r of rows) {
      totalUsd += r.total_usd;
      if (r.clase === "descuento") { descuento++; importable++; continue; }
      if (r.clase === "nota_credito") { notaCredito++; importable++; continue; }
      if (r.clase === "por_determinar") { porDeterminar++; importable++; continue; }
      // factura
      if (r.esCxC) { cxc++; importable++; continue; }
      if (r.esMixto) mixto++;
      if (!mapByForma.has(formaKeyOf(r))) { sinMapeo++; continue; }
      importable++;
    }
    return { importable, mixto, cxc, sinMapeo, descuento, notaCredito, porDeterminar, totalUsd };
  }, [rows, mapByForma]);

  const fetchTasa = async (fecha: string): Promise<{ paralela: number; bcv: number; esParalela: boolean }> => {
    const [{ data: par }, { data: bcv }] = await Promise.all([
      supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("tasas_bcv").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const paralela = Number(par?.tasa ?? 0);
    const bcvN = Number(bcv?.tasa ?? 0);
    return { paralela, bcv: bcvN, esParalela: paralela > 0 };
  };

  const importar = async () => {
    if (!user) return;
    if (formasSinMapear.length > 0) return toast.error(`Configura el mapeo de: ${formasSinMapear.join(", ")}`);
    const elegibles = rows.filter(filaImportable);
    if (!elegibles.length) return toast.error("No hay filas importables");
    setBusy(true);
    let ok = 0, updated = 0, unchanged = 0, fail = 0;
    setProgress({ done: 0, total: elegibles.length });

    const tasaCache = new Map<string, { paralela: number; bcv: number; esParalela: boolean }>();
    const approxEq = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;


    for (const r of elegibles) {
      try {
        if (!r.fecha) { fail++; continue; }
        let tasas = tasaCache.get(r.fecha);
        if (!tasas) {
          tasas = await fetchTasa(r.fecha);
          tasaCache.set(r.fecha, tasas);
        }
        // USD es la fuente de verdad. Bs = USD × tasa paralela (fallback BCV solo si no hay paralela).
        const tasaConv = tasas.paralela || tasas.bcv;
        if (!tasaConv) { fail++; toast.error(`Sin tasa para ${r.fecha} (${r.numero_factura || r.numero_orden})`); continue; }

        const totalBs = +(r.total_usd * tasaConv).toFixed(2);
        const baseBs = +(r.base_usd * tasaConv).toFixed(2);
        const ivaBs = +(r.iva_usd * tasaConv).toFixed(2);

        // Centro: factura → derivado del nº factura; resto (orden) → Bocu por regla.
        const centroRow: Centro = r.clase === "factura" ? centroDeFactura(r.numero_factura) : "Bocu";

        let cuenta_codigo: string;
        let metodo: Metodo;
        let cuenta_bancaria_id: string | null;
        let modo: "on_balance" | "off_balance" = "on_balance";
        let notasExtra = "";

        if (r.clase === "factura") {
          const cfg = mapByForma.get(formaKeyOf(r));
          const esCxC = r.esCxC;
          cuenta_codigo = esCxC ? cuentaVenta(centroRow, "credito") : cuentaVenta(centroRow, "contado");
          metodo = (esCxC ? "pendiente" : (cfg?.metodo_pago || "transferencia")) as Metodo;
          cuenta_bancaria_id = esCxC ? null : (cfg?.cuenta_bancaria_id || null);
        } else if (r.clase === "descuento") {
          cuenta_codigo = "1.6"; // Descuentos sobre ventas
          metodo = "pendiente";
          cuenta_bancaria_id = null;
          notasExtra = " · DESCUENTO";
        } else if (r.clase === "nota_credito") {
          cuenta_codigo = "1.7"; // Devoluciones / NC
          metodo = "pendiente";
          cuenta_bancaria_id = null;
          notasExtra = " · NOTA DE CRÉDITO";
        } else {
          // por_determinar → off_balance, cuenta ventas contado del centro por defecto
          cuenta_codigo = cuentaVenta(centroRow, "contado");
          metodo = "pendiente";
          cuenta_bancaria_id = null;
          modo = "off_balance";
          notasExtra = " · POR DETERMINAR — revisar (tipo Xetux: " + (r.tipo_raw || "vacío") + ")";
        }

        const refIdent = r.numero_factura || r.numero_orden;
        const notasBase = `Xetux · ${r.cliente}${r.forma_pago_raw ? ` · ${r.forma_pago_raw}` : ""}${notasExtra}`;

        const payload = {
          fecha: r.fecha,
          cuenta_codigo,
          centro_costo: centroRow as any,
          monto_bs: baseBs,
          monto_base_bs: baseBs,
          iva_bs: 0,
          iva_aplica: false,
          tipo_iva: null,
          tasa_bcv: tasas.bcv || tasaConv,
          tasa_paralela: tasas.paralela || null,
          monto_usd: r.base_usd,
          metodo_pago: metodo as any,
          numero_factura: r.numero_factura || null,
          numero_orden: r.numero_orden || null,
          referencia: "xetux",
          modo: modo as any,
          cuenta_bancaria_id,
        };

        // Dedup: por número de factura O número de orden con ref=xetux, excluyendo la pierna IVA (1.9)
        let dupQuery = supabase
          .from("transacciones")
          .select("*")
          .eq("referencia", "xetux")
          .neq("cuenta_codigo", "1.9");
        if (r.numero_factura) {
          dupQuery = dupQuery.eq("numero_factura", r.numero_factura);
        } else {
          dupQuery = dupQuery.eq("numero_orden" as any, r.numero_orden);
        }
        const { data: dup } = await dupQuery.limit(1).maybeSingle();

        if (dup) {
          const cambios =
            dup.fecha !== payload.fecha ||
            dup.cuenta_codigo !== payload.cuenta_codigo ||
            dup.centro_costo !== payload.centro_costo ||
            !approxEq(Number(dup.monto_bs), payload.monto_bs) ||
            !approxEq(Number(dup.monto_base_bs), payload.monto_base_bs) ||
            !approxEq(Number(dup.iva_bs), payload.iva_bs) ||
            !approxEq(Number(dup.tasa_bcv), payload.tasa_bcv) ||
            !approxEq(Number(dup.monto_usd), payload.monto_usd) ||
            (dup.metodo_pago ?? null) !== (payload.metodo_pago ?? null) ||
            (dup.cuenta_bancaria_id ?? null) !== (payload.cuenta_bancaria_id ?? null) ||
            ((dup as any).numero_orden ?? null) !== (payload.numero_orden ?? null);

          if (!cambios) { unchanged++; continue; }

          const nuevasNotas = `${notasBase} · [ACTUALIZADA ${new Date().toISOString().slice(0, 10)}]`;
          const { data: tx, error } = await supabase
            .from("transacciones")
            .update({ ...payload, notas: nuevasNotas } as any)
            .eq("id", dup.id)
            .select()
            .single();
          if (error) { fail++; toast.error(`${refIdent}: ${error.message}`); continue; }
          if (tx) await logAudit("transacciones", "UPDATE", tx.id, dup, tx);

          // Sync CxC asociada solo para facturas a crédito
          if (r.clase === "factura" && r.esCxC && tx) {
            const { data: cxcExist } = await supabase
              .from("cuentas_por_cobrar")
              .select("id, estado, monto_pendiente_bs")
              .eq("transaccion_id", tx.id)
              .limit(1)
              .maybeSingle();
            if (cxcExist) {
              if (cxcExist.estado === "vigente") {
                await supabase.from("cuentas_por_cobrar").update({
                  cliente: r.cliente,
                  centro_costo: centroRow as any,
                  monto_bs: totalBs,
                  monto_usd: r.total_usd,
                  monto_pendiente_bs: totalBs,
                  monto_pendiente_usd: r.total_usd,
                  numero_orden: r.numero_orden || null,
                } as any).eq("id", cxcExist.id);
              }
            } else {
              await supabase.from("cuentas_por_cobrar").insert({
                cliente: r.cliente,
                centro_costo: centroRow as any,
                monto_bs: totalBs,
                monto_usd: r.total_usd,
                monto_pendiente_bs: totalBs,
                monto_pendiente_usd: r.total_usd,
                transaccion_id: tx.id,
                estado: "vigente",
                numero_orden: r.numero_orden || null,
              } as any);
            }
          }
          // Re-sincronizar pierna IVA (1.9) por grupo
          if (tx) {
            const { deleteIvaLegsByGrupo, insertIvaLeg } = await import("@/lib/iva-helpers");
            const grupoExistente = (dup as any).grupo_transaccion_id ?? crypto.randomUUID();
            if (!(dup as any).grupo_transaccion_id) {
              await supabase.from("transacciones").update({ grupo_transaccion_id: grupoExistente } as any).eq("id", tx.id);
            }
            await deleteIvaLegsByGrupo(grupoExistente);
            if (r.iva_usd > 0) {
              await insertIvaLeg({
                fecha: r.fecha, centro_costo: centroRow as any, modo: modo as any,
                monto_bs_iva: ivaBs, monto_usd_iva: r.iva_usd,
                tasa_bcv: tasas.bcv || tasaConv, tasa_paralela: tasas.paralela || null,
                numero_factura: r.numero_factura || null, numero_orden: r.numero_orden || null,
                referencia: "xetux", notas: notasBase, created_by: user.id,
                grupo_transaccion_id: grupoExistente, tipo: "debito",
              });
            }
          }
          updated++;
          continue;
        }

        const grupoId = crypto.randomUUID();
        const { data: tx, error } = await supabase.from("transacciones").insert({
          ...payload,
          grupo_transaccion_id: grupoId,
          notas: notasBase,
          created_by: user.id,
        } as any).select().single();

        if (error) { fail++; toast.error(`${refIdent}: ${error.message}`); continue; }
        if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);

        // Pierna IVA (1.9) para nuevas ventas
        if (tx && r.iva_usd > 0) {
          const { insertIvaLeg } = await import("@/lib/iva-helpers");
          await insertIvaLeg({
            fecha: r.fecha, centro_costo: centroRow as any, modo: modo as any,
            monto_bs_iva: ivaBs, monto_usd_iva: r.iva_usd,
            tasa_bcv: tasas.bcv || tasaConv, tasa_paralela: tasas.paralela || null,
            numero_factura: r.numero_factura || null, numero_orden: r.numero_orden || null,
            referencia: "xetux", notas: notasBase, created_by: user.id,
            grupo_transaccion_id: grupoId, tipo: "debito",
          });
        }

        if (r.clase === "factura" && r.esCxC && tx) {
          await supabase.from("cuentas_por_cobrar").insert({
            cliente: r.cliente,
            centro_costo: centroRow as any,
            monto_bs: totalBs,
            monto_usd: r.total_usd,
            monto_pendiente_bs: totalBs,
            monto_pendiente_usd: r.total_usd,
            transaccion_id: tx.id,
            estado: "vigente",
            numero_orden: r.numero_orden || null,
          } as any);
        }

        // ====== Bono de servicio (columna T) ======
        // Solo para facturas con servicio > 0. Cuenta 3.5 (Bocu) o 3.10 (YV).
        if (r.clase === "factura" && r.servicio_usd > 0 && tx && centroRow !== "Compartido") {
          const cuentaBono = centroRow === "YV" ? "3.10" : "3.5";
          const bonoBs = +(r.servicio_usd * tasaConv).toFixed(2);
          // Dedup: ¿existe ya un bono enlazado a esta factura?
          const { data: bonoExist } = await supabase.from("transacciones")
            .select("id, monto_usd")
            .eq("referencia", "xetux")
            .eq("cuenta_codigo", cuentaBono)
            .eq("numero_factura", r.numero_factura)
            .limit(1).maybeSingle();
          const bonoPayload: any = {
            fecha: r.fecha,
            cuenta_codigo: cuentaBono,
            centro_costo: centroRow as any,
            monto_bs: bonoBs, monto_base_bs: bonoBs, iva_bs: 0,
            iva_aplica: false, tipo_iva: null,
            tasa_bcv: tasas.bcv || tasaConv,
            tasa_paralela: tasas.paralela || null,
            monto_usd: r.servicio_usd,
            metodo_pago: "efectivo_usd",
            numero_factura: r.numero_factura,
            referencia: "xetux",
            modo: "on_balance",
            grupo_transaccion_id: grupoId,
            notas: `Xetux · Bono 10% servicio · factura ${r.numero_factura} · ${r.cliente}`,
            created_by: user.id,
          };
          if (bonoExist) {
            await supabase.from("transacciones").update(bonoPayload).eq("id", bonoExist.id);
          } else {
            await supabase.from("transacciones").insert(bonoPayload);
          }
        }

        // ====== Propina (columna W) ======
        // NO va a ingresos/gastos/FC. Solo a tabla propinas.
        if (r.propina_usd > 0 && tx) {
          const propinaBs = +(r.propina_usd * tasaConv).toFixed(2);
          // Dedup: por numero_factura o numero_orden
          const dedupFilter = r.numero_factura
            ? supabase.from("propinas").select("id").eq("numero_factura", r.numero_factura)
            : supabase.from("propinas").select("id").eq("numero_orden", r.numero_orden);
          const { data: propExist } = await dedupFilter.eq("referencia", "xetux").limit(1).maybeSingle();
          const propPayload: any = {
            transaccion_id: tx.id,
            fecha: r.fecha,
            monto_usd: r.propina_usd,
            monto_bs: propinaBs,
            tasa_paralela: tasas.paralela || tasaConv,
            centro_costo: centroRow,
            concepto: "Propina Xetux",
            referencia: "xetux",
            numero_factura: r.numero_factura || null,
            numero_orden: r.numero_orden || null,
            created_by: user.id,
          };
          if (propExist) {
            await supabase.from("propinas").update(propPayload).eq("id", propExist.id);
          } else {
            await supabase.from("propinas").insert(propPayload);
          }
        }

        ok++;
      } catch (e: any) {
        fail++;
        toast.error(`${r.numero_factura || r.numero_orden}: ${e?.message ?? "error"}`);
      } finally {
        setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      }
    }

    setBusy(false);
    setProgress(null);
    qc.invalidateQueries();
    toast.success(`Nuevas: ${ok} · Actualizadas: ${updated} · Sin cambios: ${unchanged} · Fallidas: ${fail}`);
    if (ok > 0) {
      setRows((all) => all.filter((r) => !filaImportable(r)));
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar ventas (Xetux)</h1>
        <p className="text-sm text-muted-foreground">Sube el reporte de ventas exportado desde Xetux (.xlsx o .xls de Excel 97–2003). Los montos se interpretan en USD y se convierten a Bs usando la tasa BCV de la fecha de cada factura.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Archivo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label>Reporte Xetux (.xlsx / .xls)</Label>
          <Input type="file" accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          {fileName && <div className="text-xs text-muted-foreground mt-1">{fileName}</div>}
          <div className="text-xs text-muted-foreground space-y-1 mt-1">
            <div>El centro de costo se asigna automáticamente por número de factura: <span className="font-mono">&gt;= 11000 → YV</span>, <span className="font-mono">&lt; 11000 → Bocú</span>.</div>
            <div>Las filas <span className="font-semibold">sin factura pero con N° de orden</span> se asignan a <span className="font-mono">Bocú</span> y se clasifican por la columna B: <span className="font-mono">"desc*" → Descuento (1.6)</span>, <span className="font-mono">"Nota de Crédito" → NC (1.7)</span>, resto → <span className="font-mono">POR DETERMINAR</span> (off-balance).</div>
          </div>
        </CardContent>
      </Card>


      {rows.length > 0 && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">2. Mapeo de formas de pago</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {cuentasBancarias.length === 0 && (
                <div className="text-sm border rounded p-3 bg-orange-50 border-orange-200 text-orange-900">
                  No hay cuentas bancarias. <Link to="/cuentas-bancarias" className="underline">Agregar</Link>
                </div>
              )}
              <div className="text-xs text-muted-foreground">El mapeo se guarda y se reutiliza en futuras importaciones. CXC no requiere cuenta bancaria (se registra como crédito).</div>
              <div className="space-y-2">
                {formasUsadas.map((forma) => {
                  const cfg = mapByForma.get(forma);
                  const requiereCuenta = forma !== "CXC";
                  return (
                    <div key={forma} className="grid grid-cols-1 md:grid-cols-[180px_1fr_200px] gap-2 items-center border rounded p-2">
                      <div className="font-mono text-sm">
                        {forma}
                        {!cfg && requiereCuenta && <Badge variant="destructive" className="ml-2 text-[10px]">Sin mapear</Badge>}
                      </div>
                      {requiereCuenta ? (
                        <Select value={cfg?.cuenta_bancaria_id ?? ""} onValueChange={(v) => updateMap(forma, { cuenta_bancaria_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Cuenta bancaria" /></SelectTrigger>
                          <SelectContent>
                            {cuentasBancarias.map((c: any) => (
                              <SelectItem key={c.id} value={c.id}>{c.nombre} — {c.banco} ****{(c.numero || "").slice(-4)} {c.moneda}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-xs text-muted-foreground">N/A (crédito)</div>
                      )}
                      {requiereCuenta ? (
                        <Select value={cfg?.metodo_pago ?? defaultMetodoFor(forma)} onValueChange={(v) => updateMap(forma, { metodo_pago: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <div />}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">3. Vista previa ({rows.length} filas · {fmtUsd(stats.totalUsd)})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs">
                <Badge variant="default">Importables: {stats.importable}</Badge>
                <Badge variant="secondary">CxC: {stats.cxc}</Badge>
                <Badge variant="outline" className="border-orange-400 text-orange-700">Sin mapear: {stats.sinMapeo}</Badge>
                <Badge variant="outline" className="border-amber-400 text-amber-700">Mixtos: {stats.mixto}</Badge>
                <Badge variant="outline" className="border-rose-400 text-rose-700">Descuentos: {stats.descuento}</Badge>
                <Badge variant="outline" className="border-violet-400 text-violet-700">N. Crédito: {stats.notaCredito}</Badge>
                <Badge variant="outline" className="border-zinc-400 text-zinc-700">Por determinar: {stats.porDeterminar}</Badge>
              </div>
              <div className="border rounded overflow-x-auto max-h-[500px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0 z-10 shadow-sm">
                    <tr className="text-left">
                      <th className="p-2 bg-muted">Factura</th>
                      <th className="p-2 bg-muted">N° Orden</th>
                      <th className="p-2 bg-muted">Centro</th>
                      <th className="p-2 bg-muted">Fecha</th>
                      <th className="p-2 bg-muted">Cliente</th>
                      <th className="p-2 bg-muted text-right">USD</th>
                      <th className="p-2 bg-muted text-right">IVA USD</th>
                      <th className="p-2 bg-muted">Forma / Tipo</th>
                      <th className="p-2 bg-muted">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      let estado: { label: string; cls: string };
                      if (r.clase === "descuento") estado = { label: "Descuento", cls: "text-rose-700" };
                      else if (r.clase === "nota_credito") estado = { label: "N. Crédito", cls: "text-violet-700" };
                      else if (r.clase === "por_determinar") estado = { label: "Por determinar", cls: "text-zinc-700" };
                      else if (r.esCxC) estado = { label: "CxC", cls: "text-blue-700" };
                      else if (!mapByForma.has(formaKeyOf(r))) estado = { label: "Sin mapear", cls: "text-orange-700" };
                      else estado = { label: r.esMixto ? "Mixto" : "Importable", cls: r.esMixto ? "text-amber-700" : "text-emerald-700" };
                      const centroRow: Centro = r.clase === "factura" ? centroDeFactura(r.numero_factura) : "Bocu";
                      return (
                        <tr key={r.idx} className="border-t">
                          <td className="p-2 font-mono">{r.numero_factura || "—"}</td>
                          <td className="p-2 font-mono">{r.numero_orden || "—"}</td>
                          <td className="p-2"><Badge variant="outline" className="text-[10px]">{centroRow}</Badge></td>
                          <td className="p-2">{r.fecha}</td>
                          <td className="p-2 truncate max-w-[180px]">{r.cliente}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.total_usd)}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.iva_usd)}</td>
                          <td className="p-2 font-mono text-[10px]">{r.clase === "factura" ? r.forma_pago_raw : r.tipo_raw}</td>
                          <td className={`p-2 font-medium ${estado.cls}`}>{estado.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {progress ? `Importando ${progress.done}/${progress.total}...` : `Se importarán ${stats.importable} filas. Las que están sin mapear quedan fuera.`}
                </div>
                <Button onClick={importar} disabled={busy || stats.importable === 0 || formasSinMapear.length > 0}>
                  {busy ? "Importando..." : `Importar ${stats.importable} filas`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {progress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border rounded-lg shadow-xl px-8 py-6 min-w-[320px] text-center space-y-3">
            <div className="text-sm text-muted-foreground">Importando filas...</div>
            <div className="text-3xl font-bold mono">
              {progress.done} <span className="text-muted-foreground text-xl">/ {progress.total}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-150"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground">Por favor espera, no cierres esta página.</div>
          </div>
        </div>
      )}
    </div>
  );
}
