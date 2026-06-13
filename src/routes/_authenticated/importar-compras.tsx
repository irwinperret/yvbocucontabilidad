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

export const Route = createFileRoute("/_authenticated/importar-compras")({
  component: ImportarComprasPage,
});

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

function ImportarComprasPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [rows, setRows] = useState<ParsedCompra[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Opciones globales para la importación
  const [centroDefault, setCentroDefault] = useState<Centro>("Compartido");
  const [soloFacturas, setSoloFacturas] = useState(false);
  const [offBalance, setOffBalance] = useState(false);



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
    // 8:Neto 9:DescArt 10:DescGlobal 11:Subtotal 12:Impuestos 13:ImpAdic 14:ImpRet
    // 15:Total 16:CargosAdic 17:TotalConCargos 18:FRecepcion 19:FDocumento
    const parsed: ParsedCompra[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const rifRaw = String(row[1] ?? "").trim();
      const proveedor = String(row[2] ?? "").trim();
      const numero_orden = String(row[4] ?? "").trim();
      const numero_factura = String(row[5] ?? "").trim();
      const tipo = String(row[6] ?? "").trim();
      const numero_control = String(row[7] ?? "").trim();
      const iva = numFromCell(row[12]);
      const totalConCargos = numFromCell(row[17]);
      const total = totalConCargos || numFromCell(row[15]);
      const neto = numFromCell(row[8]) || Math.max(0, total - iva);
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

  const importar = async () => {
    if (!user) return;
    const elegibles = visibles.filter((r) => r.include);
    if (!elegibles.length) return toast.error("No hay filas seleccionadas");

    setBusy(true);
    setProgress({ done: 0, total: elegibles.length });
    const tasaCache = new Map<string, { paralela: number; bcv: number; esParalela: boolean }>();
    let ok = 0, dup = 0, fail = 0, upd = 0;


    for (const r of elegibles) {
      try {
        if (!r.fecha) { fail++; toast.error(`Sin fecha: ${r.numero_factura}`); continue; }
        let tasas = tasaCache.get(r.fecha);
        if (!tasas) {
          tasas = await fetchTasa(r.fecha);
          tasaCache.set(r.fecha, tasas);
        }
        // USD es la fuente de verdad. Convertimos a Bs con tasa paralela (con fallback a BCV solo si no hay paralela).
        const tasaConv = tasas.paralela || tasas.bcv;
        if (!tasaConv) { fail++; toast.error(`Sin tasa para ${r.fecha} (${r.numero_factura})`); continue; }

        const terceroId = await ensureTercero(r);
        if (!terceroId) { fail++; continue; }

        // Dedup por (tercero, numero_factura) — busca en TODOS los meses
        const { data: existeArr } = await supabase.from("inventario_snapshots")
          .select("id, monto_bs, monto_usd, monto_base_bs, iva_bs, fecha, periodo, cxp_id, pagada")
          .eq("tipo", "compra")
          .eq("tercero_id", terceroId).eq("numero_factura", r.numero_factura).limit(1);
        const existe = existeArr && existeArr.length > 0 ? existeArr[0] : null;

        const ivaAplica = r.iva_usd > 0;
        const baseUsd = ivaAplica ? Math.max(0, r.total_usd - r.iva_usd) : r.total_usd;
        const totalBs = +(r.total_usd * tasaConv).toFixed(2);
        const baseBs = +(baseUsd * tasaConv).toFixed(2);
        const ivaBs = +(r.iva_usd * tasaConv).toFixed(2);
        const periodo = r.fecha.slice(0, 7);

        const offBal = offBalance;
        const pagada = true; // Xetux: siempre asumir pagada

        const notaBase = `Xetux · ${r.tipo}${r.numero_control ? ` · Ctrl ${r.numero_control}` : ""}${r.numero_orden ? ` · OC ${r.numero_orden}` : ""}`;

        if (existe) {
          // Duplicado: comparamos por USD (fuente de verdad). Si no cambió, saltar.
          const sameAmount = Math.abs(Number(existe.monto_usd || 0) - r.total_usd) < 0.01;
          if (sameAmount) {
            dup++;
            toast.warning(`Duplicada (${existe.periodo}): ${r.proveedor} #${r.numero_factura} — mismo monto, omitida`);
            continue;
          }
          const { error: updErr } = await supabase.from("inventario_snapshots").update({
            monto_bs: totalBs, monto_base_bs: baseBs, iva_bs: ivaBs, iva_aplica: ivaAplica,
            monto_usd: r.total_usd, monto_base_usd: baseUsd, iva_usd: r.iva_usd,
            tasa_bcv: tasas.bcv || null, tasa_paralela: tasas.paralela || null,
            fecha: r.fecha, periodo,
            pagada: true, cuenta_bancaria_id: null,
            notas: notaBase + " · actualizada por reimportación",
          } as any).eq("id", existe.id);
          if (updErr) { fail++; toast.error(`${r.numero_factura}: ${updErr.message}`); continue; }
          if (existe.cxp_id) {
            await supabase.from("cuentas_por_pagar").update({
              estado: "pagada", monto_pendiente_bs: 0,
              monto_bs: totalBs, monto_usd: r.total_usd,
            } as any).eq("id", existe.cxp_id);
          }
          // Resync pierna IVA (2.3) — dedup por (referencia, numero_factura)
          await supabase.from("transacciones").delete()
            .eq("referencia", "xetux-iva").eq("numero_factura", r.numero_factura);
          if (ivaAplica && r.iva_usd > 0) {
            const { insertIvaLeg } = await import("@/lib/iva-helpers");
            await insertIvaLeg({
              fecha: r.fecha, centro_costo: "Compartido" as any,
              modo: offBal ? "off_balance" : "on_balance",
              monto_bs_iva: ivaBs, monto_usd_iva: r.iva_usd,
              tasa_bcv: tasas.bcv || null, tasa_paralela: tasas.paralela || null,
              tercero_id: terceroId, numero_factura: r.numero_factura,
              referencia: "xetux-iva", notas: notaBase,
              created_by: user.id,
              grupo_transaccion_id: crypto.randomUUID(),
              tipo: "credito",
            });
          }
          upd++;
          toast.warning(`Duplicada (${existe.periodo}): ${r.proveedor} #${r.numero_factura} — actualizada al nuevo monto`);
          continue;
        }

        const { error } = await supabase.from("inventario_snapshots").insert({
          periodo, tipo: "compra",
          monto_bs: totalBs, monto_base_bs: baseBs, iva_bs: ivaBs, iva_aplica: ivaAplica,
          monto_usd: r.total_usd, monto_base_usd: baseUsd, iva_usd: r.iva_usd,
          modo: offBal ? "off_balance" : "on_balance",
          fecha: r.fecha, tasa_bcv: tasas.bcv || null, tasa_paralela: tasas.paralela || null,
          tercero_id: terceroId, numero_factura: r.numero_factura,
          pagada,
          cuenta_bancaria_id: null,
          cxp_id: null,
          notas: notaBase,
          registrado_por: user.id,
        } as any);

        if (error) { fail++; toast.error(`${r.numero_factura}: ${error.message}`); continue; }

        // Pierna IVA crédito (2.3) para compras nuevas
        if (ivaAplica && r.iva_usd > 0) {
          const { insertIvaLeg } = await import("@/lib/iva-helpers");
          await insertIvaLeg({
            fecha: r.fecha, centro_costo: "Compartido" as any,
            modo: offBal ? "off_balance" : "on_balance",
            monto_bs_iva: ivaBs, monto_usd_iva: r.iva_usd,
            tasa_bcv: tasas.bcv || null, tasa_paralela: tasas.paralela || null,
            tercero_id: terceroId, numero_factura: r.numero_factura,
            referencia: "xetux-iva", notas: notaBase,
            created_by: user.id,
            grupo_transaccion_id: crypto.randomUUID(),
            tipo: "credito",
          });
        }
        ok++;
      } catch (e: any) {
        fail++;
        toast.error(`${r.numero_factura}: ${e?.message ?? "error"}`);
      } finally {
        setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      }
    }

    setBusy(false);
    setProgress(null);
    qc.invalidateQueries();
    toast.success(`Nuevas: ${ok} · Actualizadas: ${upd} · Duplicadas: ${dup} · Fallidas: ${fail}`);
    if (ok > 0 || upd > 0) {
      const ids = new Set(elegibles.map((r) => r.idx));
      setRows((all) => all.filter((r) => !ids.has(r.idx)));
    }
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
                Todas las compras importadas se registran como <strong>pagadas</strong> (sin cuenta bancaria asociada). No se crean cuentas por pagar.
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
                      <th className="p-2 bg-muted text-right">USD</th>
                      <th className="p-2 bg-muted text-right">IVA USD</th>
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
                          <td className="p-2 text-right mono">{fmtUsd(r.total_usd)}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.iva_usd)}</td>
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
