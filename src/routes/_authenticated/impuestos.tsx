import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { MESES } from "@/lib/account-helpers";
import {
  Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ComposedChart, Line,
} from "recharts";
import { fetchAllRows } from "@/lib/fetch-all";
import { UsdRateBadge } from "@/components/usd-rate-badge";

export const Route = createFileRoute("/_authenticated/impuestos")({ component: ImpuestosPage });

type Row = {
  id: string;
  fecha: string;
  cuenta_codigo: string;
  centro_costo: string | null;
  monto_bs: number | null;
  monto_base_bs?: number | null;
  iva_bs?: number | null;
  iva_aplica?: boolean | null;
  tipo_iva?: string | null;
  monto_usd: number | null;
  tasa_bcv: number | null;
  tasa_paralela: number | null;
  numero_factura: string | null;
  referencia: string | null;
  notas: string | null;
  grupo_transaccion_id: string | null;
};

function ImpuestosPage() {
  const now = new Date();
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState<number | "all">(now.getMonth() + 1);
  const [centroFiltro, setCentroFiltro] = useState<string>("Consolidado");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["impuestos-iva", anio],
    queryFn: async () => {
      const ini = `${anio}-01-01`;
      const fin = `${anio}-12-31`;
      return await fetchAllRows<Row>(async (from, to) => {
        return await supabase
          .from("transacciones")
          .select("id,fecha,cuenta_codigo,centro_costo,monto_bs,monto_base_bs,iva_bs,iva_aplica,tipo_iva,monto_usd,tasa_bcv,tasa_paralela,numero_factura,referencia,notas,grupo_transaccion_id")
          .or("cuenta_codigo.in.(12.4,12.5),iva_bs.gt.0")
          .gte("fecha", ini)
          .lte("fecha", fin)
          .order("fecha", { ascending: false })
          .range(from, to);
      });
    },
  });

  const filtered = useMemo(() => {
    return (rows ?? []).filter((r) => {
      const m = Number(r.fecha.slice(5, 7));
      if (mes !== "all" && m !== mes) return false;
      if (centroFiltro !== "Consolidado" && (r.centro_costo ?? "") !== centroFiltro) return false;
      return true;
    });
  }, [rows, mes, centroFiltro]);

  const totales = useMemo(() => {
    let debUsd = 0, debBs = 0, credUsd = 0, credBs = 0;
    filtered.forEach((r) => {
      const isInlineCredit = r.cuenta_codigo !== "12.4" && r.cuenta_codigo !== "12.5" && Number(r.iva_bs ?? 0) > 0;
      const bs = isInlineCredit ? Number(r.iva_bs ?? 0) : Number(r.monto_bs ?? 0);
      const usd = isInlineCredit
        ? (Number(r.tasa_paralela ?? 0) > 0 ? bs / Number(r.tasa_paralela) : (Number(r.tasa_bcv ?? 0) > 0 ? bs / Number(r.tasa_bcv) : 0))
        : Number(r.monto_usd ?? 0);
      if (r.cuenta_codigo === "12.4") { debUsd += usd; debBs += bs; }
      else if (r.cuenta_codigo === "12.5" || isInlineCredit) { credUsd += usd; credBs += bs; }
    });
    return {
      debUsd, debBs, credUsd, credBs,
      netoUsd: debUsd - credUsd,
      netoBs: debBs - credBs,
    };
  }, [filtered]);

  const chartData = useMemo(() => {
    const out: Record<number, { mes: number; mesLabel: string; debito: number; credito: number; neto: number }> = {};
    for (let m = 1; m <= 12; m++) {
      out[m] = { mes: m, mesLabel: MESES[m - 1], debito: 0, credito: 0, neto: 0 };
    }
    (rows ?? []).forEach((r) => {
      if (centroFiltro !== "Consolidado" && (r.centro_costo ?? "") !== centroFiltro) return;
      const m = Number(r.fecha.slice(5, 7));
      const isInlineCredit = r.cuenta_codigo !== "12.4" && r.cuenta_codigo !== "12.5" && Number(r.iva_bs ?? 0) > 0;
      const bs = isInlineCredit ? Number(r.iva_bs ?? 0) : Number(r.monto_bs ?? 0);
      const usd = isInlineCredit
        ? (Number(r.tasa_paralela ?? 0) > 0 ? bs / Number(r.tasa_paralela) : (Number(r.tasa_bcv ?? 0) > 0 ? bs / Number(r.tasa_bcv) : 0))
        : Number(r.monto_usd ?? 0);
      if (r.cuenta_codigo === "12.4") out[m].debito += usd;
      else if (r.cuenta_codigo === "12.5" || isInlineCredit) out[m].credito += usd;
    });
    Object.values(out).forEach((r) => { r.neto = r.debito - r.credito; });
    return Object.values(out);
  }, [rows, centroFiltro]);

  const exportCsv = () => {
    const headers = ["Fecha", "Tipo", "Centro", "N° Factura", "Referencia", "Monto Bs", "Monto USD", "Tasa BCV", "Notas"];
    const lines = [headers.join(",")];
    filtered.forEach((r) => {
        const isInlineCredit = r.cuenta_codigo !== "12.4" && r.cuenta_codigo !== "12.5" && Number(r.iva_bs ?? 0) > 0;
        const bs = isInlineCredit ? Number(r.iva_bs ?? 0) : Number(r.monto_bs ?? 0);
        const usd = isInlineCredit
          ? (Number(r.tasa_paralela ?? 0) > 0 ? bs / Number(r.tasa_paralela) : (Number(r.tasa_bcv ?? 0) > 0 ? bs / Number(r.tasa_bcv) : 0))
          : Number(r.monto_usd ?? 0);
        const tipo = r.cuenta_codigo === "12.4" ? "IVA Débito (Venta)" : "IVA Crédito (Compra)";
      const row = [
        r.fecha,
        tipo,
        r.centro_costo ?? "",
        r.numero_factura ?? "",
        r.referencia ?? "",
        bs.toFixed(2),
        usd.toFixed(2),
        Number(r.tasa_bcv ?? 0).toFixed(4),
        `"${(r.notas ?? "").replace(/"/g, '""')}"`,
      ];
      lines.push(row.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `impuestos-iva-${anio}${mes !== "all" ? `-${String(mes).padStart(2, "0")}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Impuestos · IVA</h1>
          <div className="mt-1"><UsdRateBadge /></div>
        <p className="text-sm text-muted-foreground">
          Movimientos de IVA débito (ventas, cuenta 12.4) y crédito (compras, cuenta 12.5) · neto a declarar
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm leading-relaxed">
          El <strong>IVA débito</strong> (12.4) es el IVA cobrado en ventas y representa una deuda con el fisco.
          El <strong>IVA crédito</strong> (12.5) es el IVA pagado en compras y se descuenta del débito.
          El <strong>neto</strong> es lo que se debe pagar (positivo) o el crédito a favor (negativo) en la declaración mensual.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div>
            <Label className="text-xs">Año</Label>
            <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mes</Label>
            <Select value={String(mes)} onValueChange={(v) => setMes(v === "all" ? "all" : Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el año</SelectItem>
                {MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Centro de costo</Label>
            <Select value={centroFiltro} onValueChange={setCentroFiltro}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Consolidado">Consolidado</SelectItem>
                <SelectItem value="YV">YV</SelectItem>
                <SelectItem value="Bocu">Bocú</SelectItem>
                <SelectItem value="Compartido">Compartido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Exportar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">IVA Débito (Ventas · 12.4)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{fmtUsd(totales.debUsd)}</div>
            <div className="text-xs text-muted-foreground mt-1 mono">{fmtBs(totales.debBs)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">IVA Crédito (Compras · 12.5)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{fmtUsd(totales.credUsd)}</div>
            <div className="text-xs text-muted-foreground mt-1 mono">{fmtBs(totales.credBs)}</div>
          </CardContent>
        </Card>
        <Card className={totales.netoUsd > 0 ? "border-orange-400 bg-orange-50/60 dark:bg-orange-950/20" : "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/20"}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-xs uppercase ${totales.netoUsd > 0 ? "text-orange-700 dark:text-orange-300" : "text-emerald-700 dark:text-emerald-300"}`}>
              {totales.netoUsd >= 0 ? "Neto a pagar" : "Crédito a favor"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totales.netoUsd > 0 ? "text-orange-700 dark:text-orange-300" : "text-emerald-700 dark:text-emerald-300"}`}>
              {fmtUsd(Math.abs(totales.netoUsd))}
            </div>
            <div className="text-xs text-muted-foreground mt-1 mono">{fmtBs(Math.abs(totales.netoBs))}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">IVA mensual · {anio}</CardTitle></CardHeader>
        <CardContent style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mesLabel" />
              <YAxis tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} />
              <Legend />
              <Bar dataKey="debito" fill="#3b82f6" name="IVA Débito" />
              <Bar dataKey="credito" fill="#10b981" name="IVA Crédito" />
              <Line type="monotone" dataKey="neto" stroke="#E11D48" strokeWidth={2} name="Neto" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Detalle ({filtered.length} {filtered.length === 1 ? "movimiento" : "movimientos"})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">Fecha</th>
                  <th className="text-left py-2 px-2">Tipo</th>
                  <th className="text-left py-2 px-2">Centro</th>
                  <th className="text-left py-2 px-2">N° Factura</th>
                  <th className="text-left py-2 px-2">Ref</th>
                  <th className="text-right py-2 px-2">Monto Bs</th>
                  <th className="text-right py-2 px-2">Monto USD</th>
                  <th className="text-left py-2 px-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isDeb = r.cuenta_codigo === "12.4";
                  const isInlineCredit = r.cuenta_codigo !== "12.4" && r.cuenta_codigo !== "12.5" && Number(r.iva_bs ?? 0) > 0;
                  const bs = isInlineCredit ? Number(r.iva_bs ?? 0) : Number(r.monto_bs ?? 0);
                  const usd = isInlineCredit
                    ? (Number(r.tasa_paralela ?? 0) > 0 ? bs / Number(r.tasa_paralela) : (Number(r.tasa_bcv ?? 0) > 0 ? bs / Number(r.tasa_bcv) : 0))
                    : Number(r.monto_usd ?? 0);
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1.5 px-2 mono">{fmtDate(r.fecha)}</td>
                      <td className="py-1.5 px-2">
                        <Badge className={isDeb
                          ? "bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-300"
                          : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-300"}>
                          {isDeb ? "Débito (venta)" : "Crédito (compra)"}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2">{r.centro_costo ?? "—"}</td>
                      <td className="py-1.5 px-2 mono text-xs">{r.numero_factura ?? "—"}</td>
                      <td className="py-1.5 px-2 text-xs text-muted-foreground">{r.referencia ?? "—"}</td>
                      <td className="py-1.5 px-2 mono text-right">{fmtBs(bs)}</td>
                      <td className="py-1.5 px-2 mono text-right font-semibold">{fmtUsd(usd)}</td>
                      <td className="py-1.5 px-2 text-muted-foreground text-xs">{r.notas ?? "—"}</td>
                    </tr>
                  );
                })}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Sin movimientos de IVA en este período</td></tr>
                )}
                {isLoading && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Cargando…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
