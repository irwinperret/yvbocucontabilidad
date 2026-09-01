import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, ArrowLeftRight, ChevronRight, StickyNote, Plus, Check, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtUsd, fmtDate } from "@/lib/format";
import { pendienteUsdBcv } from "@/lib/cxp-saldo";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/iris/")({
  component: IrisPage,
  head: () => ({
    meta: [
      { title: "Iris — Revisión general | Yvbocu Contabilidad" },
      { name: "description", content: "Revisión administrativa de la conciliación de cada proveedor y de los movimientos bancarios sin proveedor asignado." },
    ],
  }),
});

function IrisPage() {
  // Movimientos "sin proveedor" que todavía no han sido confirmados (sin
  // ningún vínculo manual en conciliacion_bancaria todavía).
  const { data: sinProveedorCount } = useQuery({
    queryKey: ["iris-sin-proveedor-count"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const movs = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id")
          .like("referencia", "BANK:%")
          .neq("standby", true)
          .is("tercero_id", null)
          .range(from, to),
      );
      if (!movs.length) return 0;
      const vinculos = await fetchAllRows<any>(async (from, to) =>
        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_bancaria_id, origen")
          .in("transaccion_bancaria_id", movs.map((m) => m.id))
          .range(from, to),
      );
      const yaConfirmados = new Set(
        vinculos.filter((v: any) => v.origen === "manual").map((v: any) => v.transaccion_bancaria_id),
      );
      return movs.filter((m) => !yaConfirmados.has(m.id)).length;
    },
  });

  // Proveedores con CxP pendiente, ordenados de mayor a menor (USD BCV).
  const { data: proveedores } = useQuery({
    queryKey: ["iris-proveedores-cxp"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const cxps = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("cuentas_por_pagar")
          .select("tercero_id, proveedor, monto_pendiente_usd_bcv, monto_usd, usd_bcv_factura, estado")
          .neq("estado", "pagada")
          .range(from, to),
      );
      const porTercero = new Map<string, { nombre: string; total: number }>();
      for (const c of cxps) {
        if (!c.tercero_id) continue;
        const prev = porTercero.get(c.tercero_id) ?? { nombre: c.proveedor ?? "Proveedor", total: 0 };
        prev.total += pendienteUsdBcv(c);
        porTercero.set(c.tercero_id, prev);
      }
      return Array.from(porTercero, ([tercero_id, v]) => ({ tercero_id, ...v }))
        .filter((p) => p.total > 0.01)
        .sort((a, b) => b.total - a.total);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-purple-600" />
          Iris — Revisión general
        </h1>
        <p className="text-sm text-muted-foreground">
          Revisión administrativa de la conciliación de cada proveedor. Todos los montos en USD BCV.
        </p>
      </div>

      <PendientesCard />

      <Link to="/iris/movimientos-sin-proveedor">
        <Card className="hover:border-primary/60 hover:bg-muted/30 transition-colors cursor-pointer">
          <CardContent className="pt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-medium">Movimientos bancarios sin proveedor</div>
                <p className="text-xs text-muted-foreground">Confirmar que son efectivamente Gasto Stand-Alone</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={sinProveedorCount ? "destructive" : "secondary"}>
                {sinProveedorCount ?? "…"} sin confirmar
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Proveedores — de mayor a menor CxP pendiente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {(proveedores ?? []).map((p) => (
              <Link
                key={p.tercero_id}
                to="/proveedores/$id"
                params={{ id: p.tercero_id }}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <span className="font-medium">{p.nombre}</span>
                <div className="flex items-center gap-2">
                  <span className="mono text-sm font-semibold">{fmtUsd(p.total)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
            {proveedores && proveedores.length === 0 && (
              <p className="text-sm text-muted-foreground px-4 py-6 text-center">No hay proveedores con CxP pendiente.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


type Pendiente = {
  id: string;
  texto: string;
  estado: "pendiente" | "resuelta";
  created_at: string;
  created_by: string | null;
  resuelta_at: string | null;
};

function PendientesCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [resolviendoId, setResolviendoId] = useState<string | null>(null);
  const [verResueltas, setVerResueltas] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  const { data: pendientes, isLoading } = useQuery({
    queryKey: ["iris-pendientes"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("iris_pendientes")
        .select("id, texto, estado, created_at, created_by, resuelta_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Pendiente[];
    },
  });

  const abiertas = (pendientes ?? []).filter((p) => p.estado === "pendiente");
  const resueltas = (pendientes ?? []).filter((p) => p.estado === "resuelta");

  const agregar = async () => {
    const t = texto.trim();
    if (!t || !user) return;
    setGuardando(true);
    const { error } = await (supabase.from as any)("iris_pendientes").insert({
      texto: t,
      estado: "pendiente",
      created_by: user.id,
    });
    setGuardando(false);
    if (error) return toast.error(error.message || "No se pudo guardar la nota");
    setTexto("");
    toast.success("Nota agregada");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
  };

  const resolver = async (id: string) => {
    setResolviendoId(id);
    const { error } = await (supabase.from as any)("iris_pendientes")
      .update({ estado: "resuelta", resuelta_at: new Date().toISOString(), resuelta_by: user?.id ?? null })
      .eq("id", id);
    setResolviendoId(null);
    if (error) return toast.error(error.message || "No se pudo marcar como resuelta");
    toast.success("Marcada como resuelta");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
  };

  // Editar y borrar están limitados (por RLS en la base) al autor de la
  // nota — cada quien solo puede tocar lo que escribió. Marcar como
  // resuelta sigue abierto a cualquiera del equipo, como ya era.
  const iniciarEdicion = (p: Pendiente) => {
    setEditandoId(p.id);
    setEditTexto(p.texto);
  };

  const cancelarEdicion = () => {
    setEditandoId(null);
    setEditTexto("");
  };

  const guardarEdicion = async (id: string) => {
    const t = editTexto.trim();
    if (!t) return toast.error("El texto no puede quedar vacío");
    setGuardandoEdit(true);
    const { error } = await (supabase.from as any)("iris_pendientes").update({ texto: t }).eq("id", id);
    setGuardandoEdit(false);
    if (error) return toast.error(error.message || "No se pudo editar la nota");
    toast.success("Nota editada");
    cancelarEdicion();
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
  };

  const borrar = async (id: string) => {
    if (!confirm("¿Borrar esta nota? No se puede deshacer.")) return;
    setBorrandoId(id);
    const { error } = await (supabase.from as any)("iris_pendientes").delete().eq("id", id);
    setBorrandoId(null);
    if (error) return toast.error(error.message || "No se pudo borrar la nota");
    toast.success("Nota borrada");
    qc.invalidateQueries({ queryKey: ["iris-pendientes"] });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          Pendientes / Notas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Anotar algo para dar seguimiento…"
            className="min-h-[60px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) agregar();
            }}
          />
          <Button onClick={agregar} disabled={guardando || !texto.trim()} className="self-end">
            <Plus className="h-4 w-4 mr-1" />
            Agregar
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : abiertas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay pendientes abiertos.</p>
        ) : (
          <div className="divide-y">
            {abiertas.map((p) => {
              const esAutor = !!user && p.created_by === user.id;
              const enEdicion = editandoId === p.id;
              return (
                <div key={p.id} className="flex items-start justify-between gap-3 py-2">
                  {enEdicion ? (
                    <div className="flex-1 space-y-1.5">
                      <Textarea
                        value={editTexto}
                        onChange={(e) => setEditTexto(e.target.value)}
                        className="min-h-[50px] text-sm"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => guardarEdicion(p.id)} disabled={guardandoEdit || !editTexto.trim()}>
                          {guardandoEdit ? "…" : "Guardar"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelarEdicion} disabled={guardandoEdit}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm">{p.texto}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(p.created_at)}</p>
                    </div>
                  )}
                  {!enEdicion && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {esAutor && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => iniciarEdicion(p)} title="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => borrar(p.id)}
                            disabled={borrandoId === p.id}
                            title="Borrar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="outline" onClick={() => resolver(p.id)} disabled={resolviendoId === p.id}>
                        <Check className="h-3.5 w-3.5 mr-1" />
                        {resolviendoId === p.id ? "…" : "Resuelta"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {resueltas.length > 0 && (
          <div className="pt-2 border-t">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setVerResueltas((v) => !v)}
            >
              {verResueltas ? "Ocultar" : "Ver"} resueltas ({resueltas.length})
            </button>
            {verResueltas && (
              <div className="divide-y mt-2">
                {resueltas.map((p) => {
                  const esAutor = !!user && p.created_by === user.id;
                  const enEdicion = editandoId === p.id;
                  return (
                    <div key={p.id} className="py-2">
                      {enEdicion ? (
                        <div className="space-y-1.5">
                          <Textarea
                            value={editTexto}
                            onChange={(e) => setEditTexto(e.target.value)}
                            className="min-h-[50px] text-sm"
                            autoFocus
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => guardarEdicion(p.id)} disabled={guardandoEdit || !editTexto.trim()}>
                              {guardandoEdit ? "…" : "Guardar"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelarEdicion} disabled={guardandoEdit}>
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-muted-foreground line-through">{p.texto}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Resuelta {p.resuelta_at ? fmtDate(p.resuelta_at) : ""}
                            </p>
                          </div>
                          {esAutor && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button size="sm" variant="ghost" onClick={() => iniciarEdicion(p)} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => borrar(p.id)}
                                disabled={borrandoId === p.id}
                                title="Borrar"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
