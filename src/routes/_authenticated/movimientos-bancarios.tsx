import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Download, Check, X } from "lucide-react";
import { exportTableToExcel } from "@/lib/excel-table";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { CENTROS } from "@/lib/account-helpers";
import {
  bancoDeReferencia,
  refBancaria,
  normalizarFactura,
  parearMovimiento,
  esFacturaDeCompra,
  ESTADO_LABEL,
  type EstadoConciliacion,
  type FacturaRef,
} from "@/lib/conciliacion-matching";


export const Route = createFileRoute("/_authenticated/movimientos-bancarios")({
  component: MovimientosBancariosPage,
  head: () => ({
    meta: [
      { title: "Movimientos bancarios | Yvbocu Contabilidad" },
      { name: "description", content: "Conciliación de movimientos bancarios importados contra las facturas registradas." },
      { property: "og:title", content: "Movimientos bancarios | Yvbocu Contabilidad" },
      { property: "og:description", content: "Conciliación de movimientos bancarios importados contra las facturas registradas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const usdBcvDe = (t: any) => (Number(t.tasa_bcv) > 0 ? Number(t.monto_bs) / Number(t.tasa_bcv) : Number(t.monto_usd ?? 0));

function MovimientosBancariosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [banco, setBanco] = useState("todos");
  const [estadoF, setEstadoF] = useState("todos");
  const [origenF, setOrigenF] = useState("todos");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [texto, setTexto] = useState("");
  const [cuentasSel, setCuentasSel] = useState<string[]>([]);
  const [centrosSel, setCentrosSel] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [page, setPage] = useState(0);

  const { data: movimientos, isLoading } = useQuery({
    queryKey: ["mov-bancarios"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("*")
          .like("referencia", "BANK:%")
          .order("fecha", { ascending: false })
          .range(from, to),
      );
    },
  });

  const { data: facturas } = useQuery({
    queryKey: ["facturas-compra-para-conciliar"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const rows = await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id,fecha,numero_factura,monto_bs,cuenta_codigo,notas,tercero_id")
          .not("numero_factura", "is", null)
          .range(from, to),
      );
      const compras = (rows as any[]).filter((r) => esFacturaDeCompra(r.cuenta_codigo));
      const ids = [...new Set(compras.map((r) => r.tercero_id).filter(Boolean))];
      const nombreById = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase
          .from("terceros")
          .select("id,razon_social,nombre_comercial")
          .in("id", ids.slice(i, i + 200) as string[]);
        (data ?? []).forEach((t: any) => nombreById.set(t.id, t.nombre_comercial || t.razon_social));
      }
      return compras.map((r) => ({ ...r, proveedor: r.tercero_id ? nombreById.get(r.tercero_id) ?? null : null }));
    },
  });


  const { data: vinculos } = useQuery({
    queryKey: ["conciliacion-bancaria"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("conciliacion_bancaria").select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: cuentas } = useQuery({
    queryKey: ["plan-cuentas-min-grupo"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("codigo,nombre,grupo,orden").order("orden");
      return data ?? [];
    },
  });
  const nombreCuenta = (c: string) => cuentas?.find((x: any) => x.codigo === c)?.nombre ?? c;

  const cuentasByGrupo = useMemo(() => {
    const g: Record<string, any[]> = {};
    (cuentas ?? []).forEach((c: any) => { (g[c.grupo || "Otros"] ||= []).push(c); });
    return g;
  }, [cuentas]);

  const indice = useMemo(() => {
    const lista: FacturaRef[] = (facturas ?? []).map((f: any) => ({
      id: f.id,
      fecha: f.fecha,
      numero_factura: f.numero_factura,
      monto_bs: Number(f.monto_bs),
      cuenta_codigo: f.cuenta_codigo,
      proveedor: f.proveedor ?? null,
    }));

    const porNumero = new Map<string, FacturaRef[]>();
    for (const f of lista) {
      const k = normalizarFactura(f.numero_factura);
      if (!k) continue;
      const arr = porNumero.get(k) ?? [];
      arr.push(f);
      porNumero.set(k, arr);
    }
    return { lista, porNumero };
  }, [facturas]);

  const vinculosPorMov = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const v of vinculos ?? []) {
      const arr = m.get(v.transaccion_bancaria_id) ?? [];
      arr.push(v);
      m.set(v.transaccion_bancaria_id, arr);
    }
    return m;
  }, [vinculos]);

  const filas = useMemo(() => {
    return (movimientos ?? []).map((mov: any) => {
      const auto = parearMovimiento(mov, indice.porNumero, indice.lista);
      const vs = vinculosPorMov.get(mov.id) ?? [];
      const pareados = vs.filter((v) => v.estado === "pareado" && v.transaccion_factura_id);
      const rechazado = vs.some((v) => v.estado === "rechazado");
      let estado: EstadoConciliacion = auto.estado;
      let facturas = auto.facturas;
      let motivo = auto.motivo;
      let origen: "auto" | "manual" | null = null;

      if (pareados.length) {
        estado = "pareado";
        facturas = pareados
          .map((v) => indice.lista.find((f) => f.id === v.transaccion_factura_id))
          .filter(Boolean) as FacturaRef[];
        origen = pareados.every((v) => v.origen === "auto") ? "auto" : "manual";
        motivo = origen === "auto" ? "Confirmado (sugerencia automática)" : "Pareado manualmente";
      } else if (rechazado) {
        estado = auto.estado === "posible" ? "sin_pareo" : auto.estado;
        facturas = [];
        motivo = "Sugerencia rechazada";
      }

      const total = facturas.reduce((s, f) => s + Math.abs(Number(f.monto_bs) || 0), 0);
      return {
        mov,
        estado,
        facturas,
        factura: facturas[0],
        total,
        motivo,
        origen,
        sugeridas: auto.facturas,
        confirmable: (auto.estado === "posible" || auto.estado === "pareado") && !vs.length && auto.facturas.length > 0,
      };
    });
  }, [movimientos, indice, vinculosPorMov]);

  const bancos = useMemo(
    () => [...new Set(filas.map((f) => bancoDeReferencia(f.mov.referencia)))].sort(),
    [filas],
  );

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return filas.filter((f) => {
      if (banco !== "todos" && bancoDeReferencia(f.mov.referencia) !== banco) return false;
      if (estadoF !== "todos" && f.estado !== estadoF) return false;
      if (origenF !== "todos" && (f.origen ?? "ninguno") !== origenF) return false;
      if (cuentasSel.length && !cuentasSel.includes(f.mov.cuenta_codigo)) return false;
      if (centrosSel.length && !centrosSel.includes(f.mov.centro_costo)) return false;
      if (desde && f.mov.fecha < desde) return false;
      if (hasta && f.mov.fecha > hasta) return false;
      if (q && !String(f.mov.notas ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filas, banco, estadoF, origenF, desde, hasta, texto, cuentasSel, centrosSel]);

  useEffect(() => { setPage(0); }, [banco, estadoF, origenF, desde, hasta, texto, cuentasSel, centrosSel, pageSize]);

  const effectivePageSize = pageSize === "all" ? Math.max(filtradas.length, 1) : pageSize;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filtradas.length / effectivePageSize));
  const pagina = useMemo(
    () => (pageSize === "all" ? filtradas : filtradas.slice(page * effectivePageSize, (page + 1) * effectivePageSize)),
    [filtradas, page, pageSize, effectivePageSize],
  );

  const resumen = useMemo(() => {
    const c = { total: filtradas.length, pareado: 0, posible: 0, no_aplica: 0, sin_pareo: 0 } as any;
    for (const f of filtradas) c[f.estado]++;
    return c;
  }, [filtradas]);

  const guardarVinculo = async (
    movId: string,
    facturaIds: string[],
    estado: "pareado" | "rechazado",
    origen: "auto" | "manual",
  ) => {
    const del = await (supabase.from as any)("conciliacion_bancaria").delete().eq("transaccion_bancaria_id", movId);
    if (del.error) { toast.error(del.error.message); return; }
    const rows = (estado === "pareado" ? facturaIds : [null]).map((fid) => ({
      transaccion_bancaria_id: movId,
      transaccion_factura_id: fid,
      estado,
      origen,
      confirmado_por: user?.id ?? null,
      confirmado_en: new Date().toISOString(),
    }));
    const { error } = await (supabase.from as any)("conciliacion_bancaria").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success(estado === "pareado" ? "Pareo confirmado" : "Sugerencia rechazada");
    qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] });
  };


  const exportar = async () => {
    await exportTableToExcel({
      filename: `movimientos-bancarios-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: "Movimientos bancarios",
      columns: [
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Banco", key: "banco", width: 20 },
        { header: "Referencia bancaria", key: "ref", width: 22 },
        { header: "Monto Bs", key: "bs", width: 16, fmt: "bs" },
        { header: "Monto USD (BCV)", key: "usdBcv", width: 16, fmt: "usd" },
        { header: "Monto USD (paralela)", key: "usdPar", width: 18, fmt: "usd" },
        { header: "Cuenta asignada", key: "cuenta", width: 32 },
        { header: "Centro de costo", key: "centro", width: 14 },
        { header: "Notas/memo", key: "notas", width: 50 },
        { header: "Estado de conciliación", key: "estado", width: 20 },
        { header: "Facturas pareadas", key: "factura", width: 26 },
        { header: "Total pareado Bs", key: "totalPareado", width: 16, fmt: "bs" },
        { header: "Proveedor factura", key: "provFactura", width: 28 },
        { header: "Origen del pareo", key: "origen", width: 16 },
        { header: "Motivo del pareo", key: "motivo", width: 34 },

      ],
      rows: filtradas.map((f) => ({
        fecha: f.mov.fecha,
        banco: bancoDeReferencia(f.mov.referencia),
        ref: refBancaria(f.mov.referencia),
        bs: Number(f.mov.monto_bs),
        usdBcv: usdBcvDe(f.mov),
        usdPar: Number(f.mov.monto_usd ?? 0),
        cuenta: `${f.mov.cuenta_codigo} · ${nombreCuenta(f.mov.cuenta_codigo)}`,
        centro: f.mov.centro_costo,
        notas: f.mov.notas ?? "",
        estado: ESTADO_LABEL[f.estado],
        factura: f.facturas.map((x) => x.numero_factura).filter(Boolean).join(", "),
        totalPareado: f.facturas.length ? f.total : 0,
        provFactura: f.factura?.proveedor ?? "",
        origen: f.origen === "auto" ? "Automático" : f.origen === "manual" ? "Manual" : "—",
        motivo: f.motivo,

      })),

    });
  };

  const [exportando, setExportando] = useState(false);
  const onExportar = async () => {
    if (!filtradas.length) { toast.error("No hay movimientos que exportar con los filtros actuales."); return; }
    setExportando(true);
    try {
      await exportar();
      toast.success(`Excel generado (${filtradas.length} movimientos)`);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo generar el Excel");
    } finally {
      setExportando(false);
    }
  };

  const badgeEstado = (e: EstadoConciliacion) => {
    if (e === "pareado") return <Badge className="bg-green-600">Pareado</Badge>;
    if (e === "posible") return <Badge className="bg-orange-500">Posible pareo</Badge>;
    if (e === "no_aplica") return <Badge variant="secondary">No aplica</Badge>;
    return <Badge variant="destructive">Sin pareo</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimientos bancarios</h1>
          <p className="text-sm text-muted-foreground">Conciliación de movimientos importados del banco contra las facturas registradas</p>
        </div>
        <Button onClick={onExportar} disabled={exportando}>
          <Download className="h-4 w-4 mr-2" /> {exportando ? "Generando…" : "Exportar a Excel"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Kpi label="Total movimientos" value={resumen.total} />
        <Kpi label="Pareados" value={resumen.pareado} tone="text-green-600" />
        <Kpi label="Posible pareo" value={resumen.posible} tone="text-orange-600" />
        <Kpi label="No aplica" value={resumen.no_aplica} tone="text-muted-foreground" />
        <Kpi label="Sin pareo" value={resumen.sin_pareo} tone="text-destructive" highlight={resumen.sin_pareo > 0} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Select value={banco} onValueChange={setBanco}>
            <SelectTrigger><SelectValue placeholder="Banco" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los bancos</SelectItem>
              {bancos.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={estadoF} onValueChange={setEstadoF}>
            <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="pareado">Pareado</SelectItem>
              <SelectItem value="posible">Posible pareo</SelectItem>
              <SelectItem value="no_aplica">No aplica</SelectItem>
              <SelectItem value="sin_pareo">Sin pareo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={origenF} onValueChange={setOrigenF}>
            <SelectTrigger><SelectValue placeholder="Origen del pareo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todo origen de pareo</SelectItem>
              <SelectItem value="auto">Pareo automático</SelectItem>
              <SelectItem value="manual">Pareo manual</SelectItem>
              <SelectItem value="ninguno">Sin pareo confirmado</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          <Input placeholder="Buscar en notas/memo…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 flex-wrap">
          <CardTitle className="text-base">Movimientos ({filtradas.length})</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Mostrar</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(v === "all" ? "all" : Number(v))}>
              <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="250">250</SelectItem>
                <SelectItem value="500">500</SelectItem>
                <SelectItem value="all">Todas</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={onExportar} disabled={exportando}>
              <Download className="h-4 w-4 mr-2" /> Exportar a Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : filtradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay movimientos bancarios con estos filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Banco</th>
                    <th className="text-right py-2 px-2">Monto Bs</th>
                    <th className="text-right py-2 px-2">USD (BCV)</th>
                    <th className="text-left py-2 px-2">
                      Cuenta asignada
                      <MultiSelectFilter
                        label="Cuenta contable"
                        groupedOptions={Object.entries(cuentasByGrupo).map(([grupo, items]) => ({
                          group: grupo,
                          items: items.map((c: any) => ({ value: c.codigo, label: `${c.codigo} · ${c.nombre}` })),
                        }))}
                        selected={cuentasSel}
                        onChange={setCuentasSel}
                      />
                    </th>
                    <th className="text-left py-2 px-2">
                      Centro
                      <MultiSelectFilter
                        label="Centro de costo"
                        options={CENTROS.map((c) => ({ value: c, label: c }))}
                        selected={centrosSel}
                        onChange={setCentrosSel}
                      />
                    </th>
                    <th className="text-left py-2 px-2">Notas / memo</th>
                    <th className="text-left py-2 px-2">Conciliación</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.map((f) => (
                    <tr key={f.mov.id} className="border-b last:border-0 align-top">
                      <td className="py-2 px-2 mono whitespace-nowrap">{fmtDate(f.mov.fecha)}</td>
                      <td className="py-2 px-2">{bancoDeReferencia(f.mov.referencia)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtBs(f.mov.monto_bs)}</td>
                      <td className="py-2 px-2 text-right mono">{fmtUsd(usdBcvDe(f.mov))}</td>
                      <td className="py-2 px-2 text-xs">{f.mov.cuenta_codigo} · {nombreCuenta(f.mov.cuenta_codigo)}</td>
                      <td className="py-2 px-2 text-xs">{f.mov.centro_costo}</td>
                      <td className="py-2 px-2 text-xs max-w-[320px]">{f.mov.notas ?? "—"}</td>
                      <td className="py-2 px-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            {badgeEstado(f.estado)}
                            {f.origen && (
                              <Badge variant="outline" className="text-[10px]">
                                {f.origen === "auto" ? "Automático" : "Manual"}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">{f.motivo}</span>
                          {(f.facturas ?? []).map((fa) => (
                            <span key={fa.id} className="text-[11px] mono">
                              Fact {fa.numero_factura} · {fa.proveedor ?? "—"} · {fmtDate(fa.fecha)} · {fmtBs(fa.monto_bs)}
                            </span>
                          ))}
                          {f.facturas.length > 1 && (
                            <span className="text-[11px] font-medium">Total pareado: {fmtBs(f.total)}</span>
                          )}
                          {f.confirmable && f.sugeridas.length > 0 && (
                            <div className="flex gap-1 pt-1">
                              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => guardarVinculo(f.mov.id, f.sugeridas.map((s) => s.id), "pareado", "auto")}>
                                <Check className="h-3 w-3 mr-1" /> Confirmar{f.sugeridas.length > 1 ? ` (${f.sugeridas.length})` : ""}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => guardarVinculo(f.mov.id, [], "rechazado", "manual")}>
                                <X className="h-3 w-3 mr-1" /> Rechazar
                              </Button>
                            </div>
                          )}
                        </div>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
              {pageSize !== "all" && totalPages > 1 && (
                <div className="flex items-center justify-between pt-3">
                  <span className="text-xs text-muted-foreground">
                    Página {page + 1} de {totalPages} · {filtradas.length} movimientos
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
                    <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Siguiente</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone, highlight }: { label: string; value: number; tone?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-destructive" : undefined}>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${tone ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
