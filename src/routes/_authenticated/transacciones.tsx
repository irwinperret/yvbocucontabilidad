import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { DeleteButton } from "@/components/delete-button";
import { logAudit, isPeriodClosed } from "@/lib/audit";
import { CENTROS, METODOS, type Centro } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";
import { AdjuntoCell } from "@/components/adjunto-cell";

export const Route = createFileRoute("/_authenticated/transacciones")({
  component: TransaccionesPage,
});

function TransaccionesPage() {
  const qc = useQueryClient();
  const [desde, setDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [hasta, setHasta] = useState(todayISO());
  const [centro, setCentro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [editing, setEditing] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["transacciones-list", desde, hasta, centro],
    queryFn: async () => {
      let q = supabase
        .from("transacciones")
        .select("*")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (centro !== "todos") q = q.eq("centro_costo", centro as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-all-list"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre").order("orden");
      return data ?? [];
    },
  });

  const cuentaNombre = useMemo(() => {
    const m: Record<string, string> = {};
    (cuentas ?? []).forEach((c: any) => { m[c.codigo] = c.nombre; });
    return m;
  }, [cuentas]);

  const filtradas = (data ?? []).filter((t: any) => {
    if (!busca) return true;
    const s = busca.toLowerCase();
    return (
      t.cuenta_codigo?.toLowerCase().includes(s) ||
      cuentaNombre[t.cuenta_codigo]?.toLowerCase().includes(s) ||
      t.numero_factura?.toLowerCase().includes(s) ||
      t.referencia?.toLowerCase().includes(s) ||
      t.notas?.toLowerCase().includes(s)
    );
  });

  const eliminar = async (t: any) => {
    if (await isPeriodClosed(t.fecha)) {
      toast.error("Este mes ya está cerrado, así que no puedes borrar esta transacción todavía.", {
        description: "Si necesitas corregirla, ve a Registrar → pestaña «COGS e Inventario» y reabre el mes. Luego podrás editarla o eliminarla y volver a cerrarlo.",
        duration: 8000,
      });
      throw new Error("blocked");
    }
    const { error } = await supabase.from("transacciones").delete().eq("id", t.id);
    if (error) { toast.error(error.message); throw error; }
    await logAudit("transacciones", "DELETE", t.id, t, null);
    toast.success("Movimiento eliminado");
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transacciones</h1>
        <p className="text-sm text-muted-foreground">Lista de movimientos registrados — editar o eliminar</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div><Label>Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><Label>Hasta</Label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
            <div>
              <Label>Centro</Label>
              <Select value={centro} onValueChange={setCentro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Buscar</Label>
              <Input placeholder="cuenta, factura, referencia, notas…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Cargando…" : `${filtradas.length} movimientos`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos en este rango.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-left py-2 px-2">Cuenta</th>
                    <th className="text-left py-2 px-2">Factura</th>
                    <th className="text-right py-2 px-2">Bs</th>
                    <th className="text-right py-2 px-2">USD</th>
                    <th className="text-left py-2 px-2">Método</th>
                    <th className="text-left py-2 px-2">Modo</th>
                    <th className="text-center py-2 px-2">Factura</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((t: any) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2 mono whitespace-nowrap">{fmtDate(t.fecha)}</td>
                      <td className="py-2 px-2">{t.centro_costo}</td>
                      <td className="py-2 px-2">
                        <div className="mono text-xs">{t.cuenta_codigo}</div>
                        <div className="text-xs text-muted-foreground">{cuentaNombre[t.cuenta_codigo] ?? ""}</div>
                      </td>
                      <td className="py-2 px-2 mono text-xs">{t.numero_factura ?? "—"}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(t.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(t.monto_usd)}</td>
                      <td className="py-2 px-2 text-xs">{t.metodo_pago ?? "—"}</td>
                      <td className="py-2 px-2">
                        {t.modo === "off_balance"
                          ? <Badge variant="outline" className="text-[10px]">off</Badge>
                          : <Badge className="text-[10px]">on</Badge>}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <AdjuntoCell
                          transaccionId={t.id}
                          adjuntoPath={t.adjunto_url ?? null}
                          canDelete={true}
                          onChange={(p) => {
                            t.adjunto_url = p;
                            qc.invalidateQueries({ queryKey: ["transacciones-list"] });
                          }}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditing(t)}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <DeleteButton
                            detail={`${fmtDate(t.fecha)} · ${t.cuenta_codigo} · ${fmtBs(t.monto_bs)}`}
                            onConfirm={() => eliminar(t)}
                          />
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
          onSaved={() => { setEditing(null); qc.invalidateQueries(); }}
        />
      )}
    </div>
  );
}

function EditDialog({ tx, onClose, onSaved }: { tx: any; onClose: () => void; onSaved: () => void }) {
  const [fecha, setFecha] = useState<string>(tx.fecha);
  const [centro, setCentro] = useState<Centro>(tx.centro_costo);
  const [montoBs, setMontoBs] = useState<string>(String(tx.monto_bs ?? ""));
  const [tasa, setTasa] = useState<string>(String(tx.tasa_bcv ?? ""));
  const [metodo, setMetodo] = useState<string>(tx.metodo_pago ?? "transferencia");
  const [numFactura, setNumFactura] = useState<string>(tx.numero_factura ?? "");
  const [referencia, setReferencia] = useState<string>(tx.referencia ?? "");
  const [notas, setNotas] = useState<string>(tx.notas ?? "");
  const [cuentaBancariaId, setCuentaBancariaId] = useState<string>(tx.cuenta_bancaria_id ?? "");
  const [busy, setBusy] = useState(false);

  const total = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0;
  const base = tx.iva_aplica ? total / 1.16 : total;
  const iva = tx.iva_aplica ? total - base : 0;
  const usd = tasaN ? base / tasaN : 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await isPeriodClosed(fecha) || await isPeriodClosed(tx.fecha)) {
      return toast.error("Período cerrado — no se puede editar");
    }
    if (!tasaN) return toast.error("Falta tasa");
    setBusy(true);
    const patch = {
      fecha,
      centro_costo: centro as any,
      monto_bs: total,
      monto_base_bs: base,
      iva_bs: iva,
      tasa_bcv: tasaN,
      monto_usd: usd,
      metodo_pago: metodo as any,
      numero_factura: numFactura || null,
      referencia: referencia || null,
      notas: notas || null,
      cuenta_bancaria_id: cuentaBancariaId || null,
    };
    const { data: updated, error } = await supabase
      .from("transacciones")
      .update(patch as any)
      .eq("id", tx.id)
      .select()
      .single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (updated) await logAudit("transacciones", "UPDATE", tx.id, tx, updated);
    toast.success("Movimiento actualizado");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar movimiento — {tx.cuenta_codigo}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Centro</Label>
            <Select value={centro} onValueChange={(v) => setCentro(v as Centro)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Monto Bs {tx.iva_aplica ? "(IVA incluido)" : ""}</Label>
            <Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Tasa BCV</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          <div className="md:col-span-2 rounded-md bg-muted p-2 text-sm flex justify-between">
            <span className="text-muted-foreground">USD recalculado</span>
            <span className="mono font-semibold">{fmtUsd(usd)}</span>
          </div>
          <div>
            <Label>Método</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METODOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>N° factura</Label><Input value={numFactura} onChange={(e) => setNumFactura(e.target.value)} /></div>
          <div className="md:col-span-2">
            <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
          </div>
          <div><Label>Referencia</Label><Input value={referencia} onChange={(e) => setReferencia(e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
