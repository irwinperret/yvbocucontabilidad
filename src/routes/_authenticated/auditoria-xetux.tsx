import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { fmtUsd, fmtDate } from "@/lib/format";
import { readSheetAOA } from "@/lib/xetux-parse";
import {
  parseVentasAcumulado,
  parseComprasAcumulado,
  auditarVentas,
  auditarCompras,
  puedeAuditarXetux,
  type AuditVentaRow,
  type AuditCompraRow,
  type AuditResultado,
  type ResumenMensual,
} from "@/lib/xetux-auditoria";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLOR_XETUX = "#00BFFF";
const COLOR_SISTEMA = "#0F6E56";

/** Nombre corto del mes para el eje X, a partir de "2026-05". */
function etiquetaMes(mes: string): string {
  const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const [anio, m] = mes.split("-");
  const idx = parseInt(m, 10) - 1;
  return `${MESES_CORTOS[idx] ?? m}-${anio.slice(2)}`;
}

function ResumenMensualChart({ porMes }: { porMes: ResumenMensual[] }) {
  if (!porMes.length) return null;
  const data = porMes.map((m) => ({ ...m, mesLabel: etiquetaMes(m.mes) }));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Comparación mensual: Xetux vs. sistema</p>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="mesLabel" fontSize={11} />
            <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} fontSize={11} width={45} />
            <Tooltip formatter={(v: number) => fmtUsd(v)} />
            <Legend />
            <Bar dataKey="totalXetux" name="Total Xetux" fill={COLOR_XETUX} radius={[4, 4, 0, 0]} />
            <Bar dataKey="totalSistema" name="Total sistema" fill={COLOR_SISTEMA} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b">
            <tr>
              <th className="text-left py-1.5 px-2">Mes</th>
              <th className="text-right py-1.5 px-2">Total Xetux</th>
              <th className="text-right py-1.5 px-2">Total sistema</th>
              <th className="text-right py-1.5 px-2">Diferencia</th>
              <th className="text-right py-1.5 px-2">Docs. Xetux</th>
              <th className="text-right py-1.5 px-2">Docs. sistema</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.mes} className="border-b last:border-0">
                <td className="py-1.5 px-2 mono">{m.mesLabel}</td>
                <td className="py-1.5 px-2 text-right mono">{fmtUsd(m.totalXetux)}</td>
                <td className="py-1.5 px-2 text-right mono">{fmtUsd(m.totalSistema)}</td>
                <td className={`py-1.5 px-2 text-right mono font-medium ${Math.abs(m.diffUsd) < 1 ? "text-green-600" : "text-destructive"}`}>
                  {m.diffUsd > 0 ? "+" : ""}{fmtUsd(m.diffUsd)}
                </td>
                <td className="py-1.5 px-2 text-right mono">{m.docsXetux}</td>
                <td className="py-1.5 px-2 text-right mono">{m.docsSistema}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Un mes con "Total Xetux" en 0 normalmente significa que el archivo que subiste no cubre ese mes -- no que todo
        lo de ese mes se haya anulado.
      </p>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/auditoria-xetux")({
  component: AuditoriaXetuxPage,
});

const LIMITE_FILAS = 200;

function AuditoriaXetuxPage() {
  const { user } = useAuth();
  if (!puedeAuditarXetux(user?.email)) {
    return (
      <div className="max-w-xl">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No tienes acceso a esta pantalla.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auditoría Xetux</h1>
        <p className="text-sm text-muted-foreground">
          Sube el reporte ACUMULADO de ventas y/o de compras de Xetux (todo el histórico que acabas de descargar, no
          un mes suelto) para comparar documento por documento contra lo que ya está registrado aquí. Esta pantalla
          solo diagnostica -- no crea, actualiza ni borra nada por sí sola.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Para aplicar lo que encuentre, usa las herramientas que ya existen y son reversibles: sube el mismo archivo
          en <Link to="/importar-ventas" className="text-primary hover:underline">Importar ventas</Link> o{" "}
          <Link to="/importar-compras" className="text-primary hover:underline">Importar compras</Link> para crear
          las faltantes y corregir las que cambiaron de valor (ese importador ya actualiza automáticamente lo que
          encuentra distinto), y revisa las posiblemente anuladas una por una en{" "}
          <Link to="/transacciones" className="text-primary hover:underline">Transacciones</Link>, donde borrar una
          ahora se puede deshacer por 30 segundos si te equivocas.
        </p>
      </div>

      <AuditoriaVentasCard />
      <AuditoriaComprasCard />
    </div>
  );
}

function ResumenBadges({ r }: { r: AuditResultado<any> }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <Badge variant="outline" className="border-amber-500 text-amber-700">Faltantes: {r.faltantes.length}</Badge>
      <Badge variant="outline" className="border-destructive text-destructive">Discrepancias: {r.discrepancias.length}</Badge>
      <Badge variant="outline" className="border-green-600 text-green-700">Sin cambios: {r.sinCambios}</Badge>
      <Badge variant="outline" className="border-purple-500 text-purple-700">Posiblemente anuladas: {r.anuladas.length}</Badge>
    </div>
  );
}

function NotaAproximado() {
  return (
    <p className="text-[11px] text-muted-foreground flex items-start gap-1">
      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
      El monto marcado "aprox." no pasó por una factura/CxP con el total completo en un solo campo -- puede diferir
      por tasa de cambio aunque el documento sí esté registrado. Verifícalo manualmente antes de actuar.
    </p>
  );
}

function AuditoriaVentasCard() {
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<AuditResultado<AuditVentaRow> | null>(null);
  const [totalFilas, setTotalFilas] = useState(0);

  const onFile = async (file: File) => {
    setFileName(file.name);
    setBusy(true);
    setResultado(null);
    try {
      const aoa = await readSheetAOA(file);
      if (!aoa.length) { toast.error("El archivo está vacío o no se pudo leer"); return; }
      const rows = parseVentasAcumulado(aoa);
      if (!rows.length) { toast.error("No se detectaron filas con número de factura u orden"); return; }
      setTotalFilas(rows.length);
      const r = await auditarVentas(rows);
      setResultado(r);
      toast.success(`${rows.length} documentos comparados`);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo auditar el archivo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Ventas acumuladas</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Reporte de ventas Xetux (.xlsx / .xls) -- acumulado completo</Label>
          <Input
            type="file"
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          {fileName && <div className="text-xs text-muted-foreground">{fileName}</div>}
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Comparando {totalFilas || "..."} documentos contra el sistema…
          </div>
        )}

        {resultado && (
          <div className="space-y-3">
            <ResumenBadges r={resultado} />
            <ResumenMensualChart porMes={resultado.porMes} />
            <Accordion type="multiple" className="w-full">
              <AccordionItem value="faltantes">
                <AccordionTrigger>Faltantes ({resultado.faltantes.length})</AccordionTrigger>
                <AccordionContent>
                  <TablaVentasFaltantes rows={resultado.faltantes} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="discrepancias">
                <AccordionTrigger>Discrepancias ({resultado.discrepancias.length})</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  <TablaVentasDiscrepancias rows={resultado.discrepancias} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="anuladas">
                <AccordionTrigger>Posiblemente anuladas en Xetux ({resultado.anuladas.length})</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  <TablaAnuladas rows={resultado.anuladas} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditoriaComprasCard() {
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<AuditResultado<AuditCompraRow> | null>(null);
  const [totalFilas, setTotalFilas] = useState(0);

  const onFile = async (file: File) => {
    setFileName(file.name);
    setBusy(true);
    setResultado(null);
    try {
      const aoa = await readSheetAOA(file);
      if (!aoa.length) { toast.error("El archivo está vacío o no se pudo leer"); return; }
      const rows = parseComprasAcumulado(aoa);
      if (!rows.length) { toast.error("No se detectaron facturas con número de documento"); return; }
      setTotalFilas(rows.length);
      const r = await auditarCompras(rows);
      setResultado(r);
      toast.success(`${rows.length} facturas comparadas`);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo auditar el archivo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Compras acumuladas</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Reporte "Lista de Facturas" de compras Xetux (.xlsx / .xls) -- acumulado completo</Label>
          <Input
            type="file"
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          {fileName && <div className="text-xs text-muted-foreground">{fileName}</div>}
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Comparando {totalFilas || "..."} facturas contra el sistema…
          </div>
        )}

        {resultado && (
          <div className="space-y-3">
            <ResumenBadges r={resultado} />
            <ResumenMensualChart porMes={resultado.porMes} />
            <Accordion type="multiple" className="w-full">
              <AccordionItem value="faltantes">
                <AccordionTrigger>Faltantes ({resultado.faltantes.length})</AccordionTrigger>
                <AccordionContent>
                  <TablaComprasFaltantes rows={resultado.faltantes} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="discrepancias">
                <AccordionTrigger>Discrepancias ({resultado.discrepancias.length})</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  <TablaComprasDiscrepancias rows={resultado.discrepancias} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="anuladas">
                <AccordionTrigger>Posiblemente anuladas en Xetux ({resultado.anuladas.length})</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  <TablaAnuladas rows={resultado.anuladas} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TablaVentasFaltantes({ rows }: { rows: AuditVentaRow[] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Ninguna -- todo lo que trae el archivo ya está registrado.</p>;
  const visibles = rows.slice(0, LIMITE_FILAS);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b">
          <tr>
            <th className="text-left py-1.5 px-2">N° factura / orden</th>
            <th className="text-left py-1.5 px-2">Cliente</th>
            <th className="text-left py-1.5 px-2">Fecha</th>
            <th className="text-right py-1.5 px-2">Total Xetux</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((r) => (
            <tr key={r.idx} className="border-b last:border-0">
              <td className="py-1.5 px-2 mono">{r.numero_factura || r.numero_orden || "—"}</td>
              <td className="py-1.5 px-2">{r.cliente}</td>
              <td className="py-1.5 px-2 mono">{r.fecha ? fmtDate(r.fecha) : "—"}</td>
              <td className="py-1.5 px-2 text-right mono">{fmtUsd(r.total_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > LIMITE_FILAS && (
        <p className="text-[11px] text-muted-foreground mt-1">Mostrando las primeras {LIMITE_FILAS} de {rows.length}.</p>
      )}
    </div>
  );
}

function TablaVentasDiscrepancias({ rows }: { rows: AuditResultado<AuditVentaRow>["discrepancias"] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Ninguna -- los montos coinciden con lo registrado.</p>;
  const visibles = rows.slice(0, LIMITE_FILAS);
  const hayAprox = rows.some((d) => d.aproximado);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b">
            <tr>
              <th className="text-left py-1.5 px-2">N° factura / orden</th>
              <th className="text-left py-1.5 px-2">Cliente</th>
              <th className="text-right py-1.5 px-2">Total Xetux</th>
              <th className="text-right py-1.5 px-2">Total sistema</th>
              <th className="text-right py-1.5 px-2">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((d) => (
              <tr key={d.xetux.idx} className="border-b last:border-0">
                <td className="py-1.5 px-2 mono">{d.xetux.numero_factura || d.xetux.numero_orden || "—"}</td>
                <td className="py-1.5 px-2">{d.xetux.cliente}</td>
                <td className="py-1.5 px-2 text-right mono">{fmtUsd(d.xetux.total_usd)}</td>
                <td className="py-1.5 px-2 text-right mono">
                  {fmtUsd(d.totalSistema)}{d.aproximado && <span className="text-[10px] text-muted-foreground"> (aprox.)</span>}
                </td>
                <td className={`py-1.5 px-2 text-right mono font-medium ${d.diffUsd > 0 ? "text-amber-600" : "text-destructive"}`}>
                  {d.diffUsd > 0 ? "+" : ""}{fmtUsd(d.diffUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > LIMITE_FILAS && (
          <p className="text-[11px] text-muted-foreground mt-1">Mostrando las primeras {LIMITE_FILAS} de {rows.length}.</p>
        )}
      </div>
      {hayAprox && <NotaAproximado />}
    </div>
  );
}

function TablaComprasFaltantes({ rows }: { rows: AuditCompraRow[] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Ninguna -- todo lo que trae el archivo ya está registrado.</p>;
  const visibles = rows.slice(0, LIMITE_FILAS);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b">
          <tr>
            <th className="text-left py-1.5 px-2">N° factura</th>
            <th className="text-left py-1.5 px-2">Proveedor</th>
            <th className="text-left py-1.5 px-2">Fecha</th>
            <th className="text-right py-1.5 px-2">Total Xetux</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((r) => (
            <tr key={r.idx} className="border-b last:border-0">
              <td className="py-1.5 px-2 mono">{r.numero_factura || "—"}</td>
              <td className="py-1.5 px-2">{r.proveedor}</td>
              <td className="py-1.5 px-2 mono">{r.fecha ? fmtDate(r.fecha) : "—"}</td>
              <td className="py-1.5 px-2 text-right mono">{fmtUsd(r.total_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > LIMITE_FILAS && (
        <p className="text-[11px] text-muted-foreground mt-1">Mostrando las primeras {LIMITE_FILAS} de {rows.length}.</p>
      )}
    </div>
  );
}

function TablaComprasDiscrepancias({ rows }: { rows: AuditResultado<AuditCompraRow>["discrepancias"] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Ninguna -- los montos coinciden con lo registrado.</p>;
  const visibles = rows.slice(0, LIMITE_FILAS);
  const hayAprox = rows.some((d) => d.aproximado);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b">
            <tr>
              <th className="text-left py-1.5 px-2">N° factura</th>
              <th className="text-left py-1.5 px-2">Proveedor</th>
              <th className="text-right py-1.5 px-2">Total Xetux</th>
              <th className="text-right py-1.5 px-2">Total sistema</th>
              <th className="text-right py-1.5 px-2">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((d) => (
              <tr key={d.xetux.idx} className="border-b last:border-0">
                <td className="py-1.5 px-2 mono">{d.xetux.numero_factura || "—"}</td>
                <td className="py-1.5 px-2">{d.xetux.proveedor}</td>
                <td className="py-1.5 px-2 text-right mono">{fmtUsd(d.xetux.total_usd)}</td>
                <td className="py-1.5 px-2 text-right mono">
                  {fmtUsd(d.totalSistema)}{d.aproximado && <span className="text-[10px] text-muted-foreground"> (aprox.)</span>}
                </td>
                <td className={`py-1.5 px-2 text-right mono font-medium ${d.diffUsd > 0 ? "text-amber-600" : "text-destructive"}`}>
                  {d.diffUsd > 0 ? "+" : ""}{fmtUsd(d.diffUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > LIMITE_FILAS && (
          <p className="text-[11px] text-muted-foreground mt-1">Mostrando las primeras {LIMITE_FILAS} de {rows.length}.</p>
        )}
      </div>
      {hayAprox && <NotaAproximado />}
    </div>
  );
}

function TablaAnuladas({ rows }: { rows: AuditResultado<any>["anuladas"] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Ninguna -- todo lo registrado aquí sigue apareciendo en el acumulado de Xetux.</p>;
  const visibles = rows.slice(0, LIMITE_FILAS);
  const hayAprox = rows.some((a) => a.aproximado);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Están registrados aquí con este número y caen DENTRO del rango de fechas que cubre el archivo que subiste,
        pero no aparecen en él -- revisa en{" "}
        <Link to="/transacciones" className="text-primary hover:underline">Transacciones</Link> (filtro "N° factura") si
        de verdad las anularon en Xetux antes de borrar nada. Si subiste un acumulado parcial (no todo el histórico),
        lo que quede fuera de ese rango de fechas no se compara aquí -- no puede aparecer como anulado solo porque el
        archivo no llegaba hasta esa fecha.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b">
            <tr>
              <th className="text-left py-1.5 px-2">N° factura / orden</th>
              <th className="text-left py-1.5 px-2">Fecha</th>
              <th className="text-right py-1.5 px-2">Total sistema</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((a) => (
              <tr key={a.key} className="border-b last:border-0">
                <td className="py-1.5 px-2 mono">{a.numero}</td>
                <td className="py-1.5 px-2 mono">{a.fecha ? fmtDate(a.fecha) : "—"}</td>
                <td className="py-1.5 px-2 text-right mono">
                  {fmtUsd(a.totalSistema)}{a.aproximado && <span className="text-[10px] text-muted-foreground"> (aprox.)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > LIMITE_FILAS && (
          <p className="text-[11px] text-muted-foreground mt-1">Mostrando las primeras {LIMITE_FILAS} de {rows.length}.</p>
        )}
      </div>
      {hayAprox && <NotaAproximado />}
    </div>
  );
}
