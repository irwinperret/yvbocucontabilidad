import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fmtUsd } from "@/lib/format";
import { CENTROS, MESES } from "@/lib/account-helpers";
import { useCuentasBancarias } from "@/components/bank-account-select";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, mensualView } from "@/lib/usd-view-context";
import { exportFCIndirecto } from "@/lib/excel-export";
import { calcularLineasFC, fetchInsumosFC, type LineasFCMes, CUENTA_CAPEX } from "@/lib/flujo-caja";
import { estimarCogsMesesAbiertos } from "@/lib/cierre-mes";

export const Route = createFileRoute("/_authenticated/fc")({ component: FCPage });

type Row = { anio: number; mes: number; cuenta_codigo: string; centro_costo: string; modo: string; base_usd: number; total_usd: number };
type LineasMes = LineasFCMes;

const CATEGORIA_INMUEBLES = "Remodelación/Obra Civil";

function FCPage() {
  const { mode, label } = useUsdView();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [centro, setCentro] = useState<string>("Consolidado");
  const [incluirOff, setIncluirOff] = useState(true);
  const [mesSel, setMesSel] = useState(new Date().getMonth() + 1);
  const [hastaMes, setHastaMes] = useState(new Date().getMonth() + 1);
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>("todas");

  const { data: bancos } = useCuentasBancarias();

  const modoFiltro = incluirOff ? undefined : "on_balance";

  const { data: rows } = useQuery({
    queryKey: ["fc-rows", anio, centro, modoFiltro, mode, cuentaBancariaId],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      if (cuentaBancariaId !== "todas") {
        const data = await fetchAllRows<any>(async (from, to) => {
          let q = supabase.from("transacciones").select("fecha, cuenta_codigo, centro_costo, modo, monto_bs, monto_usd, tasa_bcv")
            .neq("standby", true).gte("fecha", `${anio}-01-01`).lte("fecha", `${anio}-12-31`)
            .eq("cuenta_bancaria_id" as any, cuentaBancariaId).range(from, to);
          if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
          if (modoFiltro) q = q.eq("modo", modoFiltro as any);
          return await q;
        });
        const map = new Map<string, Row>();
        for (const t of data) {
          const d = new Date(t.fecha);
          const k = `${d.getFullYear()}-${d.getMonth() + 1}-${t.cuenta_codigo}-${t.centro_costo}-${t.modo}`;
          const bs = Number(t.monto_bs || 0);
          const tbcv = Number(t.tasa_bcv || 0);
          const usd = mode === "bcv" ? (tbcv > 0 ? bs / tbcv : 0) : Number(t.monto_usd || 0);
          const existing = map.get(k);
          if (existing) { existing.base_usd += usd; existing.total_usd += usd; }
          else map.set(k, { anio: d.getFullYear(), mes: d.getMonth() + 1, cuenta_codigo: t.cuenta_codigo, centro_costo: t.centro_costo, modo: t.modo, base_usd: usd, total_usd: usd });
        }
        return Array.from(map.values());
      }
      let q = (supabase as any).from(mensualView(mode)).select("*").eq("anio", anio);
      if (centro !== "Consolidado") q = q.eq("centro_costo", centro);
      if (modoFiltro) q = q.eq("modo", modoFiltro);
      return await fetchAllRows<Row>(async (from, to) => (q as any).range(from, to));
    },
  });

  // CapEx individual (para separar Inmuebles vs Equipos por categoría)
  const { data: capexRows } = useQuery({
    queryKey: ["fc-capex", anio, centro, modoFiltro, mode, cuentaBancariaId],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows<any>(async (from, to) => {
        let q = supabase.from("transacciones").select("fecha, monto_bs, monto_usd, tasa_bcv, capex_categoria, centro_costo, modo")
          .eq("cuenta_codigo", CUENTA_CAPEX).neq("standby", true)
          .gte("fecha", `${anio}-01-01`).lte("fecha", `${anio}-12-31`);
        if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
        if (modoFiltro) q = q.eq("modo", modoFiltro as any);
        if (cuentaBancariaId !== "todas") q = q.eq("cuenta_bancaria_id" as any, cuentaBancariaId);
        return await q.range(from, to);
      });
    },
  });

  // Inventario (inicial/final por mes) para "Cambios Inventario"
  const { data: inventario } = useQuery({
    queryKey: ["fc-inventario", anio],
    queryFn: async () => {
      const { data } = await supabase.from("inventario_snapshots").select("periodo, tipo, monto_usd")
        .gte("periodo", `${anio}-01`).lte("periodo", `${anio}-12`);
      return data ?? [];
    },
  });

  // Cuentas por pagar creadas en el año (para "Cambios en Cuentas por pagar")
  const { data: cxpCreadas } = useQuery({
    queryKey: ["fc-cxp-creadas", anio, centro],
    queryFn: async () => {
      let q = supabase.from("cuentas_por_pagar").select("created_at, monto_usd, centro_costo")
        .gte("created_at", `${anio}-01-01`).lt("created_at", `${anio + 1}-01-01`);
      if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
      const { data } = await q;
      return data ?? [];
    },
  });

  // COGS estimado para meses abiertos (sin cierre formal, pero con inventario
  // inicial/final ya cargado) — misma fórmula que un cierre real.
  const { data: cogsEstimadoPorMes } = useQuery({
    queryKey: ["fc-cogs-estimado", anio],
    queryFn: () => estimarCogsMesesAbiertos(anio),
  });

  const usdDe = (t: any) => {
    if (mode === "bcv") {
      const tbcv = Number(t.tasa_bcv || 0);
      return tbcv > 0 ? Number(t.monto_bs || 0) / tbcv : Number(t.monto_usd || 0);
    }
    return Number(t.monto_usd || 0);
  };

  const lineasPorMes: LineasMes[] = useMemo(() => {
    return calcularLineasFC({
      rows: rows ?? [],
      capexRows: capexRows ?? [],
      inventario: inventario ?? [],
      cxpCreadas: cxpCreadas ?? [],
      anio,
      usdDe,
      cogsEstimadoPorMes,
      moneda: mode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, capexRows, inventario, cxpCreadas, anio, mode, cogsEstimadoPorMes]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flujo de caja</h1>
          <p className="text-sm text-muted-foreground">Estado de flujo de efectivo (método indirecto) en {label}</p>
        </div>
        <UsdViewToggle />
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div><Label className="text-xs">Año</Label><Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[2024,2025,2026,2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Centro de costo</Label><Select value={centro} onValueChange={setCentro}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Consolidado">Consolidado</SelectItem>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-2"><Switch checked={incluirOff} onCheckedChange={setIncluirOff} id="off" /><Label htmlFor="off" className="text-xs">Incluir off-balance</Label></div>
          <div><Label className="text-xs">Cuenta bancaria</Label>
            <Select value={cuentaBancariaId} onValueChange={setCuentaBancariaId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las cuentas</SelectItem>
                {(bancos ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nombre} — {b.banco} ({b.moneda})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="mes">
        <TabsList>
          <TabsTrigger value="mes">Mes individual</TabsTrigger>
          <TabsTrigger value="ytd">Acumulado YTD</TabsTrigger>
          <TabsTrigger value="comp">Comparativo mensual</TabsTrigger>
        </TabsList>

        <TabsContent value="mes">
          <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-xs">Mes</Label>
              <Select value={String(mesSel)} onValueChange={(v) => setMesSel(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{MESES.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => exportFCIndirecto({ tab: "mes", anio, mes: mesSel, lineasPorMes })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteFCIndirecto lineas={lineasPorMes[mesSel - 1]} />
        </TabsContent>

        <TabsContent value="ytd">
          <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <Label className="text-xs">Hasta el mes</Label>
              <Select value={String(hastaMes)} onValueChange={(v) => setHastaMes(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{MESES.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => exportFCIndirecto({ tab: "ytd", anio, hastaMes, lineasPorMes })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteFCIndirecto lineas={sumarLineas(lineasPorMes.slice(0, hastaMes))} />
        </TabsContent>

        <TabsContent value="comp">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => exportFCIndirecto({ tab: "comp", anio, lineasPorMes })}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
          <ReporteFCComparativo lineasPorMes={lineasPorMes} anio={anio} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function sumarLineas(lista: LineasMes[]): LineasMes {
  return lista.reduce(
    (acc, l) => ({
      ebitda: acc.ebitda + l.ebitda,
      cambioCxC: acc.cambioCxC + l.cambioCxC,
      cambioInventario: acc.cambioInventario + l.cambioInventario,
      cambioCxP: acc.cambioCxP + l.cambioCxP,
      compraInmuebles: acc.compraInmuebles + l.compraInmuebles,
      compraEquipos: acc.compraEquipos + l.compraEquipos,
      aumentoCapital: acc.aumentoCapital + l.aumentoCapital,
      aumentoPrestamos: acc.aumentoPrestamos + l.aumentoPrestamos,
      gastoIntereses: acc.gastoIntereses + l.gastoIntereses,
      gastoImpuestos: acc.gastoImpuestos + l.gastoImpuestos,
      gastoDividendos: acc.gastoDividendos + l.gastoDividendos,
      cogsEsEstimado: acc.cogsEsEstimado || !!l.cogsEsEstimado,
    }),
    { ebitda: 0, cambioCxC: 0, cambioInventario: 0, cambioCxP: 0, compraInmuebles: 0, compraEquipos: 0, aumentoCapital: 0, aumentoPrestamos: 0, gastoIntereses: 0, gastoImpuestos: 0, gastoDividendos: 0, cogsEsEstimado: false },
  );
}

function ReporteFCIndirecto({ lineas: l }: { lineas: LineasMes }) {
  const flujoOp = l.ebitda + l.cambioCxC + l.cambioInventario + l.cambioCxP;
  const flujoInv = -l.compraInmuebles - l.compraEquipos;
  const flujoFin = l.aumentoCapital + l.aumentoPrestamos - l.gastoIntereses - l.gastoImpuestos - l.gastoDividendos;
  const neto = flujoOp + flujoInv + flujoFin;

  return (
    <Card>
      <CardContent className="pt-4 space-y-1">
        {l.cogsEsEstimado && (
          <div className="text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded px-2 py-1.5 mb-2">
            ⚠ El EBITDA incluye un COGS <b>estimado</b> — al menos un mes de este período sigue abierto (sin cierre formal). Se calculó con el inventario y las compras ya cargados para ese mes, pero puede cambiar cuando cierres el mes de verdad.
          </div>
        )}
        <Seccion titulo="Flujo de Caja de Actividades Operativas">
          <Linea label="EBITDA" v={l.ebitda} />
          <Linea label="Cambios en Cuentas por cobrar" v={l.cambioCxC} />
          <Linea label="Cambios Inventario (Almacenado)" v={l.cambioInventario} />
          <Linea label="Cambios en Cuentas por pagar" v={l.cambioCxP} />
        </Seccion>
        <Total label="Total Flujo de Caja de Actividades Operativas" v={flujoOp} />

        <Seccion titulo="Actividades de Inversión">
          <Linea label="Compra de Inmuebles" v={-l.compraInmuebles} />
          <Linea label="Compra de Equipos" v={-l.compraEquipos} />
        </Seccion>
        <Total label="Total Flujo de Caja de Actividades de Inversión" v={flujoInv} />

        <Seccion titulo="Actividades Financieras">
          <Linea label="Aumento en el Capital Social" v={l.aumentoCapital} />
          <Linea label="Aumento en Préstamos por Pagar" v={l.aumentoPrestamos} />
          <Linea label="Gasto en Intereses" v={-l.gastoIntereses} />
          <Linea label="Gasto en Impuestos" v={-l.gastoImpuestos} />
          <Linea label="Gasto en Dividendos" v={-l.gastoDividendos} />
        </Seccion>
        <Total label="Total Flujo de Caja de Actividades Financieras" v={flujoFin} />

        <Total label="VARIACIÓN NETA DE CAJA" v={neto} big />
      </CardContent>
    </Card>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="py-1.5 px-2 text-sm font-semibold bg-muted/30 border-b">{titulo}</div>
      {children}
    </div>
  );
}

function Linea({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between py-1.5 px-2 pl-4 text-sm border-b last:border-0">
      <span>{label}</span>
      <span className={`mono ${v >= 0 ? "positive" : "negative"}`}>{v >= 0 ? fmtUsd(v) : `(${fmtUsd(Math.abs(v)).replace("$ ", "")})`}</span>
    </div>
  );
}

function Total({ label, v, big }: { label: string; v: number; big?: boolean }) {
  return (
    <div className={`flex justify-between py-2 px-2 border-t-2 ${big ? "text-base font-bold bg-muted/30" : "text-sm font-semibold"}`}>
      <span>{label}</span>
      <span className={`mono ${v >= 0 ? "positive" : "negative"}`}>{v >= 0 ? fmtUsd(v) : `(${fmtUsd(Math.abs(v)).replace("$ ", "")})`}</span>
    </div>
  );
}

// ---------- Comparativo mensual, con selección de celdas tipo Excel ----------

const FILAS_COMPARATIVO: { label: string; get: (l: LineasMes) => number; bold?: boolean }[] = [
  { label: "EBITDA", get: (l) => l.ebitda },
  { label: "Cambios en Cuentas por cobrar", get: (l) => l.cambioCxC },
  { label: "Cambios Inventario (Almacenado)", get: (l) => l.cambioInventario },
  { label: "Cambios en Cuentas por pagar", get: (l) => l.cambioCxP },
  { label: "Total Flujo de Caja de Actividades Operativas", get: (l) => l.ebitda + l.cambioCxC + l.cambioInventario + l.cambioCxP, bold: true },
  { label: "Compra de Inmuebles", get: (l) => -l.compraInmuebles },
  { label: "Compra de Equipos", get: (l) => -l.compraEquipos },
  { label: "Total Flujo de Caja de Actividades de Inversión", get: (l) => -l.compraInmuebles - l.compraEquipos, bold: true },
  { label: "Aumento en el Capital Social", get: (l) => l.aumentoCapital },
  { label: "Aumento en Préstamos por Pagar", get: (l) => l.aumentoPrestamos },
  { label: "Gasto en Intereses", get: (l) => -l.gastoIntereses },
  { label: "Gasto en Impuestos", get: (l) => -l.gastoImpuestos },
  { label: "Gasto en Dividendos", get: (l) => -l.gastoDividendos },
  { label: "Total Flujo de Caja de Actividades Financieras", get: (l) => l.aumentoCapital + l.aumentoPrestamos - l.gastoIntereses - l.gastoImpuestos - l.gastoDividendos, bold: true },
  { label: "VARIACIÓN NETA DE CAJA", get: (l) => l.ebitda + l.cambioCxC + l.cambioInventario + l.cambioCxP - l.compraInmuebles - l.compraEquipos + l.aumentoCapital + l.aumentoPrestamos - l.gastoIntereses - l.gastoImpuestos - l.gastoDividendos, bold: true },
];

function ReporteFCComparativo({ lineasPorMes, anio }: { lineasPorMes: LineasMes[]; anio: number }) {
  // Selección de celdas tipo Excel (clic y arrastra), igual que en G&P.
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ r: number; c: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ r: number; c: number } | null>(null);

  const enRango = (r: number, c: number) => {
    if (!selStart || !selEnd) return false;
    const r0 = Math.min(selStart.r, selEnd.r), r1 = Math.max(selStart.r, selEnd.r);
    const c0 = Math.min(selStart.c, selEnd.c), c1 = Math.max(selStart.c, selEnd.c);
    return r >= r0 && r <= r1 && c >= c0 && c <= c1;
  };
  const startSel = (r: number, c: number) => (e: React.MouseEvent) => { e.preventDefault(); setSelecting(true); setSelStart({ r, c }); setSelEnd({ r, c }); };
  const overSel = (r: number, c: number) => () => { if (selecting) setSelEnd({ r, c }); };

  useEffect(() => {
    const stop = () => setSelecting(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const seleccion = useMemo(() => {
    if (!selStart || !selEnd) return { suma: 0, count: 0 };
    let suma = 0, count = 0;
    FILAS_COMPARATIVO.forEach((fila, r) => {
      const valores = lineasPorMes.map(fila.get);
      const total = valores.reduce((s, v) => s + v, 0);
      [...valores, total].forEach((v, c) => { if (enRango(r, c)) { suma += v; count++; } });
    });
    return { suma, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStart, selEnd, lineasPorMes]);

  return (
    <>
      <Card>
        <CardContent className="pt-4 overflow-x-auto select-none">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="border-b">
              <tr>
                <th className="text-left py-2 px-2 sticky left-0 bg-background z-10 min-w-[280px] border-b">Concepto</th>
                {MESES.map((m, i) => <th key={i} className="text-right py-2 px-2 border-b">{m}</th>)}
                <th className="text-right py-2 px-2 font-semibold border-b">Año {anio}</th>
              </tr>
            </thead>
            <tbody>
              {FILAS_COMPARATIVO.map((fila, r) => {
                const valores = lineasPorMes.map(fila.get);
                const total = valores.reduce((s, v) => s + v, 0);
                return (
                  <tr key={fila.label} className={fila.bold ? "bg-muted/30" : "hover:bg-muted/10"}>
                    <td className={`py-1.5 px-2 sticky left-0 z-10 border-b ${fila.bold ? "bg-muted/30 font-semibold" : "bg-background"}`}>{fila.label}</td>
                    {valores.map((v, c) => (
                      <td
                        key={c}
                        onMouseDown={startSel(r, c)}
                        onMouseEnter={overSel(r, c)}
                        className={`py-1.5 px-2 text-right mono border-b cursor-cell ${fila.bold ? "font-semibold" : ""} ${v === 0 ? "text-muted-foreground/60" : ""} ${enRango(r, c) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                      >
                        {v === 0 ? "—" : fmtUsd(v)}
                        {fila.label === "EBITDA" && lineasPorMes[c]?.cogsEsEstimado && <span className="text-amber-600">*</span>}
                      </td>
                    ))}
                    <td
                      onMouseDown={startSel(r, 12)}
                      onMouseEnter={overSel(r, 12)}
                      className={`py-1.5 px-2 text-right mono font-semibold border-b cursor-cell ${enRango(r, 12) ? "bg-primary/15 outline outline-1 outline-primary/40" : ""}`}
                    >
                      {fmtUsd(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lineasPorMes.some((l) => l.cogsEsEstimado) && (
            <p className="text-xs text-amber-700 mt-2">
              * EBITDA con COGS estimado — ese mes sigue abierto (sin cierre formal), calculado con el inventario y las compras ya cargados para ese mes.
            </p>
          )}
        </CardContent>
      </Card>
      {seleccion.count > 0 && (
        <div className="sticky bottom-0 z-20 flex justify-end">
          <div className="bg-foreground text-background text-xs rounded-md shadow-lg px-4 py-2 mt-2 flex items-center gap-4 mono">
            <span>Celdas: <b>{seleccion.count}</b></span>
            <span>Promedio: <b>{fmtUsd(seleccion.suma / seleccion.count)}</b></span>
            <span>Suma: <b>{fmtUsd(seleccion.suma)}</b></span>
          </div>
        </div>
      )}
    </>
  );
}
