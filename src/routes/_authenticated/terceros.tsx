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

export const Route = createFileRoute("/_authenticated/terceros")({ component: TercerosPage });

function TercerosPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    razon_social: "", nombre_comercial: "", tipo_rif: "J", rif: "",
    tipo: "proveedor", email: "", telefono: "", direccion_fiscal: "",
  });

  const { data } = useQuery({
    queryKey: ["terceros"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("*").order("razon_social");
      return data ?? [];
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("terceros").insert(form as any);
    if (error) return toast.error(error.message);
    toast.success("Tercero creado");
    qc.invalidateQueries({ queryKey: ["terceros"] });
    setOpen(false);
    setForm({ razon_social: "", nombre_comercial: "", tipo_rif: "J", rif: "", tipo: "proveedor", email: "", telefono: "", direccion_fiscal: "" });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Terceros</h1>
          <p className="text-sm text-muted-foreground">Clientes y proveedores</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Nuevo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuevo tercero</DialogTitle></DialogHeader>
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
        <CardHeader><CardTitle className="text-base">Listado</CardTitle></CardHeader>
        <CardContent>
          {!data || data.length === 0 ? <p className="text-sm text-muted-foreground">Sin terceros registrados.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left py-2 px-2">Razón social</th><th className="text-left py-2 px-2">RIF</th><th className="text-left py-2 px-2">Tipo</th><th className="text-left py-2 px-2">Email</th><th className="text-left py-2 px-2">Tel.</th></tr>
              </thead>
              <tbody>
                {data.map((t: any) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 px-2">{t.razon_social}</td>
                    <td className="py-2 px-2 mono text-xs">{t.tipo_rif}-{t.rif}</td>
                    <td className="py-2 px-2">{t.tipo}</td>
                    <td className="py-2 px-2 text-muted-foreground">{t.email ?? "—"}</td>
                    <td className="py-2 px-2 text-muted-foreground">{t.telefono ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
