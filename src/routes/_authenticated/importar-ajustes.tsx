import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { numFromCell, parseDateCell } from "@/lib/xetux-parse";
import { fmtUsd } from "@/lib/format";
import { tasaBcvQuery } from "@/lib/tasas";
import { crearBatch, cerrarBatch, type BatchHandle } from "@/lib/import-batches";
import { isPeriodClosed } from "@/lib/audit";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/importar-ajustes")({
  component: ImportarAjustesPage,
  head: () => ({
    meta: [
      { title: "Importar ajustes ventas | YV · Bocú" },
      { name: "description", content: "Importa ajustes de ventas y bonos de servicio desde el archivo de listas." },
    ],
  }),
});

type Fila = {
  fecha: string;
  ventaLista: number;
  ivaLista: number;
  servicioLista: number;
  ajusteVentas: number;
  yv: number;
  bocu: number;
  tasaBcv: number;
  tasaParalela: number;
  estado: "nueva" | "duplicada" | "sin_tasa" | "mes_cerrado";
};

const REF = "ajuste";

const labelNorm = (s: any) =>
  String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Lee la hoja "todo" (o la primera) y ubica las filas por etiqueta en la columna A. */
async function leerAjustes(file: File): Promise<{ fechas: string[]; venta: number[]; iva: number[]; servicio: number[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const nombre = wb.SheetNames.find((n) => labelNorm(n) === "todo") ?? wb.SheetNames[0];
  const ws = wb.Sheets[nombre];
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: "" });

  const buscarFila = (etiquetas: string[]) =>
    aoa.findIndex((row) => {
      const a = labelNorm(row?.[0]);
      return etiquetas.some((e) => a === e);
    });

  const rowVenta = buscarFila(["venta lista"]);
  const rowIva = buscarFila(["iva lista"]);
  const rowServicio = buscarFila(["servicio lista"]);

  // Fila de fechas: la primera fila cuya mayoría de celdas parsee como fecha.
  let rowFechas = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    const celdas = (aoa[i] ?? []).slice(1);
    const ok = celdas.filter((c) => parseDateCell(c)).length;
    if (ok >= 2) { rowFechas = i; break; }
  }
  if (rowFechas < 0 || rowVenta < 0 || rowIva < 0 || rowServicio < 0) {
    throw new Error(
      "No se encontraron las filas esperadas (fechas, 'Venta Lista', 'IVA Lista', 'Servicio Lista') en la hoja.",
    );
  }

  const ancho = Math.max(
    aoa[rowFechas]?.length ?? 0,
    aoa[rowVenta]?.length ?? 0,
    aoa[rowIva]?.length ?? 0,
    aoa[rowServicio]?.length ?? 0,
  );
  const fechas: string[] = [];
  const venta: number[] = [];
  const iva: number[] = [];
  const servicio: number[] = [];
  for (let c = 1; c < ancho; c++) {
    fechas.push(parseDateCell(aoa[rowFechas]?.[c]));
    venta.push(numFromCell(aoa[rowVenta]?.[c]));
    iva.push(numFromCell(aoa[rowIva]?.[c]));
    servicio.push(numFromCell(aoa[rowServicio]?.[c]));
  }
  return { fechas, venta, iva, servicio };
}

function ImportarAjustesPage() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [offBalance, setOffBalance] = useState(true);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resumen, setResumen] = useState<{ registradas: number; omitidas: number; totalBs: number; totalUsd: number } | null>(null);

  const onFile = async (f: File | null) => {
    setFile(f);
    setFilas([]);
    setResumen(null);
    if (!f) return;
    setCargando(true);
    try {
      const { fechas, venta, iva, servicio } = await leerAjustes(f);
      const out: Fila[] = [];
      for (let i = 0; i < fechas.length; i++) {
        const fecha = fechas[i];
        if (!fecha) continue;
        const ventaLista = venta[i] || 0;
        const ivaLista = iva[i] || 0;
        const servicioLista = servicio[i] || 0;
        if (!ventaLista && !ivaLista && !servicioLista) continue;

        const [{ data: bcvRow }, { data: parRow }, dup, cerrado] = await Promise.all([
          tasaBcvQuery(fecha, "tasa"),
          supabase.from("tasas_paralela").select("tasa").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle(),
          supabase.from("transacciones").select("id").eq("referencia", REF).eq("fecha", fecha).limit(1).maybeSingle(),
          isPeriodClosed(fecha),
        ]);
        const tasaBcv = Number(bcvRow?.tasa ?? 0);
        const tasaParalela = Number(parRow?.tasa ?? 0);
        const ajusteVentas = +(ventaLista + ivaLista).toFixed(2);

        let estado: Fila["estado"] = "nueva";
        if (dup?.data) estado = "duplicada";
        else if (cerrado) estado = "mes_cerrado";
        else if (!tasaBcv) estado = "sin_tasa";

        out.push({
          fecha,
          ventaLista,
          ivaLista,
          servicioLista,
          ajusteVentas,
          yv: +(ajusteVentas * 0.2).toFixed(2),
          bocu: +(ajusteVentas * 0.8).toFixed(2),
          tasaBcv,
          tasaParalela,
          estado,
        });
      }
      out.sort((a, b) => a.fecha.localeCompare(b.fecha));
      setFilas(out);
      if (!out.length) toast.info("No se encontraron fechas con valores en las filas de listas.");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo leer el archivo");
    } finally {
      setCargando(false);
    }
  };

  const nuevas = filas.filter((f) => f.estado === "nueva");

  const importar = async () => {
    if (!user || !nuevas.length) return;
    setImportando(true);
    let batch: BatchHandle | null = null;
    let registradas = 0;
    let totalBs = 0;
    let totalUsd = 0;
    try {
      batch = await crearBatch({
        tipo: "ajustes" as any,
        archivoNombre: file?.name ?? "ajustes.xlsx",
        archivoTamano: file?.size ?? null,
        fechaDesde: nuevas[0]?.fecha ?? null,
        fechaHasta: nuevas[nuevas.length - 1]?.fecha ?? null,
        filasLeidas: filas.length,
        userId: user.id,
      });

      for (const f of nuevas) {
        const tasaPar = f.tasaParalela || f.tasaBcv;
        const legs: { cuenta: string; centro: "YV" | "Bocu" | "Compartido"; usdBcv: number; metodo: string; nota: string }[] = [];
        if (f.yv > 0) legs.push({ cuenta: "1.1", centro: "YV", usdBcv: f.yv, metodo: "efectivo_bs", nota: "Ajuste ventas lista (20% YV)" });
        if (f.bocu > 0) legs.push({ cuenta: "1.2", centro: "Bocu", usdBcv: f.bocu, metodo: "efectivo_bs", nota: "Ajuste ventas lista (80% Bocú)" });
        if (f.servicioLista > 0) legs.push({ cuenta: "3.1", centro: "Compartido", usdBcv: f.servicioLista, metodo: "pendiente", nota: "Ajuste servicio lista (Sueldos)" });
        if (!legs.length) continue;

        const grupo = crypto.randomUUID();
        const payloads = legs.map((l) => {
          const bs = +(l.usdBcv * f.tasaBcv).toFixed(2);
          const usd = +(bs / tasaPar).toFixed(2);
          totalBs += bs;
          totalUsd += usd;
          return {
            fecha: f.fecha,
            cuenta_codigo: l.cuenta,
            centro_costo: l.centro as any,
            modo: (offBalance ? "off_balance" : "on_balance") as any,
            monto_bs: bs,
            monto_base_bs: bs,
            iva_bs: 0,
            iva_aplica: false,
            tipo_iva: null,
            tasa_bcv: f.tasaBcv,
            tasa_paralela: f.tasaParalela || null,
            monto_usd: usd,
            metodo_pago: l.metodo as any,
            referencia: REF,
            grupo_transaccion_id: grupo,
            notas: `${l.nota} · ${f.fecha}`,
            created_by: user.id,
            import_batch_id: batch?.id ?? null,
          };
        });
        const { error } = await supabase.from("transacciones").insert(payloads as any);
        if (error) {
          toast.error(`Error en ${f.fecha}: ${error.message}`);
          continue;
        }
        registradas++;
      }

      await cerrarBatch(batch, {
        filasRegistradas: registradas,
        filasOmitidas: filas.length - registradas,
        totalBs: +totalBs.toFixed(2),
        totalUsd: +totalUsd.toFixed(2),
      });

      setResumen({ registradas, omitidas: filas.length - registradas, totalBs, totalUsd });
      toast.success(`${registradas} fecha(s) registradas`);
      await onFileRefresh();
    } finally {
      setImportando(false);
    }
  };

  // Re-evalúa estados (duplicados) tras importar, sin volver a pedir el archivo.
  const onFileRefresh = async () => {
    if (file) await onFile(file);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Importar ajustes ventas</h1>
          <p className="text-sm text-muted-foreground">
            Ajustes de ventas (Venta Lista + IVA Lista) y bonos de servicio. Valores en USD BCV.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/importaciones">Historial de importaciones</Link>
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1 · Archivo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            disabled={cargando || importando}
          />
          <div className="flex items-center justify-between border rounded p-2">
            <div>
              <Label className="text-xs">Registrar como off-balance</Label>
              <p className="text-[10px] text-muted-foreground">No afecta saldos bancarios ni CxP. Activado por defecto.</p>
            </div>
            <Switch checked={offBalance} onCheckedChange={setOffBalance} disabled={importando} />
          </div>
          <div className="text-xs text-muted-foreground">
            Se lee la hoja «todo»: fechas en la fila de encabezado y las filas «Venta Lista», «IVA Lista» y «Servicio Lista».
            Ajuste a ventas = Venta Lista + IVA Lista → 20% cuenta 1.1 (YV) y 80% cuenta 1.2 (Bocú). Servicio Lista → cuenta 3.14 (Otros Bonos, Compartido).
          </div>
          {cargando && <div className="text-sm">Leyendo archivo y tasas…</div>}
        </CardContent>
      </Card>

      {resumen && (
        <Card>
          <CardHeader><CardTitle className="text-base">Resumen de la importación</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Fechas registradas: <b>{resumen.registradas}</b></div>
            <div>Fechas omitidas: <b>{resumen.omitidas}</b></div>
            <div>Total: <b>Bs {resumen.totalBs.toLocaleString("es-VE", { maximumFractionDigits: 2 })}</b> · {fmtUsd(resumen.totalUsd)}</div>
          </CardContent>
        </Card>
      )}

      {filas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              2 · Vista previa — {nuevas.length} nueva(s) de {filas.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left [&>th]:py-2 [&>th]:px-2 whitespace-nowrap">
                    <th>Fecha</th>
                    <th className="text-right">Venta Lista</th>
                    <th className="text-right">IVA Lista</th>
                    <th className="text-right">Ajuste ventas</th>
                    <th className="text-right">1.1 YV (20%)</th>
                    <th className="text-right">1.2 Bocú (80%)</th>
                    <th className="text-right">3.14 Servicio</th>
                    <th className="text-right">Tasa BCV</th>
                    <th className="text-right">Tasa paralela</th>
                    <th className="text-right">Total Bs</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const totalUsdBcv = f.ajusteVentas + f.servicioLista;
                    const bs = totalUsdBcv * f.tasaBcv;
                    return (
                      <tr key={f.fecha} className="border-b [&>td]:py-1.5 [&>td]:px-2 whitespace-nowrap">
                        <td className="font-mono">{f.fecha}</td>
                        <td className="text-right">{fmtUsd(f.ventaLista)}</td>
                        <td className="text-right">{fmtUsd(f.ivaLista)}</td>
                        <td className="text-right font-medium">{fmtUsd(f.ajusteVentas)}</td>
                        <td className="text-right">{fmtUsd(f.yv)}</td>
                        <td className="text-right">{fmtUsd(f.bocu)}</td>
                        <td className="text-right">{fmtUsd(f.servicioLista)}</td>
                        <td className="text-right">{f.tasaBcv ? f.tasaBcv.toFixed(4) : "—"}</td>
                        <td className="text-right">{f.tasaParalela ? f.tasaParalela.toFixed(4) : "—"}</td>
                        <td className="text-right">{bs.toLocaleString("es-VE", { maximumFractionDigits: 2 })}</td>
                        <td>
                          {f.estado === "nueva" && <Badge variant="secondary">Nueva</Badge>}
                          {f.estado === "duplicada" && <Badge variant="outline">Ya registrada</Badge>}
                          {f.estado === "sin_tasa" && <Badge variant="destructive">Sin tasa BCV</Badge>}
                          {f.estado === "mes_cerrado" && <Badge variant="destructive">Mes cerrado</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button onClick={importar} disabled={!nuevas.length || importando}>
              {importando ? "Importando…" : `Confirmar e importar ${nuevas.length} fecha(s)`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
