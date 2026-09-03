import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Inbox, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DeleteButton } from "@/components/delete-button";
import { logAudit } from "@/lib/audit";

const ORIGEN_LABEL: Record<string, string> = {
  manual: "Manual",
  xetux: "Xetux (Compras)",
  movimientos_bancarios: "Movimientos bancarios",
  desconocido: "—",
};

export const Route = createFileRoute("/_authenticated/proveedores/")({
  component: ProveedoresPage,
  head: () => ({
    meta: [
      { title: "Proveedores | Yvbocu Contabilidad" },
      { name: "description", content: "Catálogo de proveedores y acceso al tablero de conciliación de facturas y pagos." },
      { property: "og:title", content: "Proveedores | Yvbocu Contabilidad" },
      { property: "og:description", content: "Catálogo de proveedores y acceso al tablero de conciliación de facturas y pagos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});


function ProveedoresPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [editandoNombreId, setEditandoNombreId] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const guardarNombreInline = async (id: string) => {
    if (!nombreEdit.trim()) return toast.error("Ingresa un nombre");
    const { error } = await supabase.from("terceros").update({ razon_social: nombreEdit.trim() } as any).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Nombre actualizado");
    setEditandoNombreId(null);
    qc.invalidateQueries({ queryKey: ["proveedores"] });
  };
  // Proveedores sin RIF — se resaltan en el listado y se pueden completar
  // ahí mismo, sin abrir un formulario aparte.
  const [editandoRifId, setEditandoRifId] = useState<string | null>(null);
  const [rifEdit, setRifEdit] = useState({ tipo_rif: "J", rif: "" });
  const guardarRifInline = async (id: string) => {
    if (!rifEdit.rif.trim()) return toast.error("Ingresa el RIF");
    const { error } = await supabase
      .from("terceros")
      .update({ tipo_rif: rifEdit.tipo_rif, rif: rifEdit.rif.trim() } as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("RIF actualizado");
    setEditandoRifId(null);
    qc.invalidateQueries({ queryKey: ["proveedores"] });
  };
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
    const { data: created, error } = await supabase.from("terceros").insert({ ...form, origen_registro: "manual" } as any).select().single();
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
      if (p.estado_registro === "candidato") {
        // Un candidato es "barato" de deshacer: no representa historial
        // contable formal todavía, así que se libera y se borra.
        if (!window.confirm(`Este candidato tiene ${count} movimiento(s) vinculado(s). ¿Liberarlos (quedarían sin proveedor) y eliminar el candidato?`)) {
          throw new Error("blocked");
        }
        await supabase.from("transacciones").update({ tercero_id: null } as any).eq("tercero_id", p.id);
        await supabase.from("cuentas_por_pagar").update({ tercero_id: null } as any).eq("tercero_id", p.id);
      } else {
        toast.error(`Proveedor con ${count} movimientos — no se puede eliminar`);
        throw new Error("blocked");
      }
    }
    const { error } = await supabase.from("terceros").delete().eq("id", p.id);
    if (error) throw error;
    await logAudit("terceros", "DELETE", p.id, p, null);
    toast.success(count && count > 0 ? `Candidato eliminado, ${count} movimiento(s) liberado(s)` : "Proveedor eliminado");
    qc.invalidateQueries({ queryKey: ["proveedores"] });
  };

  const filtrados = (data ?? []).filter((t: any) =>
    !busca ||
    t.razon_social?.toLowerCase().includes(busca.toLowerCase()) ||
    t.rif?.includes(busca)
  );
  const sinRifCount = (data ?? []).filter((t: any) => !t.rif).length;

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
            <CardTitle className="text-base flex items-center gap-2">
              Listado
              {sinRifCount > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-600/40 font-normal">
                  {sinRifCount} sin RIF
                </Badge>
              )}
            </CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link to="/proveedores/$id" params={{ id: "sin-proveedor" }}>
                <Inbox className="h-4 w-4 mr-1" />Sin proveedor
              </Link>
            </Button>
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
                    <th className="text-left py-2 px-2">Origen</th>
                    <th className="text-left py-2 px-2">Email</th>
                    <th className="text-left py-2 px-2">Tel.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((t: any) => (
                    <tr key={t.id} className={`border-b last:border-0 ${t.factura_en_usd_paralelo ? "bg-red-500/10" : ""}`}>
                      <td className="py-2 px-2">
                        {editandoNombreId === t.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              autoFocus
                              value={nombreEdit}
                              onChange={(e) => setNombreEdit(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") guardarNombreInline(t.id); if (e.key === "Escape") setEditandoNombreId(null); }}
                              className="h-7 w-56"
                            />
                            <Button size="sm" className="h-7 px-2" onClick={() => guardarNombreInline(t.id)}>Guardar</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditandoNombreId(null)}>Cancelar</Button>
                          </div>
                        ) : (
                          <>
                            <Link
                              to="/proveedores/$id"
                              params={{ id: t.id }}
                              className="text-primary hover:underline"
                            >
                              {t.razon_social}
                            </Link>
                            {t.factura_en_usd_paralelo && (
                              <Badge variant="outline" className="ml-2 text-[10px] text-red-600 border-red-600/40">
                                Facturas Xetux en USD paralelo (no BCV)
                              </Badge>
                            )}
                            {t.estado_registro === "candidato" && (
                              <>
                                <Badge variant="outline" className="ml-2 text-[10px] text-amber-600 border-amber-600/40">
                                  Pendiente de verificar
                                </Badge>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 ml-1"
                                  title="Editar nombre"
                                  onClick={() => { setEditandoNombreId(t.id); setNombreEdit(t.razon_social ?? ""); }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </>
                            )}

                          </>
                        )}
                      </td>
                      <td className="py-2 px-2 mono text-xs">
                        {editandoRifId === t.id ? (
                          <div className="flex items-center gap-1">
                            <Select value={rifEdit.tipo_rif} onValueChange={(v) => setRifEdit((s) => ({ ...s, tipo_rif: v }))}>
                              <SelectTrigger className="h-7 w-14"><SelectValue /></SelectTrigger>
                              <SelectContent>{["J","V","E","G"].map((tv) => <SelectItem key={tv} value={tv}>{tv}</SelectItem>)}</SelectContent>
                            </Select>
                            <Input
                              autoFocus
                              value={rifEdit.rif}
                              onChange={(e) => setRifEdit((s) => ({ ...s, rif: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") guardarRifInline(t.id); if (e.key === "Escape") setEditandoRifId(null); }}
                              placeholder="RIF"
                              className="h-7 w-24"
                            />
                            <Button size="sm" className="h-7 px-2" onClick={() => guardarRifInline(t.id)}>Guardar</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditandoRifId(null)}>Cancelar</Button>
                          </div>
                        ) : !t.rif ? (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-amber-600 border-amber-600/40">Sin RIF</Badge>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Agregar RIF"
                              onClick={() => { setEditandoRifId(t.id); setRifEdit({ tipo_rif: t.tipo_rif || "J", rif: "" }); }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          `${t.tipo_rif}-${t.rif}`
                        )}
                      </td>
                      <td className="py-2 px-2">{t.tipo}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{ORIGEN_LABEL[t.origen_registro] ?? "—"}</td>
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
