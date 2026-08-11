import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { CENTROS } from "@/lib/account-helpers";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { fetchAllRows } from "@/lib/fetch-all";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/standby")({
  component: StandbyPage,
  head: () => ({
    meta: [
      { title: "Transacciones en Standby | Yvbocu Contabilidad" },
      { name: "description", content: "Transacciones apartadas temporalmente: restáuralas o elimínalas de forma definitiva." },
      { property: "og:title", content: "Transacciones en Standby" },
      { property: "og:description", content: "Papelera reversible de transacciones contables." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Pend = { rows: any[]; relacionadas: string[]; accion: "restaurar" | "eliminar" };

function StandbyPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [centros, setCentros] = useState<string[]>([]);
  const [cuentasSel, setCuentasSel] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pend, setPend] = useState<Pend | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["transacciones-standby"],
    queryFn: async () =>
      await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id,numero,fecha,centro_costo,cuenta_codigo,numero_factura,referencia,monto_bs,monto_base_bs,iva_bs,tasa_bcv,tasa_paralela,monto_usd,metodo_pago,modo,notas,created_by,grupo_transaccion_id,tercero_id,standby_at")
          .eq("standby", true)
          .order("standby_at", { ascending: false })
          .range(from, to)
      ),
  });

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-all-list"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo,orden").order("orden");
      return data ?? [];
    },
  });
  const cuentaNombre = useMemo(() => {
    const m: Record<string, string> = {};
    (cuentas ?? []).forEach((c: any) => { m[c.codigo] = c.nombre; });
    return m;
  }, [cuentas]);
  const cuentasByGrupo = useMemo(() => {
    const g: Record<string, any[]> = {};
    (cuentas ?? []).forEach((c: any) => { (g[c.grupo || "Otros"] ||= []).push(c); });
    return g;
  }, [cuentas]);

  const { data: terceros } = useQuery({
    queryKey: ["terceros-lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("id,razon_social");
      return data ?? [];
    },
  });
  const terceroById = useMemo(() => {
    const m: Record<string, any> = {};
    (terceros ?? []).forEach((t: any) => { m[t.id] = t; });
    return m;
  }, [terceros]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (data ?? []).filter((t: any) => {
      if (centros.length && !centros.includes(t.centro_costo)) return false;
      if (cuentasSel.length && !cuentasSel.includes(t.cuenta_codigo)) return false;
      if (!q) return true;
      const ter = t.tercero_id ? terceroById[t.tercero_id]?.razon_social ?? "" : "";
      return [
        t.numero, t.fecha, t.cuenta_codigo, cuentaNombre[t.cuenta_codigo], t.centro_costo,
        t.numero_factura, t.referencia, t.notas, ter,
      ].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [data, busca, centros, cuentasSel, cuentaNombre, terceroById]);

  const totalUsd = useMemo(
    () => filtradas.reduce((s: number, t: any) => s + (Number(t.monto_usd) || 0), 0),
    [filtradas]
  );

  const effPageSize = pageSize === "all" ? Math.max(filtradas.length, 1) : pageSize;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filtradas.length / effPageSize));
  const paginadas = useMemo(
    () => (pageSize === "all" ? filtradas : filtradas.slice(page * effPageSize, (page + 1) * effPageSize)),
    [filtradas, page, pageSize, effPageSize]
  );

  const toggleSel = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pedir = async (rows: any[], accion: "restaurar" | "eliminar") => {
    if (!rows.length) return;
    const { contarRelacionadas } = await import("@/lib/standby");
    const { relacionadasIds } = await contarRelacionadas(rows);
    setPend({ rows, relacionadas: relacionadasIds, accion });
  };

  const ejecutar = async (incluirGrupo: boolean) => {
    if (!pend) return;
    const ids = incluirGrupo ? [...pend.rows.map((r) => r.id), ...pend.relacionadas] : pend.rows.map((r) => r.id);
    setBusy(true);
    try {
      if (pend.accion === "restaurar") {
        const { restaurarDeStandby } = await import("@/lib/standby");
        const res = await restaurarDeStandby(ids);
        if (!res.ok) throw new Error(res.error);
        toast.success(`${ids.length} transacción(es) restaurada(s)`);
      } else {
        const { analizarBorradoTransaccion, ejecutarBorradoTransaccion } = await import("@/lib/eliminar-transaccion");
        const rows = (data ?? []).filter((t: any) => ids.includes(t.id));
        const objetivos = rows.length ? rows : pend.rows;
        let ok = 0;
        const errores: string[] = [];
        for (const t of objetivos) {
          const plan = await analizarBorradoTransaccion(t);
          if (plan.bloqueoMesCerrado) { errores.push(`${t.fecha}: mes cerrado`); continue; }
          if (plan.bloqueoAnticipoAplicado) { errores.push(plan.bloqueoAnticipoAplicado); continue; }
          const res = await ejecutarBorradoTransaccion(plan);
          if (!res.ok) { errores.push(res.error ?? "error"); continue; }
          ok += plan.transacciones.length;
        }
        if (ok) toast.success(`${ok} transacción(es) eliminada(s) permanentemente`);
        if (errores.length) toast.error(`Fallaron ${errores.length}: ${errores.slice(0, 2).join(" · ")}`);
      }
      setSelected(new Set());
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setBusy(false);
      setPend(null);
    }
  };

  const seleccionadas = filtradas.filter((t: any) => selected.has(t.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transacciones en Standby</h1>
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Cargando…"
            : `${filtradas.length.toLocaleString()} transacciones en standby · Monto total: ${fmtUsd(totalUsd)} USD paralelo`}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label>Búsqueda</Label>
            <Input
              placeholder="Busca en cuenta, tercero, factura, notas, referencia…"
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setPage(0); }}
            />
          </div>
          <div className="flex items-end gap-2">
            <MultiSelectFilter
              label="Centro"
              options={CENTROS.map((c) => ({ value: c, label: c }))}
              selected={centros}
              onChange={(v) => { setCentros(v); setPage(0); }}
            />
            <MultiSelectFilter
              label="Cuenta"
              groupedOptions={Object.entries(cuentasByGrupo).map(([group, items]) => ({
                group,
                items: (items as any[]).map((c) => ({ value: c.codigo, label: `${c.codigo} — ${c.nombre}` })),
              }))}
              selected={cuentasSel}
              onChange={(v) => { setCuentasSel(v); setPage(0); }}
            />

          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Listado</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs">
                <Label className="text-xs whitespace-nowrap">Por página</Label>
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(v === "all" ? "all" : Number(v)); setPage(0); }}>
                  <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="250">250</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="all">Todas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {selected.size > 0 && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => pedir(seleccionadas, "restaurar")}>
                    <RotateCcw className="h-4 w-4 mr-1.5" />
                    Restaurar {selected.size} seleccionadas
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => pedir(seleccionadas, "eliminar")}>
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Eliminar definitivamente seleccionadas
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!isLoading && filtradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay transacciones en standby.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 px-2 w-8">
                      <Checkbox
                        checked={paginadas.length > 0 && paginadas.every((t: any) => selected.has(t.id))}
                        onCheckedChange={(v) =>
                          setSelected((prev) => {
                            const n = new Set(prev);
                            paginadas.forEach((t: any) => (v ? n.add(t.id) : n.delete(t.id)));
                            return n;
                          })
                        }
                      />
                    </th>
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Centro</th>
                    <th className="text-left py-2 px-2">Cuenta</th>
                    <th className="text-left py-2 px-2">Factura</th>
                    <th className="text-left py-2 px-2">Proveedor/Cliente</th>
                    <th className="text-right py-2 px-2">Bs</th>
                    <th className="text-right py-2 px-2">USD paralelo</th>
                    <th className="text-left py-2 px-2">Modo</th>
                    <th className="text-left py-2 px-2">Notas</th>
                    <th className="text-left py-2 px-2">Fecha en standby</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {paginadas.map((t: any) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2">
                        <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSel(t.id)} />
                      </td>
                      <td className="py-2 px-2 mono text-xs text-muted-foreground">{t.numero ?? "—"}</td>
                      <td className="py-2 px-2 mono whitespace-nowrap">{fmtDate(t.fecha)}</td>
                      <td className="py-2 px-2">{t.centro_costo}</td>
                      <td className="py-2 px-2">
                        <div className="mono text-xs">{t.cuenta_codigo}</div>
                        <div className="text-xs text-muted-foreground">{cuentaNombre[t.cuenta_codigo] ?? ""}</div>
                      </td>
                      <td className="py-2 px-2 mono text-xs">{t.numero_factura ?? "—"}</td>
                      <td className="py-2 px-2 text-xs truncate max-w-[200px]">
                        {t.tercero_id ? terceroById[t.tercero_id]?.razon_social ?? "—" : "—"}
                      </td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(Number(t.monto_bs) || 0)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(Number(t.monto_usd) || 0)}</td>
                      <td className="py-2 px-2">
                        {t.modo === "off_balance"
                          ? <Badge variant="outline" className="text-[10px]">off</Badge>
                          : <Badge className="text-[10px]">on</Badge>}
                      </td>
                      <td className="py-2 px-2 text-xs truncate max-w-[220px]" title={t.notas ?? ""}>{t.notas ?? "—"}</td>
                      <td className="py-2 px-2 text-xs mono whitespace-nowrap">
                        {t.standby_at ? new Date(t.standby_at).toLocaleString("es-VE") : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Restaurar" onClick={() => pedir([t], "restaurar")}>
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Eliminar definitivamente"
                            onClick={() => pedir([t], "eliminar")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pageSize !== "all" && totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    Mostrando {page * effPageSize + 1}–{Math.min((page + 1) * effPageSize, filtradas.length)} de {filtradas.length}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => setPage(0)} disabled={page === 0}>«</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>‹</Button>
                    <span className="text-xs mx-2">Pág. {page + 1} / {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>›</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!pend} onOpenChange={(o) => { if (!o) setPend(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pend?.accion === "restaurar" ? "Restaurar transacciones" : "Eliminar definitivamente"}
            </DialogTitle>
            <DialogDescription>
              {pend?.accion === "eliminar" && (
                <span className="block font-medium text-destructive mb-2">
                  Esta acción es irreversible. ¿Confirmas que deseas eliminar permanentemente esta transacción?
                </span>
              )}
              {pend && pend.relacionadas.length > 0
                ? `Esta transacción tiene ${pend.relacionadas.length} transacciones relacionadas. ¿Deseas ${pend.accion === "restaurar" ? "restaurarlas" : "eliminarlas"} todas?`
                : pend?.accion === "restaurar"
                  ? "La transacción volverá al listado principal y a todos los cálculos."
                  : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPend(null)} disabled={busy}>Cancelar</Button>
            {pend && pend.relacionadas.length > 0 && (
              <Button variant="secondary" disabled={busy} onClick={() => ejecutar(false)}>Solo esta</Button>
            )}
            <Button
              variant={pend?.accion === "eliminar" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => ejecutar(true)}
            >
              {pend && pend.relacionadas.length > 0 ? "Todas" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
