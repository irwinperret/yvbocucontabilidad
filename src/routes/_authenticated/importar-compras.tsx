import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtUsd } from "@/lib/format";
import { numFromCell, parseDateCell, readSheetAOA } from "@/lib/xetux-parse";
import { toast } from "sonner";
import { MesCerradoProvider, useMesCerradoGuard } from "@/lib/mes-cerrado-guard";
import { crearBatch, cerrarBatch, type BatchHandle } from "@/lib/import-batches";
import { ImportacionFallidasWizard, type FilaFallida } from "@/components/importacion-fallidas-wizard";



export const Route = createFileRoute("/_authenticated/importar-compras")({
  component: ImportarCompras,
});

function ImportarCompras() {
  return (
    <MesCerradoProvider>
      <ImportarComprasInner />
    </MesCerradoProvider>
  );
}


type Centro = "YV" | "Bocu" | "Compartido";

type ParsedCompra = {
  idx: number;
  tipo_rif: "V" | "J" | "E" | "G" | "P";
  rif: string;
  proveedor: string;
  numero_factura: string;     // No. de Documento
  numero_control: string;
  numero_orden: string;
  tipo: string;               // FACTURA / NOTA DE ENTREGA / ...
  neto_usd: number;
  iva_usd: number;
  total_usd: number;          // Total + Cargos Adicionales
  fecha: string;              // F. Documento (YYYY-MM-DD)
  include: boolean;
};

function splitRif(raw: string): { tipo_rif: ParsedCompra["tipo_rif"]; rif: string } | null {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  const m = s.match(/^([VJEGP])-?(\d+)/);
  if (!m) return null;
  return { tipo_rif: m[1] as ParsedCompra["tipo_rif"], rif: m[2] };
}

function ImportarComprasInner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [rows, setRows] = useState<ParsedCompra[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Opciones globales para la importación
  const [centroDefault, setCentroDefault] = useState<Centro>("Compartido");
  const [soloFacturas, setSoloFacturas] = useState(false);
  const [offBalance, setOffBalance] = useState(false);
  const [fallidas, setFallidas] = useState<{ row: ParsedCompra; motivo: string }[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [batchActivo, setBatchActivo] = useState<BatchHandle | null>(null);
  const [registradas, setRegistradas] = useState(0);
  const [omitidas, setOmitidas] = useState(0);



  const { data: terceros = [] } = useQuery({
    queryKey: ["terceros-todos-importar-compras"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("*");
      return data ?? [];
    },
  });

  const terceroByRif = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of terceros) m.set(`${t.tipo_rif}-${t.rif}`, t);
    return m;
  }, [terceros]);

  const onFile = async (file: File) => {
    setFileName(file.name);
    setFileSize(file.size);
    setRows([]);
    const aoa = await readSheetAOA(file);
    if (!aoa.length) return toast.error("El archivo está vacío o no se pudo leer");

    // Verificar cabecera (debe coincidir con "Lista de Facturas")
    const header = (aoa[0] || []).map((c) => String(c ?? "").trim().toLowerCase());
    if (!header.some((h) => h.includes("rif")) || !header.some((h) => h.includes("proveedor"))) {
      return toast.error('Formato no reconocido. Sube el reporte "Lista de Facturas" de Xetux.');
    }

    // Columnas 0-indexadas según "Lista de Facturas":
    // 0:# 1:RIF 2:Proveedor 3:CodRecepcion 4:NoOrden 5:NoDoc 6:Tipo 7:NumControl
    // 8:Neto 9:DescArt 10:DescGlobal(K) 11:Subtotal(L) 12:Impuestos(M) 13:ImpAdic(N)
    // 14:ImpRet(O) 15:Total 16:CargosAdic(Q) 17:TotalConCargos 18:FRecepcion 19:FDocumento
    // Fórmulas (todos los valores están en USD BCV):
    //   IVA  = M + N + O                 (Impuestos + ImpAdic + ImpRet)
    //   Neto = L + Q − K                 (Subtotal + CargosAdic − DescGlobal)
    //   Total = Neto + IVA
    const parsed: ParsedCompra[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const rifRaw = String(row[1] ?? "").trim();
      const proveedor = String(row[2] ?? "").trim();
      const numero_orden = String(row[4] ?? "").trim();
      const numero_factura = String(row[5] ?? "").trim();
      const tipo = String(row[6] ?? "").trim();
      const numero_control = String(row[7] ?? "").trim();
      const descGlobal = numFromCell(row[10]);
      const subtotal   = numFromCell(row[11]);
      const impuestos  = numFromCell(row[12]);
      const impAdic    = numFromCell(row[13]);
      const impRet     = numFromCell(row[14]);
      const cargosAdic = numFromCell(row[16]);
      const iva   = +(impuestos + impAdic + impRet).toFixed(2);
      const neto  = +Math.max(0, subtotal + cargosAdic - descGlobal).toFixed(2);
      const total = +(neto + iva).toFixed(2);
      const fecha = parseDateCell(row[19]) || parseDateCell(row[18]);

      if (!proveedor && !rifRaw) continue;
      if (!numero_factura) continue;
      if (total <= 0) continue;

      const rifParts = splitRif(rifRaw) ?? { tipo_rif: "J" as const, rif: rifRaw.replace(/\D/g, "") };

      parsed.push({
        idx: i + 1,
        tipo_rif: rifParts.tipo_rif,
        rif: rifParts.rif,
        proveedor: proveedor || rifRaw,
        numero_factura,
        numero_control,
        numero_orden,
        tipo,
        neto_usd: neto,
        iva_usd: iva,
        total_usd: total,
        fecha,
        include: true,
      });
    }
    setRows(parsed);
    toast.success(`${parsed.length} facturas detectadas`);
  };

  const visibles = useMemo(
    () => rows.filter((r) => !soloFacturas || r.tipo.toUpperCase().includes("FACTURA")),
    [rows, soloFacturas]
  );

  const stats = useMemo(() => {
    const sel = visibles.filter((r) => r.include);
    const totalUsd = sel.reduce((s, r) => s + r.total_usd, 0);
    const sinProveedor = sel.filter((r) => !terceroByRif.has(`${r.tipo_rif}-${r.rif}`)).length;
    const sinFecha = sel.filter((r) => !r.fecha).length;
    return { count: sel.length, totalUsd, sinProveedor, sinFecha };
  }, [visibles, terceroByRif]);

  const toggleRow = (idx: number, v: boolean) =>
    setRows((all) => all.map((r) => (r.idx === idx ? { ...r, include: v } : r)));

  const toggleAll = (v: boolean) => {
    const vis = new Set(visibles.map((r) => r.idx));
    setRows((all) => all.map((r) => (vis.has(r.idx) ? { ...r, include: v } : r)));
  };

  const fetchTasa = async (fecha: string): Promise<{ paralela: number; bcv: number; esParalela: boolean }> => {
    const [{ data: par }, { data: bcv }] = await Promise.all([
      supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("tasas_bcv").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const paralela = Number(par?.tasa ?? 0);
    const bcvN = Number(bcv?.tasa ?? 0);
    return { paralela, bcv: bcvN, esParalela: paralela > 0 };
  };

  const ensureTercero = async (r: ParsedCompra): Promise<string | null> => {
    const k = `${r.tipo_rif}-${r.rif}`;
    const existing = terceroByRif.get(k);
    if (existing) return existing.id;
    const { data, error } = await supabase.from("terceros").insert({
      tipo_rif: r.tipo_rif as any,
      rif: r.rif,
      razon_social: r.proveedor,
      tipo: "proveedor" as any,
    } as any).select().single();
    if (error) {
      // Carrera: si ya existe, busca y devuelve.
      const { data: again } = await supabase.from("terceros").select("id")
        .eq("tipo_rif", r.tipo_rif as any).eq("rif", r.rif).maybeSingle();
      if (again?.id) {
        terceroByRif.set(k, again);
        return again.id;
      }
      toast.error(`No se pudo crear proveedor ${r.proveedor}: ${error.message}`);
      return null;
    }
    terceroByRif.set(k, data);
    return data.id;
  };

  const ensurePeriodoAbierto = useMesCerradoGuard();

  type ResFila = { status: "ok" | "upd" | "dup" | "fail"; motivo?: string };

  const procesarCompra = async (
    r: ParsedCompra,
    opts: {
      centro: Centro;
      offBal: boolean;
      tasas?: { bcv: number; paralela: number };
      tasaCache?: Map<string, { paralela: number; bcv: number; esParalela: boolean }>;
    }
  ): Promise<ResFila> => {
    try {
      if (!r.fecha) return { status: "fail", motivo: "Falta la fecha del documento" };

      let tasas = opts.tasas
        ? { ...opts.tasas, esParalela: opts.tasas.paralela > 0 }
        : opts.tasaCache?.get(r.fecha);
      if (!tasas) {
        tasas = await fetchTasa(r.fecha);
        opts.tasaCache?.set(r.fecha, tasas);
      }
      if (!tasas.bcv) return { status: "fail", motivo: `No hay tasa BCV registrada para ${r.fecha}` };
      const tasaParaUsd = tasas.paralela || tasas.bcv;

      const terceroId = await ensureTercero(r);
      if (!terceroId) return { status: "fail", motivo: `No se pudo crear/encontrar el proveedor ${r.proveedor} (${r.tipo_rif}-${r.rif})` };

      // Dedup por (tercero, numero_factura) sobre transacciones 2.1 y CxP (fuente de verdad)
      const { data: existeArr } = await supabase.from("transacciones")
        .select("id, monto_bs, monto_base_bs, fecha, grupo_transaccion_id")
        .eq("cuenta_codigo", "2.1")
        .eq("tercero_id", terceroId).eq("numero_factura", r.numero_factura).limit(1);
      const existe = existeArr && existeArr.length > 0 ? existeArr[0] : null;

      const { data: cxpDup } = await supabase.from("cuentas_por_pagar")
        .select("id, monto_bs, transaccion_id, estado")
        .eq("tercero_id", terceroId)
        .eq("numero_factura", r.numero_factura)
        .eq("origen", "xetux")
        .limit(1);
      const cxpExiste = cxpDup && cxpDup.length > 0 ? cxpDup[0] : null;

      const ivaAplica = r.iva_usd > 0;
      const baseUsd = ivaAplica ? Math.max(0, r.total_usd - r.iva_usd) : r.total_usd;
      const totalBs = +(r.total_usd * tasas.bcv).toFixed(2);
      const baseBs = +(baseUsd * tasas.bcv).toFixed(2);
      const ivaBs = +(r.iva_usd * tasas.bcv).toFixed(2);
      void tasaParaUsd;

      const offBal = opts.offBal;
      const centro = opts.centro;

      const notaBase = `Xetux · ${r.tipo}${r.numero_control ? ` · Ctrl ${r.numero_control}` : ""}${r.numero_orden ? ` · OC ${r.numero_orden}` : ""}`;

      // Helper para insertar par (2.1 compra + 12.5 IVA) enlazadas por grupo_transaccion_id + CxP pendiente
      const insertCompraTransacciones = async (grupoId: string) => {
        const usdParalela = tasas!.paralela > 0 ? +(baseBs / tasas!.paralela).toFixed(2) : baseUsd;
        const { data: txCompra, error: eCompra } = await supabase.from("transacciones").insert({
          fecha: r.fecha,
          cuenta_codigo: "2.1",
          centro_costo: centro as any,
          modo: offBal ? "off_balance" : "on_balance",
          monto_bs: baseBs,
          monto_base_bs: baseBs,
          iva_bs: 0,
          iva_aplica: false,
          tipo_iva: null,
          monto_usd: usdParalela,
          tasa_bcv: tasas!.bcv || null,
          tasa_paralela: tasas!.paralela || null,
          metodo_pago: "pendiente" as any,
          tercero_id: terceroId,
          numero_factura: r.numero_factura,
          numero_orden: r.numero_orden || null,
          referencia: "xetux",
          notas: notaBase,
          created_by: user!.id,
          grupo_transaccion_id: grupoId,
        } as any).select().single();
        if (eCompra) throw new Error(`2.1 ${r.numero_factura}: ${eCompra.message}`);

        if (ivaAplica && r.iva_usd > 0) {
          const { insertIvaLeg } = await import("@/lib/iva-helpers");
          const ivaUsdParalela = tasas!.paralela > 0 ? +(ivaBs / tasas!.paralela).toFixed(2) : r.iva_usd;
          const ivaRes = await insertIvaLeg({
            fecha: r.fecha,
            centro_costo: centro as any,
            modo: offBal ? "off_balance" : "on_balance",
            monto_bs_iva: ivaBs,
            monto_usd_iva: ivaUsdParalela,
            tasa_bcv: tasas!.bcv || null,
            tasa_paralela: tasas!.paralela || null,
            tercero_id: terceroId,
            numero_factura: r.numero_factura,
            referencia: "xetux-iva",
            notas: notaBase,
            created_by: user!.id,
            grupo_transaccion_id: grupoId,
            tipo: "credito",
          });
          if (!ivaRes) {
            await supabase.from("transacciones").delete().eq("id", (txCompra as any).id);
            throw new Error(`12.5 ${r.numero_factura}: no se pudo registrar IVA, se revirtió la compra`);
          }
        }

        // Crear CxP pendiente vinculada a la compra 2.1 (solo si es on-balance)
        if (!offBal) {
          const usdBcvTotal = tasas!.bcv > 0 ? +(totalBs / tasas!.bcv).toFixed(2) : r.total_usd;
          const usdParTotal = tasas!.paralela > 0 ? +(totalBs / tasas!.paralela).toFixed(2) : r.total_usd;
          const { error: eCxp } = await supabase.from("cuentas_por_pagar").insert({
            proveedor: r.proveedor,
            numero_factura: r.numero_factura,
            tercero_id: terceroId,
            centro_costo: centro as any,
            monto_bs: totalBs,
            monto_usd: usdBcvTotal,
            monto_pendiente_bs: totalBs,
            monto_pendiente_usd_bcv: usdBcvTotal,
            usd_bcv_factura: usdBcvTotal,
            usd_paralelo_factura: usdParTotal,
            tasa_bcv_factura: tasas!.bcv || null,
            tasa_paralela_factura: tasas!.paralela || null,
            fecha_vencimiento: null,
            estado: "pendiente",
            origen: "xetux",
            transaccion_id: (txCompra as any).id,
          } as any);
          if (eCxp) {
            await supabase.from("transacciones").delete().eq("grupo_transaccion_id", grupoId);
            throw new Error(`CxP ${r.numero_factura}: ${eCxp.message}`);
          }
        }
        return (txCompra as any).id as string;
      };

      if (existe) {
        const sameAmount = Math.abs(Number(existe.monto_base_bs || existe.monto_bs || 0) - baseBs) < 0.01;
        if (sameAmount) return { status: "dup" };

        // Distinto monto → borrar par (2.1 + 12.5), CxP y reinsertar
        if (existe.grupo_transaccion_id) {
          await supabase.from("transacciones")
            .delete()
            .eq("grupo_transaccion_id", existe.grupo_transaccion_id)
            .in("cuenta_codigo", ["2.1", "12.5"]);
        } else {
          await supabase.from("transacciones").delete().eq("id", existe.id);
        }
        if (cxpExiste) await supabase.from("cuentas_por_pagar").delete().eq("id", cxpExiste.id);
        try {
          await insertCompraTransacciones(crypto.randomUUID());
        } catch (e: any) {
          return { status: "fail", motivo: e?.message ?? "Error reinsertando la compra" };
        }
        return { status: "upd" };
      }

      // Si no existe 2.1 pero sí CxP huérfana, limpiarla antes de insertar
      if (cxpExiste && !existe) {
        await supabase.from("cuentas_por_pagar").delete().eq("id", cxpExiste.id);
      }

      try {
        await insertCompraTransacciones(crypto.randomUUID());
      } catch (e: any) {
        return { status: "fail", motivo: e?.message ?? "Error registrando la compra" };
      }
      return { status: "ok" };
    } catch (e: any) {
      return { status: "fail", motivo: e?.message ?? "Error desconocido" };
    }
  };

  const importar = async () => {
    if (!user) return;
    const elegibles = visibles.filter((r) => r.include);
    if (!elegibles.length) return toast.error("No hay filas seleccionadas");
    const firstFecha = elegibles.find((r) => r.fecha)?.fecha;
    if (firstFecha) {
      const canContinue = await ensurePeriodoAbierto(firstFecha);
      if (!canContinue) return;
    }

    setBusy(true);
    setProgress({ done: 0, total: elegibles.length });
    const fechasSort = elegibles.map((r) => r.fecha).filter(Boolean).sort();
    const batch: BatchHandle | null = await crearBatch({
      tipo: "compras",
      archivoNombre: fileName,
      archivoTamano: fileSize,
      fechaDesde: fechasSort[0] ?? null,
      fechaHasta: fechasSort[fechasSort.length - 1] ?? null,
      filasLeidas: visibles.length,
      userId: user.id,
    });
    setBatchActivo(batch);
    const tasaCache = new Map<string, { paralela: number; bcv: number; esParalela: boolean }>();
    let ok = 0, dup = 0, upd = 0;
    const nuevasFallidas: { row: ParsedCompra; motivo: string }[] = [];

    // El proceso NUNCA se detiene: las fallas se acumulan y se resuelven al final.
    for (const r of elegibles) {
      const res = await procesarCompra(r, { centro: centroDefault, offBal: offBalance, tasaCache });
      if (res.status === "ok") ok++;
      else if (res.status === "upd") upd++;
      else if (res.status === "dup") dup++;
      else nuevasFallidas.push({ row: r, motivo: res.motivo ?? "Error desconocido" });
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    setFallidas(nuevasFallidas);
    setRegistradas(ok + upd);
    setOmitidas(dup);

    await cerrarBatch(batch, {
      filasRegistradas: ok + upd,
      filasOmitidas: dup + nuevasFallidas.length,
      totalUsd: elegibles.reduce((s, r) => s + (Number(r.total_usd) || 0), 0),
    });

    setBusy(false);
    setProgress(null);
    qc.invalidateQueries();
    toast.success(`Nuevas CxP: ${ok} · Actualizadas: ${upd} · Duplicadas: ${dup} · Fallidas: ${nuevasFallidas.length}`);
    if (ok > 0 || upd > 0) {
      const idsFallidos = new Set(nuevasFallidas.map((f) => f.row.idx));
      const ids = new Set(elegibles.filter((r) => !idsFallidos.has(r.idx)).map((r) => r.idx));
      setRows((all) => all.filter((r) => !ids.has(r.idx)));
    }
  };

  const guardarTasasSiFaltan = async (fecha: string, bcv: number, paralela: number) => {
    if (bcv > 0) {
      const { data: hoyBcv } = await supabase.from("tasas_bcv").select("id").eq("fecha", fecha).maybeSingle();
      if (!hoyBcv) await supabase.from("tasas_bcv").insert({ fecha, tasa: bcv, registrado_por: user?.id ?? null } as any);
    }
    if (paralela > 0) {
      const { data: hoyPar } = await supabase.from("tasas_paralela").select("id").eq("fecha", fecha).maybeSingle();
      if (!hoyPar) await supabase.from("tasas_paralela").insert({ fecha, tasa: paralela, registrado_por: user?.id ?? null } as any);
    }
  };

  const registrarFallida = async (item: FilaFallida, valores: Record<string, any>) => {
    if (!user) return { ok: false, error: "Sesión no válida" };
    const original = fallidas.find((f) => String(f.row.idx) === item.id)?.row;
    if (!original) return { ok: false, error: "Fila no encontrada" };

    const fecha = String(valores.fecha || "").slice(0, 10);
    if (!fecha) return { ok: false, error: "La fecha es obligatoria" };
    const canContinue = await ensurePeriodoAbierto(fecha);
    if (!canContinue) return { ok: false, error: "El mes está cerrado" };

    const bcv = Number(valores.tasa_bcv) || 0;
    const paralela = Number(valores.tasa_paralela) || 0;
    if (!bcv) return { ok: false, error: "Debes indicar la tasa BCV de esa fecha" };
    await guardarTasasSiFaltan(fecha, bcv, paralela);

    const iva = Number(valores.iva_usd) || 0;
    const neto = Number(valores.neto_usd) || 0;
    const row: ParsedCompra = {
      ...original,
      fecha,
      proveedor: String(valores.proveedor || original.proveedor),
      numero_factura: String(valores.numero_factura || original.numero_factura),
      neto_usd: neto,
      iva_usd: iva,
      total_usd: +(neto + iva).toFixed(2),
    };
    const centro = (String(valores.centro || centroDefault) as Centro);

    const res = await procesarCompra(row, { centro, offBal: offBalance, tasas: { bcv, paralela } });
    if (res.status === "fail") return { ok: false, error: res.motivo };

    if (batchActivo) {
      await cerrarBatch(batchActivo, {
        filasRegistradas: registradas + 1,
        filasOmitidas: omitidas + Math.max(0, fallidas.length - 1),
      });
    }
    setRegistradas((n) => n + 1);
    setRows((all) => all.filter((r) => r.idx !== original.idx));
    qc.invalidateQueries();
    return { ok: true };
  };


  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar compras (Xetux)</h1>
        <p className="text-sm text-muted-foreground">
          Sube el reporte <span className="font-semibold">"Lista de Facturas"</span> de Xetux (.xlsx o .xls de Excel 97–2003).
          Cada factura se registra como una compra en COGS e Inventario, convirtiendo USD a Bs con la tasa BCV de la fecha del documento.
          Los proveedores que no existan se crearán automáticamente a partir del RIF.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Archivo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label>Reporte Xetux — Lista de Facturas (.xlsx / .xls)</Label>
          <Input
            type="file"
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          {fileName && <div className="text-xs text-muted-foreground mt-1">{fileName}</div>}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">2. Opciones</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Centro de costo</Label>
                <Select value={centroDefault} onValueChange={(v) => setCentroDefault(v as Centro)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Compartido">Compartido</SelectItem>
                    <SelectItem value="YV">YV</SelectItem>
                    <SelectItem value="Bocu">Bocú</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between border rounded p-2">
                <div>
                  <Label className="text-xs">Solo FACTURA (excluir notas de entrega)</Label>
                  <p className="text-[10px] text-muted-foreground">Filtro de vista; no borra filas.</p>
                </div>
                <Switch checked={soloFacturas} onCheckedChange={setSoloFacturas} />
              </div>

              <div className="flex items-center justify-between border rounded p-2">
                <div>
                  <Label className="text-xs">Registrar como off-balance</Label>
                  <p className="text-[10px] text-muted-foreground">No afecta saldos bancarios ni CxP.</p>
                </div>
                <Switch checked={offBalance} onCheckedChange={setOffBalance} />
              </div>

              <div className="md:col-span-2 text-xs text-muted-foreground border rounded p-2 bg-muted/30">
                Ahora cada compra importada <strong>on-balance</strong> genera una CxP pendiente vinculada a la transacción 2.1. Luego se pagará usando el módulo de conciliación bancaria o “Pagar CxP”. Si usas off-balance, no se crea CxP.
              </div>

            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                3. Vista previa ({visibles.length} filas · {stats.count} seleccionadas · {fmtUsd(stats.totalUsd)})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs">
                <Badge variant="default">Seleccionadas: {stats.count}</Badge>
                {stats.sinProveedor > 0 && (
                  <Badge variant="outline" className="border-amber-400 text-amber-700">
                    Proveedores nuevos: {stats.sinProveedor} (se crearán)
                  </Badge>
                )}
                {stats.sinFecha > 0 && (
                  <Badge variant="destructive">Sin fecha: {stats.sinFecha}</Badge>
                )}
              </div>

              <div className="border rounded overflow-x-auto max-h-[500px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0 z-10 shadow-sm">
                    <tr className="text-left">
                      <th className="p-2 bg-muted w-8">
                        <Checkbox
                          checked={visibles.length > 0 && visibles.every((r) => r.include)}
                          onCheckedChange={(v) => toggleAll(Boolean(v))}
                        />
                      </th>
                      <th className="p-2 bg-muted">Fecha</th>
                      <th className="p-2 bg-muted">Proveedor</th>
                      <th className="p-2 bg-muted">RIF</th>
                      <th className="p-2 bg-muted">Tipo</th>
                      <th className="p-2 bg-muted">N° Documento</th>
                      <th className="p-2 bg-muted text-right">Neto USD</th>
                      <th className="p-2 bg-muted text-right">IVA USD</th>
                      <th className="p-2 bg-muted text-right">Total USD</th>
                      <th className="p-2 bg-muted">Prov.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((r) => {
                      const existe = terceroByRif.has(`${r.tipo_rif}-${r.rif}`);
                      return (
                        <tr key={r.idx} className="border-t">
                          <td className="p-2">
                            <Checkbox checked={r.include} onCheckedChange={(v) => toggleRow(r.idx, Boolean(v))} />
                          </td>
                          <td className="p-2">{r.fecha || <span className="text-destructive">—</span>}</td>
                          <td className="p-2 truncate max-w-[180px]">{r.proveedor}</td>
                          <td className="p-2 font-mono text-[10px]">{r.tipo_rif}-{r.rif}</td>
                          <td className="p-2"><Badge variant="outline" className="text-[10px]">{r.tipo}</Badge></td>
                          <td className="p-2 font-mono">{r.numero_factura}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.neto_usd)}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.iva_usd)}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.total_usd)}</td>
                          <td className="p-2">
                            {existe ? <Badge variant="outline" className="text-emerald-700 border-emerald-300 text-[10px]">existe</Badge>
                                    : <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">nuevo</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {progress ? `Importando ${progress.done}/${progress.total}...` : `Se importarán ${stats.count} compras.`}
                </div>
                <Button onClick={importar} disabled={busy || stats.count === 0}>
                  {busy ? "Importando..." : `Importar ${stats.count} compras`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {fallidas.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              {fallidas.length} fila{fallidas.length === 1 ? "" : "s"} no se pudo registrar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
              {fallidas.map((f) => (
                <li key={f.row.idx} className="flex gap-2">
                  <span className="font-medium">{f.row.numero_factura || `Fila ${f.row.idx + 1}`}</span>
                  <span className="text-muted-foreground">— {f.motivo}</span>
                </li>
              ))}
            </ul>
            <Button variant="destructive" onClick={() => setWizardOpen(true)}>
              Corregir filas fallidas
            </Button>
          </CardContent>
        </Card>
      )}

      <ImportacionFallidasWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        titulo="Corregir compras fallidas"
        campos={[
          { name: "fecha", label: "Fecha", type: "date" },
          { name: "centro", label: "Centro de costo", type: "select", options: [
            { value: "YV", label: "YV" }, { value: "Bocu", label: "Bocu" }, { value: "Compartido", label: "Compartido" },
          ] },
          { name: "proveedor", label: "Proveedor" },
          { name: "numero_factura", label: "N° factura" },
          { name: "neto_usd", label: "Neto (USD BCV)", type: "number" },
          { name: "iva_usd", label: "IVA (USD BCV)", type: "number" },
          { name: "tasa_bcv", label: "Tasa BCV", type: "number" },
          { name: "tasa_paralela", label: "Tasa paralela", type: "number" },
        ]}
        items={fallidas.map((f) => ({
          id: String(f.row.idx),
          titulo: `${f.row.proveedor} · ${f.row.numero_factura || "s/n"}`,
          motivo: f.motivo,
          valores: {
            fecha: f.row.fecha ?? "",
            centro: centroDefault,
            proveedor: f.row.proveedor ?? "",
            numero_factura: f.row.numero_factura ?? "",
            neto_usd: f.row.neto_usd ?? 0,
            iva_usd: f.row.iva_usd ?? 0,
            tasa_bcv: "",
            tasa_paralela: "",
          },
        }))}
        onRegistrar={registrarFallida}
        onPendientesChange={(pend) => {
          const ids = new Set(pend.map((p) => p.id));
          setFallidas((prev) => prev.filter((f) => ids.has(String(f.row.idx))));
        }}
      />



      {progress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border rounded-lg shadow-xl px-8 py-6 min-w-[320px] text-center space-y-3">
            <div className="text-sm text-muted-foreground">Importando compras...</div>
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
