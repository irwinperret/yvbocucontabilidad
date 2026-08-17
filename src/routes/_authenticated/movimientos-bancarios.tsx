import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtUsd, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Download, Check, X, RefreshCw, Pencil } from "lucide-react";
import { EditDialog } from "@/components/transaccion-edit-dialog";
import { exportTableToExcel } from "@/lib/excel-table";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CENTROS } from "@/lib/account-helpers";
import { useUsdView, usdVisual } from "@/lib/usd-view-context";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { guardarVinculosConciliacion, marcarEstadoConciliacion, ESTADO_MANUAL_LABEL, ESTADOS_MANUALES, normalizarEstadoManual, type EstadoManual } from "@/lib/conciliacion";
import { PareoManualDialog, quitarPareoManual } from "@/components/pareo-manual-dialog";

import {
  bancoDeReferencia,
  refBancaria,
  normalizarFactura,
  parearMovimiento,
  proveedorDeMemo,
  coberturaPareo,
  recalcularPareos,
  esFacturaDeCompra,
  ESTADO_LABEL,
  type EstadoConciliacion,
  type FacturaRef,
  type TerceroRef,
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
  const { mode: usdMode, label: usdLabel } = useUsdView();

  const [banco, setBanco] = useState("todos");
  const [estadoF, setEstadoF] = useState("todos");
  const [conciliacionF, setConciliacionF] = useState<string[]>([]);
  const [origenF, setOrigenF] = useState("todos");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [texto, setTexto] = useState("");
  const [cuentasSel, setCuentasSel] = useState<string[]>([]);
  const [centrosSel, setCentrosSel] = useState<string[]>([]);
  const [provSel, setProvSel] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [page, setPage] = useState(0);


  const { data: movimientos, isLoading } = useQuery({
    queryKey: ["mov-bancarios"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("*").neq("standby", true)
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
          .select("id,fecha,numero_factura,monto_bs,tasa_bcv,cuenta_codigo,notas,tercero_id").neq("standby", true)
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
      const txIds = compras.map((r) => r.id);
      const cxpByTx = new Map<string, any>();
      for (let i = 0; i < txIds.length; i += 200) {
        const { data } = await supabase
          .from("cuentas_por_pagar")
          .select("transaccion_id,usd_bcv_factura,monto_pendiente_usd_bcv,monto_bs,monto_pendiente_bs,tasa_bcv_factura")
          .in("transaccion_id", txIds.slice(i, i + 200));
        (data ?? []).forEach((c: any) => cxpByTx.set(c.transaccion_id, c));
      }
      return compras.map((r) => ({
        ...r,
        proveedor: r.tercero_id ? nombreById.get(r.tercero_id) ?? null : null,
        cxp: cxpByTx.get(r.id) ?? null,
      }));
    },
  });

  const { data: terceros } = useQuery({
    queryKey: ["terceros-min-conciliacion"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("id,razon_social,nombre_comercial");
      return ((data ?? []) as any[]).map((t) => ({
        id: t.id,
        nombre: (t.nombre_comercial || t.razon_social) as string,
      })) as TerceroRef[];
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
      usd_bcv: Number(f.cxp?.usd_bcv_factura) || (Number(f.tasa_bcv) > 0 ? Number(f.monto_bs) / Number(f.tasa_bcv) : null),
      cuenta_codigo: f.cuenta_codigo,
      proveedor: f.proveedor ?? null,
      tercero_id: f.tercero_id ?? null,
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

  const tercerosById = useMemo(() => {
    const m = new Map<string, TerceroRef>();
    (terceros ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [terceros]);

  const filas = useMemo(() => {
    const lista = terceros ?? [];
    return (movimientos ?? []).map((mov: any) => {
      // Proveedor: el asignado en la transacción, si no, el adivinado del memo (columna F)
      const provDirecto = mov.tercero_id ? tercerosById.get(mov.tercero_id) ?? null : null;
      const provAdivinado = provDirecto ? null : proveedorDeMemo(mov.notas, lista);
      const proveedor = provDirecto ?? provAdivinado;
      const provFuente: "asignado" | "memo" | null = provDirecto ? "asignado" : provAdivinado ? "memo" : null;

      const auto = parearMovimiento(mov, indice.porNumero, indice.lista, proveedor);
      const vs = vinculosPorMov.get(mov.id) ?? [];
      const confirmados = vs.filter((v) => v.transaccion_factura_id && v.estado !== "rechazado");
      const filaRechazo = vs.find((v) => v.estado === "rechazado");
      const filaManual = vs.find(
        (v) => !v.transaccion_factura_id && (ESTADOS_MANUALES as readonly string[]).includes(v.estado),
      );
      const estadoManual: EstadoManual | null = normalizarEstadoManual(filaManual?.estado);

      const rechazadas: string[] = (filaRechazo?.facturas_rechazadas ?? []) as string[];
      const idsSug = auto.facturas.map((f) => f.id);
      const mismoRechazo =
        !!filaRechazo &&
        (rechazadas.length === 0 ||
          (rechazadas.length === idsSug.length && [...rechazadas].sort().join("|") === [...idsSug].sort().join("|")));
      let estado: EstadoConciliacion = auto.estado;
      let facturas = auto.facturas;
      let motivo = auto.motivo;
      let origen: "auto" | "manual" | null = null;

      if (confirmados.length) {
        facturas = confirmados
          .map((v) => indice.lista.find((f) => f.id === v.transaccion_factura_id))
          .filter(Boolean) as FacturaRef[];
        const cob = coberturaPareo(facturas, Number(mov.monto_bs), Number(mov.tasa_bcv));
        estado = cob.completa ? "pareado" : "parcial";
        origen = confirmados.every((v) => v.origen === "auto") ? "auto" : "manual";
        motivo = cob.completa
          ? origen === "auto" ? "Confirmado (sugerencia automática)" : "Pareado manualmente"
          : `Pareo parcial: cubre ${cob.total.toFixed(2)} de ${cob.monto.toFixed(2)} Bs (faltan ${cob.diferencia.toFixed(2)} Bs)`;
      } else if (estadoManual) {
        estado =
          estadoManual === "gasto_directo" || estadoManual === "no_contable"
            ? "no_aplica"
            : (estadoManual as EstadoConciliacion);
        facturas = [];
        origen = "manual";
        motivo = `Marcado a mano: ${ESTADO_MANUAL_LABEL[estadoManual]}`;

      } else if (filaRechazo && mismoRechazo) {
        estado = auto.estado === "posible" || auto.estado === "parcial" ? "sin_pareo" : auto.estado;
        facturas = [];
        motivo = "Sugerencia rechazada";
      } else if (filaRechazo) {
        motivo = `${auto.motivo} · sugerencia nueva tras un rechazo anterior`;
      }


      const total = facturas.reduce(
        (s, f) => s + (Number(mov.tasa_bcv) > 0 && Number(f.usd_bcv) > 0
          ? Number(f.usd_bcv) * Number(mov.tasa_bcv)
          : Math.abs(Number(f.monto_bs) || 0)),
        0,
      );
      return {
        mov,
        estado,
        facturas,
        factura: facturas[0],
        total,
        motivo,
        origen,
        proveedor,
        provFuente,
        faltantes: auto.faltantes ?? [],
        sugeridas: auto.facturas,
        auto,
        confirmadasIds: confirmados.map((v) => v.transaccion_factura_id as string),
        rechazado: !!filaRechazo,
        rechazadas,
        estadoManual,
        /** Naturaleza del movimiento sin factura: gasto que sí entra a reportes vs. no contable */
        claseNoAplica:
          estado !== "no_aplica"
            ? null
            : estadoManual === "no_contable"
              ? "no_contable"
              : mov.cuenta_codigo === "99" || mov.cuenta_codigo === "98"
                ? "no_contable"
                : "gasto_directo",

        tienePareoFactura: confirmados.length > 0,
        manual: confirmados.some((v) => v.origen === "manual"),
        confirmable: (!confirmados.length && !estadoManual) && (!vs.length || (!!filaRechazo && !mismoRechazo)) && auto.facturas.length > 0,
        estadoSugerido: (auto.estado === "parcial" ? "parcial" : "pareado") as "pareado" | "parcial",

      };

    });
  }, [movimientos, indice, vinculosPorMov, terceros, tercerosById]);


  const bancos = useMemo(
    () => [...new Set(filas.map((f) => bancoDeReferencia(f.mov.referencia)))].sort(),
    [filas],
  );

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return filas.filter((f) => {
      if (banco !== "todos" && bancoDeReferencia(f.mov.referencia) !== banco) return false;
      if (estadoF !== "todos" && f.estado !== estadoF) return false;
      if (conciliacionF.length && !conciliacionF.includes(f.estado)) return false;
      if (origenF !== "todos" && (f.origen ?? "ninguno") !== origenF) return false;
      if (cuentasSel.length && !cuentasSel.includes(f.mov.cuenta_codigo)) return false;
      if (centrosSel.length && !centrosSel.includes(f.mov.centro_costo)) return false;
      if (provSel.length && !provSel.includes(f.proveedor?.nombre ?? "—")) return false;
      if (desde && f.mov.fecha < desde) return false;
      if (hasta && f.mov.fecha > hasta) return false;
      if (q && !`${f.mov.notas ?? ""} ${f.proveedor?.nombre ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filas, banco, estadoF, conciliacionF, origenF, desde, hasta, texto, cuentasSel, centrosSel, provSel]);

  useEffect(() => { setPage(0); }, [banco, estadoF, conciliacionF, origenF, desde, hasta, texto, cuentasSel, centrosSel, provSel, pageSize]);

  const proveedoresOpts = useMemo(() => {
    const s = new Set<string>();
    filas.forEach((f) => s.add(f.proveedor?.nombre ?? "—"));
    return [...s].sort().map((n) => ({ value: n, label: n }));
  }, [filas]);

  const effectivePageSize = pageSize === "all" ? Math.max(filtradas.length, 1) : pageSize;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filtradas.length / effectivePageSize));
  const pagina = useMemo(
    () => (pageSize === "all" ? filtradas : filtradas.slice(page * effectivePageSize, (page + 1) * effectivePageSize)),
    [filtradas, page, pageSize, effectivePageSize],
  );

  const resumen = useMemo(() => {
    const c = {
      total: filtradas.length,
      pareado: 0, parcial: 0, posible: 0, no_aplica: 0, sin_pareo: 0,
      gasto_directo: 0, no_contable: 0, porDeterminar: 0,
      bsPareado: 0, bsGastoDirecto: 0, bsPorDeterminar: 0, bsNoContable: 0,
    } as any;
    for (const f of filtradas) {
      c[f.estado]++;
      const bs = Math.abs(Number(usdVisual(f.mov as any, usdMode)) || 0);
      if (f.mov.cuenta_codigo === "99") { c.porDeterminar++; c.bsPorDeterminar += bs; }
      if (f.estado === "pareado" || f.estado === "parcial") c.bsPareado += bs;
      if (f.claseNoAplica === "gasto_directo") { c.gasto_directo++; c.bsGastoDirecto += bs; }
      if (f.claseNoAplica === "no_contable") { c.no_contable++; c.bsNoContable += bs; }
    }
    return c;
  }, [filtradas, usdMode]);


  const marcarEstado = async (movId: string, estado: EstadoManual | null) => {
    const r = await marcarEstadoConciliacion({ movimientoId: movId, estado, userId: user?.id ?? null });
    if (!r.ok) { toast.error(r.error ?? "No se pudo guardar el estado"); return; }
    toast.success(estado ? `Marcado como ${ESTADO_MANUAL_LABEL[estado]}` : "Estado devuelto a automático");
    qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] });
  };


  const guardarVinculo = async (
    movId: string,
    facturaIds: string[],
    estado: "pareado" | "parcial" | "rechazado",
    origen: "auto" | "manual",
    facturasRechazadas?: string[],
  ) => {
    const r = await guardarVinculosConciliacion({
      movimientoId: movId,
      contrapartes: facturaIds,
      estado,
      origen,
      userId: user?.id ?? null,
      facturasRechazadas,
    });
    if (!r.ok) { toast.error(r.error ?? "No se pudo guardar el pareo"); return; }
    toast.success(estado === "rechazado" ? "Sugerencia rechazada" : estado === "parcial" ? "Pareo parcial guardado" : "Pareo confirmado");
    qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] });
  };

  // ── Recalcular pareos con las facturas actuales ──────────────
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  const propuestas = useMemo(() => {
    const porMov = new Map(filtradas.map((f) => [f.mov.id, f]));
    const res = recalcularPareos(
      filtradas.map((f) => ({
        movId: f.mov.id,
        montoBs: Number(f.mov.monto_bs),
        auto: f.auto,
        confirmadas: f.confirmadasIds,
        rechazado: f.rechazado,
        rechazadas: f.rechazadas,
        manual: f.manual,
      })),
    );
    return res.map((r) => ({ ...r, fila: porMov.get(r.movId)! }));
  }, [filtradas]);

  const porTipo = useMemo(() => ({
    nuevo_pareo: propuestas.filter((p) => p.cambio === "nuevo_pareo"),
    parcial_completable: propuestas.filter((p) => p.cambio === "parcial_completable"),
    rechazo_obsoleto: propuestas.filter((p) => p.cambio === "rechazo_obsoleto"),
  }), [propuestas]);

  const aplicarRecalculo = async (lista: typeof propuestas) => {
    if (!lista.length) return;
    setAplicando(true);
    let ok = 0;
    let fail = 0;
    for (const p of lista) {
      const r = await guardarVinculosConciliacion({
        movimientoId: p.movId,
        contrapartes: p.facturas.map((f) => f.id),
        estado: p.estado,
        origen: "auto",
        userId: user?.id ?? null,
      });
      if (r.ok) ok++; else fail++;
    }
    setAplicando(false);
    qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] });
    if (fail) toast.error(`${ok} pareo(s) actualizados, ${fail} con error`);
    else toast.success(`${ok} pareo(s) actualizados`);
    setRecalcOpen(false);
  };

  const [editando, setEditando] = useState<any | null>(null);
  const [pareando, setPareando] = useState<any | null>(null);

  const recargarDatos = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["mov-bancarios"] }),
      qc.invalidateQueries({ queryKey: ["facturas-compra-para-conciliar"] }),
      qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] }),
      qc.invalidateQueries({ queryKey: ["cxp-pareo-manual"] }),
    ]);
  };

  const quitarPareo = async (movId: string) => {
    const r = await quitarPareoManual(movId);
    if (!r.ok) { toast.error(r.error ?? "No se pudo quitar el pareo"); return; }
    toast.success("Pareo eliminado — el movimiento vuelve a 'Sin pareo'");
    await recargarDatos();
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
        { header: "Proveedor (si aplica)", key: "proveedor", width: 28 },
        { header: "Origen del proveedor", key: "provFuente", width: 18 },
        { header: "Estado de conciliación", key: "estado", width: 26 },
        { header: "Impacto en reportes", key: "impactoReportes", width: 20 },

        { header: "Facturas pareadas", key: "factura", width: 26 },
        { header: "Total pareado Bs", key: "totalPareado", width: 16, fmt: "bs" },
        { header: "Diferencia Bs", key: "dif", width: 16, fmt: "bs" },
        { header: "Proveedor factura", key: "provFactura", width: 28 },
        { header: "Origen del pareo", key: "origen", width: 16 },
        { header: "Motivo del pareo", key: "motivo", width: 40 },

      ],
      rows: filtradas.map((f) => ({
        fecha: f.mov.fecha,
        banco: bancoDeReferencia(f.mov.referencia),
        ref: refBancaria(f.mov.referencia),
        bs: Math.abs(Number(f.mov.monto_bs) || 0),
        usdBcv: usdBcvDe(f.mov),
        usdPar: Number(f.mov.monto_usd ?? 0),
        cuenta: `${f.mov.cuenta_codigo} · ${nombreCuenta(f.mov.cuenta_codigo)}`,
        centro: f.mov.centro_costo,
        notas: f.mov.notas ?? "",
        proveedor: f.proveedor?.nombre ?? "",
        provFuente: f.provFuente === "asignado" ? "Asignado" : f.provFuente === "memo" ? "Deducido del memo" : "—",
        estado:
          f.estado === "no_aplica"
            ? (f.claseNoAplica === "no_contable" ? "No aplica (no contable)" : "Gasto directo (sin factura)")
            : ESTADO_LABEL[f.estado],
        impactoReportes:
          f.estado === "no_aplica" && f.claseNoAplica === "no_contable" ? "No afecta G&P/FC" : "Afecta G&P y FC",

        factura: f.facturas.map((x) => x.numero_factura).filter(Boolean).join(", "),
        totalPareado: f.facturas.length ? f.total : 0,
        dif: f.facturas.length ? Math.abs(Number(f.mov.monto_bs)) - f.total : 0,
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

  const badgeEstado = (e: EstadoConciliacion, clase?: string | null) => {
    if (e === "pareado") return <Badge className="bg-green-600">Pareado</Badge>;
    if (e === "parcial") return <Badge className="bg-amber-600">Pareado parcial</Badge>;
    if (e === "posible") return <Badge className="bg-orange-500">Posible pareo</Badge>;
    if (e === "no_aplica")
      return clase === "no_contable"
        ? <Badge variant="outline">No aplica (no contable)</Badge>
        : <Badge variant="secondary">Gasto directo (sin factura)</Badge>;

    return <Badge variant="destructive">Sin pareo</Badge>;
  };

  const setPreset = (p: string) => {
    const hoy = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (p === "todo") { setDesde(""); setHasta(""); return; }
    if (p === "mes") {
      setDesde(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
      setHasta(iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)));
      return;
    }
    if (p === "mes_anterior") {
      setDesde(iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)));
      setHasta(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)));
      return;
    }
    if (p === "trimestre") {
      setDesde(iso(new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1)));
      setHasta(iso(hoy));
      return;
    }
    if (p === "ano") { setDesde(`${hoy.getFullYear()}-01-01`); setHasta(iso(hoy)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimientos bancarios</h1>
          <p className="text-sm text-muted-foreground">Conciliación de movimientos importados del banco contra las facturas registradas</p>
        </div>
        <div className="flex items-center gap-2">
          <UsdViewToggle />
          <Button variant="outline" onClick={async () => { await recargarDatos(); setRecalcOpen(true); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Recalcular pareos
            {propuestas.length > 0 && (
              <Badge variant="secondary" className="ml-2">{propuestas.length}</Badge>
            )}
          </Button>
          <Button onClick={onExportar} disabled={exportando}>
            <Download className="h-4 w-4 mr-2" /> {exportando ? "Generando…" : "Exportar a Excel"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-6">
        <Kpi label="Total movimientos" value={resumen.total} />
        <Kpi label="Pareados" value={resumen.pareado} tone="text-green-600" />
        <Kpi label="Pareo parcial" value={resumen.parcial} tone="text-amber-600" />
        <Kpi label="Posible pareo" value={resumen.posible} tone="text-orange-600" />
        <Kpi label="Gasto directo (sin factura)" value={resumen.gasto_directo} tone="text-muted-foreground" />
        <Kpi label="Sin pareo" value={resumen.sin_pareo} tone="text-destructive" highlight={resumen.sin_pareo > 0} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label={`Pagado contra facturas (CxP) · ${usdLabel}`} value={fmtUsd(resumen.bsPareado)} tone="text-green-600" sub="Afecta G&P y FC" />
        <Kpi label={`Gasto directo sin factura · ${usdLabel}`} value={fmtUsd(resumen.bsGastoDirecto)} sub="Afecta G&P y FC" />
        <Kpi
          label={`En 99 — POR DETERMINAR · ${usdLabel}`}
          value={fmtUsd(resumen.bsPorDeterminar)}
          tone={resumen.porDeterminar > 0 ? "text-destructive" : undefined}
          highlight={resumen.porDeterminar > 0}
          sub={`${resumen.porDeterminar} movimiento(s) · no entran a G&P/FC hasta reclasificarse`}
        />
        <Kpi label={`No contable · ${usdLabel}`} value={fmtUsd(resumen.bsNoContable)} tone="text-muted-foreground" sub="Traspasos y operaciones de cambio" />
      </div>


      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
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
                <SelectItem value="parcial">Pareado parcial</SelectItem>
                <SelectItem value="posible">Posible pareo</SelectItem>
                <SelectItem value="no_aplica">Gasto directo / no aplica</SelectItem>
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
            <Input placeholder="Buscar en memo o proveedor…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>

          <div className="grid gap-3 md:grid-cols-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Rango rápido</Label>
              <Select
                value={!desde && !hasta ? "todo" : "custom"}
                onValueChange={setPreset}
              >
                <SelectTrigger><SelectValue placeholder="Rango de fechas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Todo el histórico</SelectItem>
                  <SelectItem value="mes">Mes actual</SelectItem>
                  <SelectItem value="mes_anterior">Mes anterior</SelectItem>
                  <SelectItem value="trimestre">Últimos 3 meses</SelectItem>
                  <SelectItem value="ano">Año en curso</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            {(desde || hasta) && (
              <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => { setDesde(""); setHasta(""); }}>
                <X className="h-3 w-3 mr-1" /> Limpiar fechas
              </Button>
            )}
          </div>

          {(desde || hasta || provSel.length > 0 || cuentasSel.length > 0 || centrosSel.length > 0 || conciliacionF.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {desde && <Badge variant="outline">Desde {fmtDate(desde)}</Badge>}
              {hasta && <Badge variant="outline">Hasta {fmtDate(hasta)}</Badge>}
              {provSel.length > 0 && <Badge variant="outline">{provSel.length} proveedor(es)</Badge>}
              {cuentasSel.length > 0 && <Badge variant="outline">{cuentasSel.length} cuenta(s)</Badge>}
              {centrosSel.length > 0 && <Badge variant="outline">{centrosSel.length} centro(s)</Badge>}
              {conciliacionF.length > 0 && <Badge variant="outline">{conciliacionF.length} conciliación(es)</Badge>}
            </div>
          )}
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
                    <th className="text-left py-2 px-2">
                      Proveedor (si aplica)
                      <MultiSelectFilter
                        label="Proveedor"
                        options={proveedoresOpts}
                        selected={provSel}
                        onChange={setProvSel}
                      />
                    </th>
                    <th className="text-left py-2 px-2">
                      Conciliación
                      <MultiSelectFilter
                        label="Conciliación"
                        options={Object.entries(ESTADO_LABEL).map(([value, label]) => ({ value, label }))}
                        selected={conciliacionF}
                        onChange={setConciliacionF}
                      />
                    </th>
                    <th className="text-right py-2 px-2">Acciones</th>

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
                      <td className="py-2 px-2 text-xs">
                        {f.proveedor ? (
                          <div className="flex flex-col">
                            <span>{f.proveedor.nombre}</span>
                            {f.provFuente === "memo" && (
                              <span className="text-[10px] text-muted-foreground">deducido del memo</span>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            {badgeEstado(f.estado, f.claseNoAplica)}
                            {f.origen && (
                              <Badge variant="outline" className="text-[10px]">
                                {f.origen === "auto" ? "Automático" : "Manual"}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">{f.motivo}</span>
                          {(f.facturas ?? []).map((fa) => (
                            <span key={fa.id} className="text-[11px] mono">
                              Fact {fa.numero_factura} · {fa.proveedor ?? "—"} · {fmtDate(fa.fecha)} · {fmtUsd(Number(fa.usd_bcv) || 0)} USD BCV · {fmtBs(Number(fa.usd_bcv) > 0 ? Number(fa.usd_bcv) * Number(f.mov.tasa_bcv) : fa.monto_bs)} al {fmtDate(f.mov.fecha)}
                            </span>
                          ))}
                          {f.facturas.length > 1 && (
                            <span className="text-[11px] font-medium">Total pareado: {fmtBs(f.total)}</span>
                          )}
                          {f.faltantes.length > 0 && (
                            <span className="text-[11px] text-destructive">
                              Sin factura registrada: {f.faltantes.join(", ")}
                            </span>
                          )}
                          {f.confirmable && f.sugeridas.length > 0 && (
                            <div className="flex gap-1 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => guardarVinculo(f.mov.id, f.sugeridas.map((s) => s.id), f.estadoSugerido, "auto")}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                {f.estadoSugerido === "parcial" ? "Confirmar parcial" : "Confirmar"}
                                {f.sugeridas.length > 1 ? ` (${f.sugeridas.length})` : ""}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => guardarVinculo(f.mov.id, [], "rechazado", "manual", f.sugeridas.map((s: any) => s.id))}>
                                <X className="h-3 w-3 mr-1" /> Rechazar
                              </Button>
                            </div>
                          )}
                          {f.tienePareoFactura ? (
                            <span className="text-[11px] text-muted-foreground pt-1">
                              Para cambiar el estado a mano, primero quita el pareo.
                            </span>
                          ) : (
                            <Select
                              value={f.estadoManual ?? "auto"}
                              onValueChange={(v) => marcarEstado(f.mov.id, v === "auto" ? null : (v as EstadoManual))}
                            >
                              <SelectTrigger className="h-7 w-[190px] text-xs mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">Automático (sugerido)</SelectItem>
                                {(Object.keys(ESTADO_MANUAL_LABEL) as EstadoManual[]).map((k) => (
                                  <SelectItem key={k} value={k}>{ESTADO_MANUAL_LABEL[k]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>


                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setPareando(f)}>
                            <Pencil className="h-3 w-3 mr-1" /> Editar / Parear
                          </Button>
                          {(f.estado === "pareado" || f.estado === "parcial") && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => quitarPareo(f.mov.id)}>
                              <X className="h-3 w-3 mr-1" /> Quitar pareo
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditando(f.mov)}>
                            Editar transacción
                          </Button>
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

      <Dialog open={recalcOpen} onOpenChange={setRecalcOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recalcular pareos</DialogTitle>
            <DialogDescription>
              Se revisaron {filtradas.length} movimientos (con los filtros actuales) contra las facturas registradas hoy.
              Los pareos confirmados manualmente nunca se modifican.
            </DialogDescription>
          </DialogHeader>

          {propuestas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todo está al día: no hay pareos por actualizar.</p>
          ) : (
            <div className="space-y-3">
              {([
                ["nuevo_pareo", "Movimientos sin pareo que ahora tienen factura", porTipo.nuevo_pareo],
                ["parcial_completable", "Pareos parciales que ahora se completan", porTipo.parcial_completable],
                ["rechazo_obsoleto", "Rechazos con una sugerencia distinta", porTipo.rechazo_obsoleto],
              ] as const).map(([key, label, lista]) => (
                <div key={key} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{lista.length} movimiento(s)</p>
                    {lista.slice(0, 3).map((p) => (
                      <p key={p.movId} className="truncate text-xs text-muted-foreground">
                        · {fmtDate(p.fila.mov.fecha)} — {fmtBs(Math.abs(Number(p.fila.mov.monto_bs)))} — {p.motivo}
                      </p>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" disabled={!lista.length || aplicando} onClick={() => aplicarRecalculo(lista as any)}>
                    Aplicar
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRecalcOpen(false)}>Cerrar</Button>
            <Button disabled={!propuestas.length || aplicando} onClick={() => aplicarRecalculo(propuestas)}>
              {aplicando ? "Aplicando…" : `Aplicar todo (${propuestas.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editando && (
        <EditDialog
          tx={editando}
          onClose={() => setEditando(null)}
          onSaved={async () => { setEditando(null); await recargarDatos(); }}
        />
      )}

      {pareando && (
        <PareoManualDialog
          mov={pareando.mov}
          proveedorActual={pareando.proveedor ?? null}
          onClose={() => setPareando(null)}
          onSaved={recargarDatos}
        />
      )}

    </div>

  );
}

function Kpi({ label, value, tone, highlight, sub }: { label: string; value: number | string; tone?: string; highlight?: boolean; sub?: string }) {
  return (
    <Card className={highlight ? "border-destructive" : undefined}>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${tone ?? ""}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

