import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DeleteButton } from "@/components/delete-button";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/proveedores")({ component: ProveedoresPage });

function ProveedoresPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const blank = {
    razon_social: "", nombre_comercial: "", tipo_rif: "J", rif: "",
    tipo: "proveedor", email: "", telefono: "", direccion_fiscal: "",
  };
  const [form, setForm] = useState(blank);

  const { data } = useQuery({
    queryKey: ["proveedores"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("*").order("razon_social");
      return data ?? [];
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: created, error } = await supabase.from("terceros").insert(form as any).select().single();
    if (error) return toast.error(error.message);
    if (created) await logAudit("terceros", "INSERT", created.id, null, created);
    toast.success("Proveedor creado");
    qc.invalidateQueries({ queryKey: ["proveedores"] });
    setOpen(false);
    setForm(blank);
  };

  const eliminar = async (p: any) => {
    const { count } = await supabase.from("transacciones").select("*", { count: "exact", head: true }).eq("tercero_id", p.id);
    if (count && count > 0) {
      toast.error(`Proveedor con ${count} movimientos — no se puede eliminar`);
      throw new Error("blocked");
    }
    const { error } = await supabase.from("terceros").delete().eq("id", p.id);
    if (error) throw error;
    await logAudit("terceros", "DELETE", p.id, p, null);
    toast.success("Proveedor eliminado");
    qc.invalidateQueries({ queryKey: ["proveedores"] });
  };

  const filtrados = (data ?? []).filter((t: any) =>
    !busca ||
    t.razon_social?.toLowerCase().includes(busca.toLowerCase()) ||
    t.rif?.includes(busca)
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proveedores</h1>
          <p className="text-sm text-muted-foreground">Clientes y proveedores</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Nuevo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuevo proveedor</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Razón social</Label><Input required value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} /></div>
              <div><Label>Nombre comercial</Label><Input value={form.nombre_comercial} onChange={(e) => setForm({ ...form, nombre_comercial: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Tipo RIF</Label>
                  <Select value={form.tipo_rif} onValueChange={(v) => setForm({ ...form, tipo_rif: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["J","V","E","G"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Label>RIF</Label><Input required value={form.rif} onChange={(e) => setForm({ ...form, rif: e.target.value })} /></div>
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["cliente","proveedor","ambos"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Teléfono</Label><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
              <div><Label>Dirección fiscal</Label><Input value={form.direccion_fiscal} onChange={(e) => setForm({ ...form, direccion_fiscal: e.target.value })} /></div>
              <Button type="submit" className="w-full">Guardar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center gap-4">
            <CardTitle className="text-base">Listado</CardTitle>
            <Input placeholder="Buscar por RIF o razón social…" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
          </div>
        </CardHeader>
        <CardContent>
          {filtrados.length === 0 ? <p className="text-sm text-muted-foreground">Sin proveedores.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Razón social</th>
                    <th className="text-left py-2 px-2">RIF</th>
                    <th className="text-left py-2 px-2">Tipo</th>
                    <th className="text-left py-2 px-2">Email</th>
                    <th className="text-left py-2 px-2">Tel.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((t: any) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 px-2">{t.razon_social}</td>
                      <td className="py-2 px-2 mono text-xs">{t.tipo_rif}-{t.rif}</td>
                      <td className="py-2 px-2">{t.tipo}</td>
                      <td className="py-2 px-2 text-muted-foreground">{t.email ?? "—"}</td>
                      <td className="py-2 px-2 text-muted-foreground">{t.telefono ?? "—"}</td>
                      <td className="py-2 px-2 text-right">
                        <DeleteButton
                          detail={`${t.razon_social} · ${t.tipo_rif}-${t.rif}`}
                          onConfirm={() => eliminar(t)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
