import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtUsd, fmtBs, fmtDate } from "@/lib/format";
import { MESES, CENTROS } from "@/lib/account-helpers";
import { logAudit } from "@/lib/audit";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView, usdVisual } from "@/lib/usd-view-context";
import { EditDialog } from "@/components/transaccion-edit-dialog";
import { EliminarTransaccionDialog } from "@/components/eliminar-transaccion-dialog";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/ajustes-off-balance")({ component: AjustesOffBalancePage });

// Los "ajustes off-balance" salen de DOS flujos distintos en la app, y ambos
// se traen aquí:
//  1) "Importar ajustes ventas" (referencia = "ajuste" en la transacción) --
//     en la práctica es el que genera prácticamente todo el volumen real: un
//     renglón de Excel por fecha se reparte en 2-3 movimientos (venta 20% YV
//     / 80% Bocú a cuentas 1.1 / 1.2, más el servicio de lista a la cuenta
//     3.1) que comparten un mismo grupo_transaccion_id.
//  2) El formulario "Ajuste off-balance" de Registrar (venta ligada a una
//     factura + su bono 10%) -- se identifica por el texto fijo que ese
//     formulario deja en notas, porque no usa el campo referencia.
// En ambos casos, "venta" = cuenta 1.x (ingreso) y "bono" = todo lo que no
// es 1.x (8.3 bono 10%, o 3.1 servicio/sueldos del import). Se muestran como
// movimientos sueltos (no forzamos un par 1-a-1) porque el import reparte
// una misma fecha en varias filas con centros distintos.
const REF_IMPORT = "ajuste";
const NOTAS_VENTA_MANUAL = "Ajuste off-balance";
const NOTAS_BONO_MANUAL = "(off-balance) por factura";

type Estado = "todos" | "pendiente" | "migrado";
type Tipo = "venta" | "bono";

type Fila = {
  tx: any;
  grupoKey: string;
  fecha: string;
  anioF: number;
  mesF: number;
  centro: string;
  tipo: Tipo;
  etiqueta: string; // texto para el badge de "Tipo" en el detalle
  factura: string;
  esFiar: boolean;
  estado: "pendiente" | "migrado";
};

function etiquetaDeFila(t: any, tipo: Tipo): string {
  const notas = String(t.notas ?? "");
  if (notas.startsWith(NOTAS_VENTA_MANUAL)) return "Ajuste";
  if (notas.includes(NOTAS_BONO_MANUAL)) return "Bono 10%";
  if (tipo === "venta") return "Ajuste ventas";
  return "Ajuste servicio";
}

function resumenPorCentro(filas: (Fila & { usd: number })[]) {
  const base = CENTROS.map((c) => {
    const fs = filas.filter((f) => f.centro === c);
    return {
      centro: c as string,
      ajuste: fs.filter((f) => f.tipo === "venta").reduce((s, f) => s + f.usd, 0),
      bono: fs.filter((f) => f.tipo === "bono").reduce((s, f) => s + f.usd, 0),
      cantidad: fs.length,
    };
  });
  const total = {
    centro: "Total",
    ajuste: base.reduce((s, f) => s + f.ajuste, 0),
    bono: base.reduce((s, f) => s + f.bono, 0),
    cantidad: base.reduce((s, f) => s + f.cantidad, 0),
  };
  return [...base, total];
}

function TablaResumenCentro({ filas }: { filas: ReturnType<typeof resumenPorCentro> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            <th className="text-left py-2 px-2">Centro</th>
            <th className="text-right py-2 px-2">Ajuste</th>
            <th className="text-right py-2 px-2">Bono / servicio</th>
            <th className="text-right py-2 px-2">Total</th>
            <th className="text-right py-2 px-2">Cant.</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.centro} className={`border-b last:border-0 ${f.centro === "Total" ? "font-bold" : ""}`}>
              <td className="py-2 px-2">{f.centro}</td>
              <td className="py-2 px-2 text-right mono">{fmtUsd(f.ajuste)}</td>
              <td className="py-2 px-2 text-right mono">{fmtUsd(f.bono)}</td>
              <td className="py-2 px-2 text-right mono">{fmtUsd(f.ajuste + f.bono)}</td>
              <td className="py-2 px-2 text-right mono">{f.cantidad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AjustesOffBalancePage() {
  const { mode, label } = useUsdView();
  const qc = useQueryClient();
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [centro, setCentro] = useState<string>("Todos");
  const [estadoFiltro, setEstadoFiltro] = useState<Estado>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [mesSel, setMesSel] = useState(new Date().getMonth() + 1);
  const [hastaMes, setHastaMes] = useState(new Date().getMonth() + 1);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["ajustes-off-import"] });
    qc.invalidateQueries({ queryKey: ["ajustes-off-venta-manual"] });
    qc.invalidateQueries({ queryKey: ["ajustes-off-bono-manual"] });
  };

  const { data: importTxs } = useQuery({
    queryKey: ["ajustes-off-import"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones").select("*").neq("standby", true)
          .eq("referencia", REF_IMPORT)
          .order("fecha", { ascending: false })
          .range(from, to),
      );
    },
  });

  const { data: ventaManualTxs } = useQuery({
    queryKey: ["ajustes-off-venta-manual"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones").select("*").neq("standby", true)
          .ilike("notas", `${NOTAS_VENTA_MANUAL}%`)
          .order("fecha", { ascending: false })
          .range(from, to),
      );
    },
  });

  const { data: bonoManualTxs } = useQuery({
    queryKey: ["ajustes-off-bono-manual"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones").select("*").neq("standby", true)
          .eq("cuenta_codigo", "8.1")
          .ilike("notas", `%${NOTAS_BONO_MANUAL}%`)
          .order("fecha", { ascending: false })
          .range(from, to),
      );
    },
  });

  // Cada transacción se muestra como su propia fila (no forzamos pares
  // venta+bono 1-a-1) porque el import masivo reparte una misma fecha en
  // varias filas con centros distintos (YV / Bocú / Compartido).
  const filasBase = useMemo<Fila[]>(() => {
    const armar = (t: any): Fila => {
      const cc = String(t.cuenta_codigo ?? "");
      const tipo: Tipo = cc.startsWith("1.") ? "venta" : "bono";
      const fechaD = new Date(t.fecha);
      return {
        tx: t,
        grupoKey: t.grupo_transaccion_id || t.id,
        fecha: t.fecha,
        anioF: fechaD.getUTCFullYear(),
        mesF: fechaD.getUTCMonth(),
        centro: t.centro_costo,
        tipo,
        etiqueta: etiquetaDeFila(t, tipo),
        factura: t.numero_factura || t.numero_orden || "",
        esFiar: (t.notas ?? "").includes("A CRÉDITO"),
        estado: t.modo === "on_balance" ? "migrado" : "pendiente",
      };
    };
    const vistos = new Set<string>();
    const todas = [...(importTxs ?? []), ...(ventaManualTxs ?? []), ...(bonoManualTxs ?? [])];
    const sinDuplicados = todas.filter((t: any) => (vistos.has(t.id) ? false : (vistos.add(t.id), true)));
    return sinDuplicados.map(armar);
  }, [importTxs, ventaManualTxs, bonoManualTxs]);

  const filasConMonto = useMemo(
    () => filasBase.map((f) => ({ ...f, usd: usdVisual(f.tx, mode) ?? 0 })),
    [filasBase, mode],
  );

  const anios = useMemo(() => {
    const s = new Set<number>([anioActual]);
    filasConMonto.forEach((f) => s.add(f.anioF));
    return Array.from(s).sort((a, b) => b - a);
  }, [filasConMonto, anioActual]);

  const coincideBusqueda = (f: (typeof filasConMonto)[number]) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.trim().toLowerCase();
    return (f.factura || "").toLowerCase().includes(q) || (f.tx.notas || "").toLowerCase().includes(q);
  };

  const filtradas = useMemo(
    () =>
      filasConMonto.filter(
        (f) =>
          f.anioF === anio &&
          (centro === "Todos" || f.centro === centro) &&
          (estadoFiltro === "todos" || f.estado === estadoFiltro) &&
          coincideBusqueda(f),
      ),
    [filasConMonto, anio, centro, estadoFiltro, busqueda],
  );

  const totalAjusteUsd = filtradas.filter((f) => f.tipo === "venta").reduce((s, f) => s + f.usd, 0);
  const totalBonoUsd = filtradas.filter((f) => f.tipo === "bono").reduce((s, f) => s + f.usd, 0);
  const gruposUnicos = new Set(filtradas.map((f) => f.grupoKey));
  const cantidad = gruposUnicos.size;
  const pendientes = new Set(filtradas.filter((f) => f.estado === "pendiente").map((f) => f.grupoKey)).size;

  const comparativoMensual = useMemo(
    () =>
      MESES.map((m, i) => {
        const fs = filtradas.filter((f) => f.mesF === i);
        return {
          mes: m,
          ajuste: fs.filter((f) => f.tipo === "venta").reduce((s, f) => s + f.usd, 0),
          bono: fs.filter((f) => f.tipo === "bono").reduce((s, f) => s + f.usd, 0),
          cantidad: new Set(fs.map((f) => f.grupoKey)).size,
        };
      }),
    [filtradas],
  );

  const chartData = useMemo(
    () => comparativoMensual.map((c) => ({ mes: c.mes, "Ajuste": c.ajuste, "Bono / servicio": c.bono })),
    [comparativoMensual],
  );

  const filasMes = useMemo(() => filtradas.filter((f) => f.mesF === mesSel - 1), [filtradas, mesSel]);
  const resumenMes = useMemo(() => resumenPorCentro(filasMes), [filasMes]);

  const filasYtd = useMemo(() => filtradas.filter((f) => f.mesF <= hastaMes - 1), [filtradas, hastaMes]);
  const resumenYtd = useMemo(() => resumenPorCentro(filasYtd), [filasYtd]);

  const filasDetalle = useMemo(
    () => filtradas.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)),
    [filtradas],
  );

  const migrar = async (t: any) => {
    const { error } = await supabase.from("transacciones").update({ modo: "on_balance" }).eq("id", t.id);
    if (error) return toast.error(error.message);
    await logAudit("transacciones", "MIGRATE", t.id, { ...t, modo: "off_balance" }, { ...t, modo: "on_balance" });
    toast.success("Migrado a on-balance");
    invalidar();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ajustes off-balance</h1>
          <p className="text-sm text-muted-foreground">Ajustes de ventas/servicio importados + ajustes ligados a factura · {label}</p>
        </div>
        <UsdViewToggle />
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div>
            <Label className="text-xs">Año</Label>
            <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{anios.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Centro de costo</Label>
            <Select value={centro} onValueChange={setCentro}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Todos">Todos</SelectItem>
                {CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={estadoFiltro} onValueChange={(v) => setEstadoFiltro(v as Estado)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pendiente">Pendientes</SelectItem>
                <SelectItem value="migrado">Migrados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Buscar (factura / notas)</Label>
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N° de factura, texto de la nota…" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-5">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total ajustes</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalAjusteUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total bono / servicio</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalBonoUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total combinado</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalAjusteUsd + totalBonoUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Ajustes ({anio})</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{cantidad}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Pendientes</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold mono ${pendientes > 0 ? "text-orange-600" : ""}`}>{pendientes}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="mes">
        <TabsList>
          <TabsTrigger value="mes">Mes individual</TabsTrigger>
          <TabsTrigger value="ytd">Acumulado YTD</TabsTrigger>
          <TabsTrigger value="comp">Comparativo mensual</TabsTrigger>
        </TabsList>

        <TabsContent value="mes">
          <div className="mb-3">
            <Label className="text-xs">Mes</Label>
            <Select value={String(mesSel)} onValueChange={(v) => setMesSel(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Card><CardContent className="pt-4"><TablaResumenCentro filas={resumenMes} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="ytd">
          <div className="mb-3">
            <Label className="text-xs">Hasta el mes</Label>
            <Select value={String(hastaMes)} onValueChange={(v) => setHastaMes(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Ene a {MESES[hastaMes - 1]} {anio}</p>
          </div>
          <Card><CardContent className="pt-4"><TablaResumenCentro filas={resumenYtd} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="comp">
          <Card>
            <CardContent className="pt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Concepto</th>
                    {comparativoMensual.map((c) => <th key={c.mes} className="text-right py-2 px-2">{c.mes}</th>)}
                    <th className="text-right py-2 px-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 px-2">Ajuste</td>
                    {comparativoMensual.map((c) => <td key={c.mes} className="py-2 px-2 text-right mono">{fmtUsd(c.ajuste)}</td>)}
                    <td className="py-2 px-2 text-right mono">{fmtUsd(totalAjusteUsd)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 px-2">Bono / servicio</td>
                    {comparativoMensual.map((c) => <td key={c.mes} className="py-2 px-2 text-right mono">{fmtUsd(c.bono)}</td>)}
                    <td className="py-2 px-2 text-right mono">{fmtUsd(totalBonoUsd)}</td>
                  </tr>
                  <tr className="border-b font-bold">
                    <td className="py-2 px-2">Total</td>
                    {comparativoMensual.map((c) => <td key={c.mes} className="py-2 px-2 text-right mono">{fmtUsd(c.ajuste + c.bono)}</td>)}
                    <td className="py-2 px-2 text-right mono">{fmtUsd(totalAjusteUsd + totalBonoUsd)}</td>
                  </tr>
                  <tr className="text-muted-foreground">
                    <td className="py-2 px-2">Cantidad</td>
                    {comparativoMensual.map((c) => <td key={c.mes} className="py-2 px-2 text-right mono">{c.cantidad || "—"}</td>)}
                    <td className="py-2 px-2 text-right mono">{cantidad}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle className="text-base">Ajustes off-balance por mes ({anio})</CardTitle></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 340 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                <Legend />
                <Bar dataKey="Ajuste" stackId="a" fill="#534AB7" />
                <Bar dataKey="Bono / servicio" stackId="a" fill="#E8A87C" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle de movimientos</CardTitle></CardHeader>
        <CardContent>
          {filasDetalle.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ajustes off-balance en el período filtrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Tipo</th>
                    <th className="text-left py-2 px-2">Factura</th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-left py-2 px-2">Detalle</th>
                    <th className="text-right py-2 px-2">Bs</th>
                    <th className="text-right py-2 px-2">{label}</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-right py-2 px-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filasDetalle.map((f) => (
                    <tr key={f.tx.id} className="border-b last:border-0">
                      <td className="py-2 px-2 mono">{fmtDate(f.tx.fecha)}</td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" style={f.tipo === "venta" ? { borderColor: "#534AB7", color: "#534AB7" } : { borderColor: "#E8A87C", color: "#B4763C" }}>
                          {f.etiqueta}
                        </Badge>
                        {f.esFiar && <Badge variant="outline" className="ml-1 text-xs">fiar</Badge>}
                      </td>
                      <td className="py-2 px-2 mono text-xs">{f.factura || "—"}</td>
                      <td className="py-2 px-2">{f.tx.centro_costo}</td>
                      <td className="py-2 px-2 text-xs">{f.tx.notas || "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(f.tx.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(f.usd)}</td>
                      <td className="py-2 px-2">
                        {f.estado === "pendiente"
                          ? <Badge variant="outline" className="text-orange-600 border-orange-300">pendiente</Badge>
                          : <Badge variant="outline" className="text-green-700 border-green-300">migrado</Badge>}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex justify-end gap-1">
                          {f.estado === "pendiente" && (
                            <Button size="sm" variant="outline" onClick={() => migrar(f.tx)}>Migrar</Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar movimiento" onClick={() => setEditing(f.tx)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Eliminar" onClick={() => setDeleteTarget(f.tx)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditDialog
          tx={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidar(); }}
        />
      )}

      <EliminarTransaccionDialog
        open={!!deleteTarget}
        transaccion={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => { setDeleteTarget(null); invalidar(); }}
      />
    </div>
  );
}
