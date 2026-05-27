import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Pencil, Power } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";

export const Route = createFileRoute("/_authenticated/cuentas-bancarias")({ component: CuentasBancariasPage });

type Cuenta = {
  id: string;
  nombre: string;
  banco: string;
  numero: string;
  titular: string;
  moneda: "BS" | "USD";
  activa: boolean;
  saldo_inicial?: number;
  saldo_inicial_fecha?: string | null;
};


function CuentasBancariasPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Cuenta | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["cuentas-bancarias-all"],
    queryFn: async () => {
      const { data } = await supabase.from("cuentas_bancarias" as any).select("*").order("activa", { ascending: false }).order("nombre");
      return ((data as any[]) ?? []) as Cuenta[];
    },
  });

  const toggleActiva = async (c: Cuenta) => {
    const { error } = await supabase.from("cuentas_bancarias" as any).update({ activa: !c.activa } as any).eq("id", c.id);
    if (error) return toast.error(error.message);
    await logAudit("cuentas_bancarias", "UPDATE", c.id, c, { ...c, activa: !c.activa });
    toast.success(c.activa ? "Cuenta desactivada" : "Cuenta activada");
    qc.invalidateQueries({ queryKey: ["cuentas-bancarias-all"] });
    qc.invalidateQueries({ queryKey: ["cuentas-bancarias-activas"] });
  };

  const eliminar = async (c: Cuenta) => {
    const { count } = await supabase.from("transacciones").select("id", { count: "exact", head: true }).eq("cuenta_bancaria_id" as any, c.id);
    if ((count ?? 0) > 0) {
      toast.error(`No se puede eliminar: ${count} transacciones asociadas. Desactívala.`);
      throw new Error("tiene transacciones");
    }
    const { error } = await supabase.from("cuentas_bancarias" as any).delete().eq("id", c.id);
    if (error) throw error;
    await logAudit("cuentas_bancarias", "DELETE", c.id, c, null);
    toast.success("Cuenta eliminada");
    qc.invalidateQueries({ queryKey: ["cuentas-bancarias-all"] });
    qc.invalidateQueries({ queryKey: ["cuentas-bancarias-activas"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cuentas bancarias</h1>
          <p className="text-sm text-muted-foreground">Gestiona las cuentas donde entra y sale el dinero</p>
        </div>
        <Button onClick={() => setCreating(true)}>Nueva cuenta</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Listado</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cuentas bancarias registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Nombre</th>
                    <th className="text-left py-2 px-2">Banco</th>
                    <th className="text-left py-2 px-2">Número</th>
                    <th className="text-left py-2 px-2">Titular</th>
                    <th className="text-left py-2 px-2">Moneda</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium">{c.nombre}</td>
                      <td className="py-2 px-2">{c.banco}</td>
                      <td className="py-2 px-2 mono">{c.numero}</td>
                      <td className="py-2 px-2">{c.titular}</td>
                      <td className="py-2 px-2"><Badge variant="outline">{c.moneda}</Badge></td>
                      <td className="py-2 px-2">{c.activa ? <Badge className="bg-green-600">activa</Badge> : <Badge variant="secondary">inactiva</Badge>}</td>
                      <td className="py-2 px-2 flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(c)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => toggleActiva(c)} title={c.activa ? "Desactivar" : "Activar"}><Power className="h-4 w-4" /></Button>
                        <DeleteButton detail={`${c.nombre} — ${c.banco} · ${c.numero}`} onConfirm={() => eliminar(c)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <CuentaModal
          cuenta={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={() => {
            setCreating(false); setEditing(null);
            qc.invalidateQueries({ queryKey: ["cuentas-bancarias-all"] });
            qc.invalidateQueries({ queryKey: ["cuentas-bancarias-activas"] });
          }}
        />
      )}
    </div>
  );
}

function CuentaModal({ cuenta, onClose, onDone }: { cuenta: Cuenta | null; onClose: () => void; onDone: () => void }) {
  const [nombre, setNombre] = useState(cuenta?.nombre ?? "");
  const [banco, setBanco] = useState(cuenta?.banco ?? "");
  const [numero, setNumero] = useState(cuenta?.numero ?? "");
  const [titular, setTitular] = useState(cuenta?.titular ?? "");
  const [moneda, setMoneda] = useState<"BS" | "USD">(cuenta?.moneda ?? "BS");
  const [saldoInicial, setSaldoInicial] = useState<string>(String(cuenta?.saldo_inicial ?? "0"));
  const [saldoFecha, setSaldoFecha] = useState<string>(cuenta?.saldo_inicial_fecha ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre || !banco || !numero || !titular) return toast.error("Completa todos los campos");
    setBusy(true);
    const payload = {
      nombre, banco, numero, titular, moneda,
      saldo_inicial: Number(saldoInicial) || 0,
      saldo_inicial_fecha: saldoFecha || null,
    };
    if (cuenta) {
      const { error } = await supabase.from("cuentas_bancarias" as any).update(payload as any).eq("id", cuenta.id);
      if (error) { setBusy(false); return toast.error(error.message); }
      await logAudit("cuentas_bancarias", "UPDATE", cuenta.id, cuenta, { ...cuenta, ...payload });
      toast.success("Cuenta actualizada");
    } else {
      const { data, error } = await supabase.from("cuentas_bancarias" as any).insert(payload as any).select().single();
      if (error) { setBusy(false); return toast.error(error.message); }
      if (data) await logAudit("cuentas_bancarias", "INSERT", (data as any).id, null, data);
      toast.success("Cuenta creada");
    }
    setBusy(false);
    onDone();
  };


  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{cuenta ? "Editar cuenta" : "Nueva cuenta bancaria"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Nombre corto</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Banesco Principal" required /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Banco</Label><Input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Banesco" required /></div>
            <div>
              <Label>Moneda</Label>
              <Select value={moneda} onValueChange={(v) => setMoneda(v as "BS" | "USD")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BS">Bs</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Número de cuenta</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} className="mono" required /></div>
          <div><Label>Titular</Label><Input value={titular} onChange={(e) => setTitular(e.target.value)} required /></div>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            <div>
              <Label>Saldo inicial ({moneda})</Label>
              <Input type="number" step="0.01" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} className="mono" />
            </div>
            <div>
              <Label>Fecha del saldo inicial</Label>
              <Input type="date" value={saldoFecha} onChange={(e) => setSaldoFecha(e.target.value)} />
            </div>
            <p className="col-span-2 text-[11px] text-muted-foreground">
              Solo se cuentan transacciones posteriores a esta fecha para calcular el saldo teórico.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
