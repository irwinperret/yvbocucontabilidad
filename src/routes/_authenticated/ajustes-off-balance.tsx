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

// Los "ajustes off-balance" son el par de movimientos que genera el formulario
// "Ajuste off-balance" en Registrar (venta + bono 10%), ligados a una factura
// ya existente. Se identifican por el texto fijo que ese formulario escribe en
// notas -- eso funciona igual estén todavía en off_balance o ya migrados a
// on_balance con el botón "Migrar" de la pantalla "Off balance", así el
// historial mes a mes no se pierde cuando se migra un ajuste.
const NOTAS_VENTA = "Ajuste off-balance";
const NOTAS_BONO = "(off-balance) por factura";

type Estado = "todos" | "pendiente" | "migrado";

type Grupo = {
  key: string;
  venta: any | null;
  bono: any | null;
  fecha: string;
  anioF: number;
  mesF: number;
  centro: string;
  factura: string;
  esFiar: boolean;
  estado: "pendiente" | "migrado";
};

function resumenPorCentro(grupos: (Grupo & { ajusteUsd: number; bonoUsd: number })[]) {
  const filas = CENTROS.map((c) => {
    const gs = grupos.filter((g) => g.centro === c);
    return {
      centro: c as string,
      ajuste: gs.reduce((s, g) => s + g.ajusteUsd, 0),
      bono: gs.reduce((s, g) => s + g.bonoUsd, 0),
      cantidad: gs.length,
    };
  });
  const total = {
    centro: "Total",
    ajuste: filas.reduce((s, f) => s + f.ajuste, 0),
    bono: filas.reduce((s, f) => s + f.bono, 0),
    cantidad: filas.reduce((s, f) => s + f.cantidad, 0),
  };
  return [...filas, total];
}

function TablaResumenCentro({ filas }: { filas: ReturnType<typeof resumenPorCentro> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            <th className="text-left py-2 px-2">Centro</th>
            <th className="text-right py-2 px-2">Ajuste</th>
            <th className="text-right py-2 px-2">Bono 10%</th>
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
    qc.invalidateQueries({ queryKey: ["ajustes-off-venta"] });
    qc.invalidateQueries({ queryKey: ["ajustes-off-bono"] });
  };

  const { data: ventas } = useQuery({
    queryKey: ["ajustes-off-venta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transacciones").select("*").neq("standby", true)
        .ilike("notas", `${NOTAS_VENTA}%`)
        .order("fecha", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: bonos } = useQuery({
    queryKey: ["ajustes-off-bono"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transacciones").select("*").neq("standby", true)
        .eq("cuenta_codigo", "8.3")
        .ilike("notas", `%${NOTAS_BONO}%`)
        .order("fecha", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Empareja cada venta con su bono 10% (mismo grupo_transaccion_id, o
  // pareja_off_balance_id como respaldo). Un ajuste sin bono asociado (monto
  // de bono en $0 al registrarlo) queda con bono = null.
  const grupos = useMemo<Grupo[]>(() => {
    const bonoByGrupo = new Map<string, any>();
    const bonoById = new Map<string, any>();
    (bonos ?? []).forEach((b: any) => {
      if (b.grupo_transaccion_id) bonoByGrupo.set(b.grupo_transaccion_id, b);
      bonoById.set(b.id, b);
    });
    const usados = new Set<string>();
    const out: Grupo[] = (ventas ?? []).map((v: any) => {
      let bono = v.grupo_transaccion_id ? bonoByGrupo.get(v.grupo_transaccion_id) : undefined;
      if (!bono && v.pareja_off_balance_id) bono = bonoById.get(v.pareja_off_balance_id);
      if (bono) usados.add(bono.id);
      const fechaD = new Date(v.fecha);
      const estado: "pendiente" | "migrado" =
        v.modo === "on_balance" && (!bono || bono.modo === "on_balance") ? "migrado" : "pendiente";
      return {
        key: v.grupo_transaccion_id || v.id,
        venta: v,
        bono: bono ?? null,
        fecha: v.fecha,
        anioF: fechaD.getUTCFullYear(),
        mesF: fechaD.getUTCMonth(),
        centro: v.centro_costo,
        factura: v.numero_factura || v.numero_orden || "",
        esFiar: (v.notas ?? "").includes("A CRÉDITO"),
        estado,
      };
    });
    // Bonos sin la venta que los originó (caso raro, p. ej. si la venta se
    // borró aparte) -- se muestran igual para no perder el monto.
    (bonos ?? []).forEach((b: any) => {
      if (usados.has(b.id)) return;
      const fechaD = new Date(b.fecha);
      out.push({
        key: b.grupo_transaccion_id || b.id,
        venta: null,
        bono: b,
        fecha: b.fecha,
        anioF: fechaD.getUTCFullYear(),
        mesF: fechaD.getUTCMonth(),
        centro: b.centro_costo,
        factura: b.numero_factura || b.numero_orden || "",
        esFiar: false,
        estado: b.modo === "on_balance" ? "migrado" : "pendiente",
      });
    });
    return out;
  }, [ventas, bonos]);

  const gruposConMonto = useMemo(
    () =>
      grupos.map((g) => {
        const ajusteUsd = g.venta ? usdVisual(g.venta, mode) ?? 0 : 0;
        const bonoUsd = g.bono ? usdVisual(g.bono, mode) ?? 0 : 0;
        return { ...g, ajusteUsd, bonoUsd };
      }),
    [grupos, mode],
  );

  const anios = useMemo(() => {
    const s = new Set<number>([anioActual]);
    gruposConMonto.forEach((g) => s.add(g.anioF));
    return Array.from(s).sort((a, b) => b - a);
  }, [gruposConMonto, anioActual]);

  const coincideBusqueda = (g: (typeof gruposConMonto)[number]) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.trim().toLowerCase();
    return (
      (g.factura || "").toLowerCase().includes(q) ||
      (g.venta?.notas || "").toLowerCase().includes(q) ||
      (g.bono?.notas || "").toLowerCase().includes(q)
    );
  };

  const gruposFiltrados = useMemo(
    () =>
      gruposConMonto.filter(
        (g) =>
          g.anioF === anio &&
          (centro === "Todos" || g.centro === centro) &&
          (estadoFiltro === "todos" || g.estado === estadoFiltro) &&
          coincideBusqueda(g),
      ),
    [gruposConMonto, anio, centro, estadoFiltro, busqueda],
  );

  const totalAjusteUsd = gruposFiltrados.reduce((s, g) => s + g.ajusteUsd, 0);
  const totalBonoUsd = gruposFiltrados.reduce((s, g) => s + g.bonoUsd, 0);
  const cantidad = gruposFiltrados.length;
  const pendientes = gruposFiltrados.filter((g) => g.estado === "pendiente").length;

  const comparativoMensual = useMemo(
    () =>
      MESES.map((m, i) => {
        const gs = gruposFiltrados.filter((g) => g.mesF === i);
        return {
          mes: m,
          ajuste: gs.reduce((s, g) => s + g.ajusteUsd, 0),
          bono: gs.reduce((s, g) => s + g.bonoUsd, 0),
          cantidad: gs.length,
        };
      }),
    [gruposFiltrados],
  );

  const chartData = useMemo(
    () => comparativoMensual.map((c) => ({ mes: c.mes, "Ajuste": c.ajuste, "Bono 10%": c.bono })),
    [comparativoMensual],
  );

  const gruposMes = useMemo(() => gruposFiltrados.filter((g) => g.mesF === mesSel - 1), [gruposFiltrados, mesSel]);
  const resumenMes = useMemo(() => resumenPorCentro(gruposMes), [gruposMes]);

  const gruposYtd = useMemo(() => gruposFiltrados.filter((g) => g.mesF <= hastaMes - 1), [gruposFiltrados, hastaMes]);
  const resumenYtd = useMemo(() => resumenPorCentro(gruposYtd), [gruposYtd]);

  const filasDetalle = useMemo(() => {
    const out: { tx: any; tipo: "Ajuste" | "Bono 10%"; estadoTx: "pendiente" | "migrado"; esFiar: boolean; usd: number }[] = [];
    gruposFiltrados.forEach((g) => {
      if (g.venta) out.push({ tx: g.venta, tipo: "Ajuste", estadoTx: g.venta.modo === "on_balance" ? "migrado" : "pendiente", esFiar: g.esFiar, usd: g.ajusteUsd });
      if (g.bono) out.push({ tx: g.bono, tipo: "Bono 10%", estadoTx: g.bono.modo === "on_balance" ? "migrado" : "pendiente", esFiar: false, usd: g.bonoUsd });
    });
    return out.sort((a, b) => (a.tx.fecha < b.tx.fecha ? 1 : a.tx.fecha > b.tx.fecha ? -1 : 0));
  }, [gruposFiltrados]);

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
          <p className="text-sm text-muted-foreground">Ventas de ajuste ligadas a factura + su bono 10% · {label}</p>
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
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N° de factura, cliente…" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-5">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total ajustes</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{fmtUsd(totalAjusteUsd)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total bono 10%</CardTitle></CardHeader>
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
                    <td className="py-2 px-2">Bono 10%</td>
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
                <Bar dataKey="Bono 10%" stackId="a" fill="#E8A87C" />
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
                  {filasDetalle.map(({ tx, tipo, estadoTx, esFiar, usd }) => (
                    <tr key={tx.id} className="border-b last:border-0">
                      <td className="py-2 px-2 mono">{fmtDate(tx.fecha)}</td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" style={tipo === "Ajuste" ? { borderColor: "#534AB7", color: "#534AB7" } : { borderColor: "#E8A87C", color: "#B4763C" }}>
                          {tipo}
                        </Badge>
                        {esFiar && <Badge variant="outline" className="ml-1 text-xs">fiar</Badge>}
                      </td>
                      <td className="py-2 px-2 mono text-xs">{tx.numero_factura || tx.numero_orden || "—"}</td>
                      <td className="py-2 px-2">{tx.centro_costo}</td>
                      <td className="py-2 px-2 text-xs">{tx.notas || "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(tx.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(usd)}</td>
                      <td className="py-2 px-2">
                        {estadoTx === "pendiente"
                          ? <Badge variant="outline" className="text-orange-600 border-orange-300">pendiente</Badge>
                          : <Badge variant="outline" className="text-green-700 border-green-300">migrado</Badge>}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex justify-end gap-1">
                          {estadoTx === "pendiente" && (
                            <Button size="sm" variant="outline" onClick={() => migrar(tx)}>Migrar</Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar movimiento" onClick={() => setEditing(tx)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Eliminar" onClick={() => setDeleteTarget(tx)}>
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
