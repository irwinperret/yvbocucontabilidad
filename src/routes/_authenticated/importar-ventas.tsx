import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import ExcelJS from "exceljs";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/importar-ventas")({
  component: ImportarVentasPage,
});

type ParsedRow = {
  idx: number;
  numero_factura: string;
  cliente: string;
  fecha: string; // YYYY-MM-DD
  total_usd: number;
  iva_usd: number;
  base_usd: number;
  forma_pago_raw: string;
  formas: string[];
  esCxC: boolean;
  esMixto: boolean;
};

const norm = (s: any) => String(s ?? "").trim().toUpperCase();

function parseDateCell(v: any): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  // Handle "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function centroDeFactura(numero_factura: string): Centro {
  const n = parseInt(String(numero_factura).replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 11000 ? "Bocu" : "YV";
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

  // Determine unique payment forms found in parsed rows (single-method only)
  const formasUsadas = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (!r.esMixto) set.add(norm(r.forma_pago_raw));
    return Array.from(set).sort();
  }, [rows]);

  const formasSinMapear = formasUsadas.filter((f) => !mapByForma.has(f));

  const onFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return toast.error("El archivo no tiene hojas");
    const parsed: ParsedRow[] = [];
    // header is on row 1 (per inspection). Data starts row 2.
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const tipo = String(row.getCell(2).value ?? "").trim();
      if (tipo !== "Facturada") return;
      const total = Number(row.getCell(22).value ?? 0); // "Total Venta"
      if (!(total > 0)) return;
      const numero_factura = String(row.getCell(3).value ?? "").trim();
      const cliente = String(row.getCell(8).value ?? "").trim() || "Contado";
      const iva = Number(row.getCell(18).value ?? 0); // "Impuesto"
      const formaRaw = String(row.getCell(32).value ?? "").trim(); // "Formas de Pago"
      const fecha = parseDateCell(row.getCell(36).value); // "Fecha de la factura"
      const formas = formaRaw.split("|").map((s) => s.trim()).filter(Boolean);
      const esMixto = formas.length > 1;
      const esCxC = formas.length === 1 && norm(formas[0]) === "CXC";
      parsed.push({
        idx: rowNumber,
        numero_factura,
        cliente,
        fecha,
        total_usd: total,
        iva_usd: iva,
        base_usd: Math.max(0, total - iva),
        forma_pago_raw: formaRaw,
        formas,
        esMixto,
        esCxC,
      });
    });
    setRows(parsed);
    toast.success(`${parsed.length} facturas detectadas`);
  };

  const updateMap = async (forma: string, patch: { cuenta_bancaria_id?: string | null; metodo_pago?: string }) => {
    const existing = mapByForma.get(norm(forma));
    const payload = {
      forma_pago: norm(forma),
      cuenta_bancaria_id: patch.cuenta_bancaria_id ?? existing?.cuenta_bancaria_id ?? null,
      metodo_pago: patch.metodo_pago ?? existing?.metodo_pago ?? "transferencia",
    };
    const { error } = await supabase.from("xetux_payment_map" as any).upsert(payload as any);
    if (error) return toast.error(error.message);
    refetchMapeo();
  };

  // Stats
  const stats = useMemo(() => {
    let importable = 0, manual = 0, cxc = 0, sinMapeo = 0, totalUsd = 0;
    for (const r of rows) {
      totalUsd += r.total_usd;
      if (r.esMixto) { manual++; continue; }
      if (r.esCxC) { cxc++; importable++; continue; }
      if (!mapByForma.has(norm(r.forma_pago_raw))) { sinMapeo++; continue; }
      importable++;
    }
    return { importable, manual, cxc, sinMapeo, totalUsd };
  }, [rows, mapByForma]);

  const fetchTasa = async (fecha: string): Promise<number> => {
    const { data } = await supabase.from("tasas_bcv").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
    return Number(data?.tasa ?? 0);
  };

  const importar = async () => {
    if (!user) return;
    if (formasSinMapear.length > 0) return toast.error(`Configura el mapeo de: ${formasSinMapear.join(", ")}`);
    const elegibles = rows.filter((r) => !r.esMixto);
    if (!elegibles.length) return toast.error("No hay facturas importables");
    setBusy(true);
    let ok = 0, skip = 0, fail = 0;
    setProgress({ done: 0, total: elegibles.length });

    // Cache de tasas por fecha
    const tasaCache = new Map<string, number>();

    for (const r of elegibles) {
      try {
        if (!r.fecha) { fail++; continue; }
        let tasa = tasaCache.get(r.fecha);
        if (tasa === undefined) {
          tasa = await fetchTasa(r.fecha);
          tasaCache.set(r.fecha, tasa);
        }
        if (!tasa) { fail++; toast.error(`Sin tasa BCV para ${r.fecha} (factura ${r.numero_factura})`); continue; }

        // Skip duplicates por número de factura ya importado de Xetux
        const { data: dup } = await supabase.from("transacciones").select("id").eq("numero_factura", r.numero_factura).eq("referencia", "xetux").limit(1).maybeSingle();
        if (dup) { skip++; continue; }

        const totalBs = r.total_usd * tasa;
        const baseBs = r.base_usd * tasa;
        const ivaBs = r.iva_usd * tasa;

        const formaKey = norm(r.forma_pago_raw);
        const cfg = mapByForma.get(formaKey);

        const esCxC = r.esCxC;
        const centroRow = centroDeFactura(r.numero_factura);
        const cuenta_codigo = esCxC ? cuentaVenta(centroRow, "credito") : cuentaVenta(centroRow, "contado");
        const metodo = (esCxC ? "pendiente" : (cfg?.metodo_pago || "transferencia")) as Metodo;
        const cuenta_bancaria_id = esCxC ? null : (cfg?.cuenta_bancaria_id || null);

        const { data: tx, error } = await supabase.from("transacciones").insert({
          fecha: r.fecha,
          cuenta_codigo,
          centro_costo: centroRow as any,
          monto_bs: totalBs,
          monto_base_bs: baseBs,
          iva_bs: ivaBs,
          iva_aplica: r.iva_usd > 0,
          tipo_iva: r.iva_usd > 0 ? "debito_fiscal" : null,
          tasa_bcv: tasa,
          monto_usd: r.base_usd,
          metodo_pago: metodo as any,
          numero_factura: r.numero_factura,
          referencia: "xetux",
          notas: `Xetux · ${r.cliente}${r.forma_pago_raw ? ` · ${r.forma_pago_raw}` : ""}`,
          modo: "on_balance" as any,
          cuenta_bancaria_id,
          created_by: user.id,
        } as any).select().single();

        if (error) { fail++; toast.error(`Factura ${r.numero_factura}: ${error.message}`); continue; }
        if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);

        if (esCxC && tx) {
          await supabase.from("cuentas_por_cobrar").insert({
            cliente: r.cliente,
            centro_costo: centroRow as any,
            monto_bs: totalBs,
            monto_usd: r.total_usd,
            monto_pendiente_bs: totalBs,
            monto_pendiente_usd: r.total_usd,
            transaccion_id: tx.id,
            estado: "vigente",
          } as any);
        }

        ok++;
      } catch (e: any) {
        fail++;
        toast.error(`Factura ${r.numero_factura}: ${e?.message ?? "error"}`);
      } finally {
        setProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      }
    }

    setBusy(false);
    setProgress(null);
    qc.invalidateQueries();
    toast.success(`Importadas: ${ok} · Duplicadas: ${skip} · Fallidas: ${fail}`);
    if (ok > 0) {
      // Quitar las importadas de la lista para evitar reintentos
      setRows((all) => all.filter((r) => r.esMixto || (!mapByForma.has(norm(r.forma_pago_raw)) && !r.esCxC)));
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar ventas (Xetux)</h1>
        <p className="text-sm text-muted-foreground">Sube el reporte de ventas .xlsx exportado desde Xetux. Los montos se interpretan en USD y se convierten a Bs usando la tasa BCV de la fecha de cada factura.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Archivo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label>Reporte Xetux (.xlsx)</Label>
          <Input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          {fileName && <div className="text-xs text-muted-foreground mt-1">{fileName}</div>}
          <div className="text-xs text-muted-foreground">El centro de costo se asigna automáticamente por número de factura: <span className="font-mono">&gt; 11000 → Bocú</span>, <span className="font-mono">≤ 11000 → YV</span>.</div>
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
                        <Select value={cfg?.metodo_pago ?? "transferencia"} onValueChange={(v) => updateMap(forma, { metodo_pago: v })}>
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
            <CardHeader><CardTitle className="text-base">3. Vista previa ({rows.length} facturas · {fmtUsd(stats.totalUsd)})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs">
                <Badge variant="default">Importables: {stats.importable}</Badge>
                <Badge variant="secondary">CxC: {stats.cxc}</Badge>
                <Badge variant="outline" className="border-orange-400 text-orange-700">Sin mapear: {stats.sinMapeo}</Badge>
                <Badge variant="outline" className="border-amber-400 text-amber-700">Mixtos (manual): {stats.manual}</Badge>
              </div>
              <div className="border rounded overflow-x-auto max-h-[500px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left">
                      <th className="p-2">Factura</th>
                      <th className="p-2">Fecha</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2 text-right">USD</th>
                      <th className="p-2 text-right">IVA USD</th>
                      <th className="p-2">Forma</th>
                      <th className="p-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      let estado: { label: string; cls: string };
                      if (r.esMixto) estado = { label: "Manual (mixto)", cls: "text-amber-700" };
                      else if (r.esCxC) estado = { label: "CxC", cls: "text-blue-700" };
                      else if (!mapByForma.has(norm(r.forma_pago_raw))) estado = { label: "Sin mapear", cls: "text-orange-700" };
                      else estado = { label: "Importable", cls: "text-emerald-700" };
                      return (
                        <tr key={r.idx} className="border-t">
                          <td className="p-2 font-mono">{r.numero_factura}</td>
                          <td className="p-2">{r.fecha}</td>
                          <td className="p-2 truncate max-w-[200px]">{r.cliente}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.total_usd)}</td>
                          <td className="p-2 text-right mono">{fmtUsd(r.iva_usd)}</td>
                          <td className="p-2 font-mono text-[10px]">{r.forma_pago_raw}</td>
                          <td className={`p-2 font-medium ${estado.cls}`}>{estado.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {progress ? `Importando ${progress.done}/${progress.total}...` : `Se importarán ${stats.importable} facturas. Las mixtas y sin mapear quedan fuera.`}
                </div>
                <Button onClick={importar} disabled={busy || stats.importable === 0 || formasSinMapear.length > 0}>
                  {busy ? "Importando..." : `Importar ${stats.importable} facturas`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
