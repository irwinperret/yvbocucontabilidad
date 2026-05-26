import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";

type Tercero = {
  id: string;
  razon_social: string;
  nombre_comercial: string | null;
  tipo_rif: string;
  rif: string;
  tipo: string;
  email: string | null;
  telefono: string | null;
  direccion_fiscal: string | null;
};

interface Props {
  value: string;
  onChange: (id: string) => void;
  terceros: Tercero[];
  label?: string;
  defaultTipo?: "proveedor" | "cliente" | "ambos";
}

export function TerceroSelect({ value, onChange, terceros, label = "Proveedor", defaultTipo = "proveedor" }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const blank = {
    razon_social: "",
    nombre_comercial: "",
    tipo_rif: "J",
    rif: "",
    tipo: defaultTipo as string,
    email: "",
    telefono: "",
    direccion_fiscal: "",
  };
  const [form, setForm] = useState(blank);
  const [existing, setExisting] = useState<Tercero | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto-detect existing by tipo_rif + rif and autofill
  useEffect(() => {
    if (!open) return;
    const rif = form.rif.trim();
    if (!rif) { setExisting(null); return; }
    const match = terceros.find(
      (t) => t.tipo_rif === form.tipo_rif && t.rif.replace(/\D/g, "") === rif.replace(/\D/g, "")
    );
    if (match) {
      setExisting(match);
      setForm((f) => ({
        ...f,
        razon_social: match.razon_social,
        nombre_comercial: match.nombre_comercial ?? "",
        tipo: match.tipo,
        email: match.email ?? "",
        telefono: match.telefono ?? "",
        direccion_fiscal: match.direccion_fiscal ?? "",
      }));
    } else {
      setExisting(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.rif, form.tipo_rif, open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (existing) {
      onChange(existing.id);
      toast.success(`Proveedor existente seleccionado: ${existing.razon_social}`);
      setOpen(false);
      setForm(blank);
      setExisting(null);
      return;
    }
    setBusy(true);
    const { data: created, error } = await supabase.from("terceros").insert(form as any).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (created) await logAudit("terceros", "INSERT", created.id, null, created);
    toast.success("Proveedor creado");
    await qc.invalidateQueries({ queryKey: ["terceros-list"] });
    await qc.invalidateQueries({ queryKey: ["proveedores"] });
    if (created) onChange(created.id);
    setOpen(false);
    setForm(blank);
    setExisting(null);
  };

  return (
    <div>
      <div className="flex items-end justify-between">
        <Label>{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-primary"
          onClick={() => setOpen(true)}
        >
          <Plus className="h-3 w-3 mr-1" /> Nuevo
        </Button>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {terceros.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.tipo_rif}-{t.rif} · {t.razon_social}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo proveedor</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Tipo RIF</Label>
                <Select value={form.tipo_rif} onValueChange={(v) => setForm({ ...form, tipo_rif: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["J","V","E","G"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>RIF</Label>
                <Input required value={form.rif} onChange={(e) => setForm({ ...form, rif: e.target.value })} placeholder="12345678-9" />
              </div>
            </div>
            {existing && (
              <div className="rounded-md bg-primary/10 border border-primary/30 p-2 text-xs">
                Ya existe un proveedor con este RIF: <span className="font-semibold">{existing.razon_social}</span>.
                Al guardar se seleccionará el existente.
              </div>
            )}
            <div>
              <Label>Razón social</Label>
              <Input required value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} disabled={!!existing} />
            </div>
            <div>
              <Label>Nombre comercial</Label>
              <Input value={form.nombre_comercial} onChange={(e) => setForm({ ...form, nombre_comercial: e.target.value })} disabled={!!existing} />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })} disabled={!!existing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["cliente","proveedor","ambos"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!existing} /></div>
              <div><Label>Teléfono</Label><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} disabled={!!existing} /></div>
            </div>
            <div>
              <Label>Dirección fiscal</Label>
              <Input value={form.direccion_fiscal} onChange={(e) => setForm({ ...form, direccion_fiscal: e.target.value })} disabled={!!existing} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {existing ? "Usar proveedor existente" : busy ? "Guardando…" : "Crear proveedor"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
