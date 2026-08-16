import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { MESES } from "@/lib/account-helpers";
import { useCuentasBancarias } from "@/components/bank-account-select";
import { CUENTA_CAMBIO, TIPO_CAMBIO_LABEL, tasaImplicita, tipoDesdeDetalle } from "@/lib/operaciones-cambio";

export const Route = createFileRoute("/_authenticated/operaciones-cambio")({
  component: OperacionesCambioPage,
  head: () => ({
    meta: [
      { title: "Operaciones de Cambio | Contabilidad YV & Bocu" },
      { name: "description", content: "Compras y ventas de divisas registradas en la cuenta 98, con tasa implícita y diferencia contra el paralelo." },
      { property: "og:title", content: "Operaciones de Cambio" },
      { property: "og:description", content: "Compras y ventas de divisas con tasa implícita y comparación contra la tasa paralela del día." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Tx = {
  id: string;
  fecha: string;
  monto_bs: number;
  monto_usd: number;
  tasa_paralela: number | null;
  detalle: string | null;
  notas: string | null;
  cuenta_bancaria_id: string | null;
  grupo_transaccion_id: string | null;
};

function OperacionesCambioPage() {
  const now = new Date();
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState<string>("todos");
  const [banco, setBanco] = useState<string>("todos");

  const { data: bancos } = useCuentasBancarias();
  const bancoNombre = (id: string | null) => (bancos ?? []).find((b) => b.id === id)?.nombre ?? "—";

  const { data: txs } = useQuery({
    queryKey: ["ops-cambio", anio],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, monto_bs, monto_usd, tasa_paralela, detalle, notas, cuenta_bancaria_id, grupo_transaccion_id")
        .eq("cuenta_codigo", CUENTA_CAMBIO)
        .neq("standby", true)
        .gte("fecha", `${anio}-01-01`)
        .lte("fecha", `${anio}-12-31`)
        .order("fecha", { ascending: false });
      return (data ?? []) as Tx[];
    },
  });

  const grupos = useMemo(() => {
    const map = new Map<string, Tx[]>();
    for (const t of txs ?? []) {
      const k = t.grupo_transaccion_id ?? t.id;
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return Array.from(map.entries())
      .map(([id, legs]) => {
        const salida = legs.find((l) => Number(l.monto_bs) < 0 || Number(l.monto_usd) < 0) ?? legs[0];
        const entrada = legs.find((l) => l !== salida) ?? null;
        const tipo = tipoDesdeDetalle(salida.detalle ?? entrada?.detalle);
        const bs = Math.abs(Number(salida.monto_bs) || Number(entrada?.monto_bs) || 0);
        const usd = Math.abs(Number(salida.monto_usd) || Number(entrada?.monto_usd) || 0);
        const implicita = tasaImplicita(bs, usd);
        const paralela = Number(salida.tasa_paralela) || 0;
        return {
          id,
          fecha: salida.fecha,
          tipo,
          bs,
          usd,
          implicita,
          paralela,
          diferencia: implicita && paralela ? +(implicita - paralela).toFixed(4) : 0,
          bancoOrigen: salida.cuenta_bancaria_id,
          bancoDestino: entrada?.cuenta_bancaria_id ?? null,
          notas: salida.notas ?? "",
        };
      })
      .filter((g) => (mes === "todos" ? true : new Date(g.fecha + "T00:00:00").getMonth() + 1 === Number(mes)))
      .filter((g) => (banco === "todos" ? true : g.bancoOrigen === banco || g.bancoDestino === banco))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [txs, mes, banco]);

  const resumen = useMemo(() => {
    const compras = grupos.filter((g) => g.tipo === "compra");
    const ventas = grupos.filter((g) => g.tipo === "venta");
    const sum = (arr: typeof grupos, k: "bs" | "usd") => arr.reduce((s, g) => s + g[k], 0);
    const compradoUsd = sum(compras, "usd");
    const vendidoUsd = sum(ventas, "usd");
    return {
      compradoUsd,
      vendidoUsd,
      neto: compradoUsd - vendidoUsd,
      tasaCompra: compradoUsd > 0 ? sum(compras, "bs") / compradoUsd : 0,
      tasaVenta: vendidoUsd > 0 ? sum(ventas, "bs") / vendidoUsd : 0,
    };
  }, [grupos]);

  const num = (n: number) => (n ? n.toLocaleString("es-VE", { maximumFractionDigits: 2 }) : "—");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operaciones de Cambio</h1>
        <p className="text-sm text-muted-foreground">
          Cuenta 98 — compras y ventas de divisas. No afectan G&amp;P ni Flujo de caja.
        </p>
      </div>

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
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo el año</SelectItem>
                {MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Banco</Label>
            <Select value={banco} onValueChange={setBanco}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los bancos</SelectItem>
                {(bancos ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.nombre} — {b.banco}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { t: "USD comprado", v: fmtUsd(resumen.compradoUsd) },
          { t: "USD vendido", v: fmtUsd(resumen.vendidoUsd) },
          { t: "Posición neta USD", v: fmtUsd(resumen.neto) },
          { t: "Tasa promedio compra", v: num(resumen.tasaCompra) },
          { t: "Tasa promedio venta", v: num(resumen.tasaVenta) },
        ].map((c) => (
          <Card key={c.t}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{c.t}</div>
              <div className="text-lg font-semibold mono">{c.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Operaciones ({grupos.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2 text-right">Entregado</th>
                  <th className="p-2 text-right">Recibido</th>
                  <th className="p-2 text-right">Tasa implícita</th>
                  <th className="p-2 text-right">Tasa paralela día</th>
                  <th className="p-2 text-right">Diferencia</th>
                  <th className="p-2">Banco</th>
                  <th className="p-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => {
                  const favorable = g.tipo === "compra" ? g.diferencia <= 0 : g.diferencia >= 0;
                  return (
                    <tr key={g.id} className="border-b hover:bg-muted/30">
                      <td className="p-2">{fmtDate(g.fecha)}</td>
                      <td className="p-2"><Badge variant="outline">{TIPO_CAMBIO_LABEL[g.tipo]}</Badge></td>
                      <td className="p-2 text-right mono">{g.tipo === "compra" ? fmtBs(g.bs) : fmtUsd(g.usd)}</td>
                      <td className="p-2 text-right mono">{g.tipo === "compra" ? fmtUsd(g.usd) : fmtBs(g.bs)}</td>
                      <td className="p-2 text-right mono">{num(g.implicita)}</td>
                      <td className="p-2 text-right mono">{num(g.paralela)}</td>
                      <td className={`p-2 text-right mono ${!g.diferencia ? "" : favorable ? "positive" : "negative"}`}>
                        {num(g.diferencia)}
                      </td>
                      <td className="p-2">
                        {bancoNombre(g.bancoOrigen)}
                        {g.bancoDestino ? ` → ${bancoNombre(g.bancoDestino)}` : " → Efectivo"}
                      </td>
                      <td className="p-2 max-w-[280px] truncate" title={g.notas}>{g.notas}</td>
                    </tr>
                  );
                })}
                {grupos.length === 0 && (
                  <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No hay operaciones de cambio en el período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
