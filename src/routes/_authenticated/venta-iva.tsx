import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Trash2, PlusCircle } from "lucide-react";
import { fmtUsd, fmtBs } from "@/lib/format";
import { useMesCerradoGuard } from "@/lib/mes-cerrado-guard";
import {
  listarVentaIva, guardarVentaIva, borrarVentaIva, periodoDeFecha,
  type VentaIvaRow,
} from "@/lib/venta-iva";
import { tasaBcvParaFecha, tasaParalelaParaFecha } from "@/lib/tasas";

export const Route = createFileRoute("/_authenticated/venta-iva")({
  component: VentaIvaPage,
});

function periodoLabel(periodo: string) {
  const [y, m] = periodo.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-VE", { year: "numeric", month: "long" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function VentaIvaPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const ensurePeriodoAbierto = useMesCerradoGuard();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["venta-iva"],
    queryFn: listarVentaIva,
  });

  const maxFechaVentaIva = useMemo(() => {
    const fechas = (rows ?? []).map((r) => r.fecha).filter(Boolean);
    return fechas.length ? fechas.reduce((a, b) => (b > a ? b : a)) : null;
  }, [rows]);

  const { data: paralelasHist } = useQuery({
    queryKey: ["tasas-paralela-hist-venta-iva", maxFechaVentaIva],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasas_paralela")
        .select("fecha, tasa")
        .lte("fecha", maxFechaVentaIva as string)
        .order("fecha", { ascending: true });
      return (data ?? []) as { fecha: string; tasa: number }[];
    },
    enabled: !!maxFechaVentaIva,
  });

  const paralelaOnOrBefore = (fecha: string): number => {
    let tasa = 0;
    for (const p of paralelasHist ?? []) {
      if (p.fecha > fecha) break;
      tasa = Number(p.tasa) || tasa;
    }
    return tasa;
  };

  /** Equivalente en USD paralelo de un registro, usando la tasa paralela de
   * su fecha (null si todavía no hay ninguna tasa paralela publicada). */
  const usdParalelo = (r: VentaIvaRow): number | null => {
    const tp = paralelaOnOrBefore(r.fecha);
    return tp > 0 ? (Number(r.monto_bs) || 0) / tp : null;
  };

  const porPeriodo = useMemo(() => {
    const m = new Map<string, VentaIvaRow>();
    (rows ?? []).forEach((r) => {
      const p = periodoDeFecha(r.fecha);
      // Si llegara a haber más de un registro en el mismo mes (no debería,
      // el campito de Inicio actualiza el existente), se muestra el más
      // reciente por fecha -- ya viene ordenado desc desde listarVentaIva.
      if (!m.has(p)) m.set(p, r);
    });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const [editing, setEditing] = useState<VentaIvaRow | "nuevo" | null>(null);
  const [fecha, setFecha] = useState(todayISO());
  const [montoUsd, setMontoUsd] = useState("");
  const [tasa, setTasa] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [tasaParalela, setTasaParalela] = useState<number | null>(null);

  // Tasa paralela de referencia para la fecha seleccionada -- solo para
  // mostrar el equivalente en USD paralelo en la ventana; no se guarda en el
  // registro (Venta de IVA se registra en USD BCV, igual que antes). Se
  // recalcula cada vez que cambia la fecha mientras la ventana está abierta.
  useEffect(() => {
    if (editing === null) return;
    let activo = true;
    (async () => {
      const t = await tasaParalelaParaFecha(fecha);
      if (activo) setTasaParalela(t || null);
    })();
    return () => { activo = false; };
  }, [fecha, editing]);

  // Trae la tasa BCV de una fecha puntual y la aplica al campo Tasa BCV de
  // la ventana -- se usa tanto al abrir "Nuevo mes" como cada vez que se
  // cambia la fecha dentro de la ventana (nuevo registro o edición), para
  // que la tasa siempre corresponda a la fecha que está seleccionada.
  const actualizarTasaParaFecha = async (f: string) => {
    const t = await tasaBcvParaFecha(f);
    if (t) setTasa(String(t));
  };

  const openNuevo = async () => {
    const hoy = todayISO();
    setEditing("nuevo");
    setFecha(hoy);
    setMontoUsd("");
    setTasa("");
    setNotas("");
    await actualizarTasaParaFecha(hoy);
  };

  const cambiarFecha = (f: string) => {
    setFecha(f);
    actualizarTasaParaFecha(f);
  };

  const openEdit = (r: VentaIvaRow) => {
    setEditing(r);
    setFecha(r.fecha);
    setMontoUsd(String(r.monto_usd ?? ""));
    setTasa(String(r.tasa_bcv ?? ""));
    setNotas(r.notas ?? "");
  };

  const close = () => setEditing(null);

  const montoUsdN = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  const montoBs = +(montoUsdN * tasaN).toFixed(2);

  const save = async () => {
    if (!user) return;
    if (!montoUsdN) return toast.error("Falta el monto en USD");
    if (!tasaN) return toast.error("Falta la tasa BCV");
    if (!(await ensurePeriodoAbierto(fecha))) return;
    setBusy(true);
    try {
      await guardarVentaIva({
        id: editing !== "nuevo" ? editing?.id : undefined,
        fecha,
        montoUsd: montoUsdN,
        tasaBcv: tasaN,
        notas: notas || null,
        userId: user.id,
      });
      toast.success("Venta de IVA guardada");
      close();
      qc.invalidateQueries({ queryKey: ["venta-iva"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error guardando");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (r: VentaIvaRow) => {
    if (!confirm(`¿Borrar la Venta de IVA de ${periodoLabel(periodoDeFecha(r.fecha))} (${fmtUsd(Number(r.monto_usd) || 0)})?`)) return;
    if (!(await ensurePeriodoAbierto(r.fecha))) return;
    try {
      await borrarVentaIva(r.id);
      toast.success("Registro borrado");
      qc.invalidateQueries({ queryKey: ["venta-iva"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error borrando");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Venta de IVA</h1>
          <p className="text-sm text-muted-foreground">
            Ingreso neto mensual (cuenta 1.8). Un registro por mes, igual que el inventario: afecta G&amp;P y Flujo de Caja.
          </p>
        </div>
        <Button onClick={openNuevo}>
          <PlusCircle className="h-4 w-4 mr-1" /> Nuevo mes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registros por mes ({porPeriodo.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">Cargando…</p>
          ) : porPeriodo.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Sin registros todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Mes</th>
                    <th className="py-2 pr-4">Fecha</th>
                    <th className="py-2 pr-4 text-right">USD</th>
                    <th className="py-2 pr-4 text-right">Bs</th>
                    <th className="py-2 pr-4 text-right">Tasa BCV</th>
                    <th className="py-2 pr-4 text-right">USD paralelo</th>
                    <th className="py-2 pr-4">Notas</th>
                    <th className="py-2 pr-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {porPeriodo.map(([periodo, r]) => (
                    <tr key={periodo} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium capitalize">{periodoLabel(periodo)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.fecha}</td>
                      <td className="py-2 pr-4 text-right mono font-semibold">{fmtUsd(Number(r.monto_usd) || 0)}</td>
                      <td className="py-2 pr-4 text-right mono text-muted-foreground">{fmtBs(Number(r.monto_bs) || 0)}</td>
                      <td className="py-2 pr-4 text-right mono text-muted-foreground">{Number(r.tasa_bcv) || 0}</td>
                      <td className="py-2 pr-4 text-right mono text-muted-foreground">{usdParalelo(r) != null ? fmtUsd(usdParalelo(r) as number) : "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground max-w-[220px] truncate">{r.notas}</td>
                      <td className="py-2 pr-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(r)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "nuevo" ? "Nuevo registro — Venta de IVA" : "Editar — Venta de IVA"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => cambiarFecha(e.target.value)} />
            </div>
            <div>
              <Label>Tasa BCV</Label>
              <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} className="mono" />
            </div>
            <div>
              <Label>Monto (USD)</Label>
              <Input type="number" step="0.01" value={montoUsd} onChange={(e) => setMontoUsd(e.target.value)} className="mono" />
            </div>
            <div className="rounded-md bg-muted p-3 flex flex-col justify-center">
              <span className="text-xs text-muted-foreground">Bs</span>
              <span className="text-base font-bold mono">{fmtBs(montoBs)}</span>
            </div>
            <div className="col-span-2 rounded-md bg-muted/50 border p-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Equivalente en USD paralelo{tasaParalela ? ` (tasa ${tasaParalela})` : ""}
              </span>
              <span className="text-base font-bold mono">{tasaParalela ? fmtUsd(montoBs / tasaParalela) : "—"}</span>
            </div>
            <div className="col-span-2">
              <Label>Notas</Label>
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancelar</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
