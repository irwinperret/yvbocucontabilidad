import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtDate, fmtUsd } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft, GripVertical, Link2Off, Wand2, Download, Pencil } from "lucide-react";
import { EditDialog } from "@/components/transaccion-edit-dialog";
import { FacturaDetalleDialog } from "@/components/factura-detalle-dialog";
import { exportTableToExcel } from "@/lib/excel-table";
import {
  aplicarPareoCxp,
  quitarPareoCxp,
  esPagoDirecto,
  liberarPagoDirecto,
  reasignarPagoDirecto,
} from "@/lib/pareo-cxp";
import { pendienteBsHistorico, pendienteUsdBcv, dentroDeTolerancia } from "@/lib/cxp-saldo";
import { bancoDeReferencia } from "@/lib/conciliacion-matching";
import { CUENTA_CAMBIO } from "@/lib/operaciones-cambio";
import { marcarEstadoConciliacion, normalizarEstadoManual, ESTADO_MANUAL_LABEL, type EstadoManual } from "@/lib/conciliacion";

const ORIGEN_LABEL: Record<string, string> = {
  manual: "Manual",
  xetux: "Xetux (Compras)",
  movimientos_bancarios: "Movimientos bancarios",
};

export const Route = createFileRoute("/_authenticated/proveedores/$id")({
  component: TableroProveedor,
  head: () => ({
    meta: [
      { title: "Conciliación por proveedor | Yvbocu Contabilidad" },
      { name: "description", content: "Asigna facturas a cada movimiento bancario arrastrándolas al pago correspondiente." },
      { property: "og:title", content: "Conciliación por proveedor | Yvbocu Contabilidad" },
      { property: "og:description", content: "Asigna facturas a cada movimiento bancario arrastrándolas al pago correspondiente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const SIN = "sin-proveedor";
const BANDEJA = "sin-asignar";

function usdBcvDeMov(mov: any): number {
  const bs = Math.abs(Number(mov?.monto_bs) || 0);
  const tasa = Number(mov?.tasa_bcv) || 0;
  if (tasa > 0 && bs > 0) return +(bs / tasa).toFixed(2);
  const usd = Number(mov?.monto_usd) || 0;
  return usd > 0 ? +usd.toFixed(2) : 0;
}


function usdBcvFactura(c: any): number {
  return Number(c?.usd_bcv_factura ?? c?.monto_usd ?? 0) || 0;
}

/** Chip arrastrable de factura. */
function FacturaChip({
  cxp,
  emision,
  aplicadoBs,
  onQuitar,
  disabled,
  onEditar,
}: {
  cxp: any;
  emision?: string;
  aplicadoBs?: number;
  onQuitar?: () => void;
  disabled?: boolean;
  onEditar?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `cxp:${cxp.id}`, disabled });
  // "Aplicado" se guarda internamente en Bs; se muestra en USD BCV usando la
  // misma proporción sobre el monto total de la factura (misma tasa implícita).
  const montoBsFactura = Number(cxp.monto_bs) || 0;
  const usdBcvTotal = usdBcvFactura(cxp);
  const aplicadoUsd =
    typeof aplicadoBs === "number" && montoBsFactura > 0 ? +((aplicadoBs / montoBsFactura) * usdBcvTotal).toFixed(2) : undefined;
  return (
    <div
      className={`flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs ${isDragging ? "opacity-50" : ""} ${onEditar ? "cursor-pointer hover:bg-muted/50" : ""}`}
      onClick={(e) => { if (onEditar && !(e.target as HTMLElement).closest("button")) onEditar(); }}
      title={onEditar ? "Abrir y editar factura" : undefined}
    >
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`flex items-center gap-2 flex-1 min-w-0 ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="font-medium">Fact. {cxp.numero_factura ?? "s/n"}</span>
        <span className="text-muted-foreground">emisión {emision ? fmtDate(emision) : "—"}</span>
        <span className="mono">{fmtBs(Number(cxp.monto_bs) || 0)}</span>
        <span className="mono text-muted-foreground">{fmtUsd(usdBcvTotal)} BCV</span>
        {typeof aplicadoUsd === "number" && (
          <span className="mono text-muted-foreground">aplicado {fmtUsd(aplicadoUsd)} USD BCV</span>
        )}
        <Badge variant={cxp.estado === "pagada" ? "secondary" : cxp.estado === "parcial" ? "default" : "outline"}>
          {cxp.estado === "pagada" ? "Pagada" : cxp.estado === "parcial" ? "Parcial" : "Pendiente"}
        </Badge>
      </span>
      {onQuitar && (
        <Button variant="ghost" size="sm" onClick={onQuitar} disabled={disabled} title="Quitar del movimiento">
          <Link2Off className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function Zona({ id, children, className, onClick }: { id: string; children: React.ReactNode; className?: string; onClick?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} onClick={onClick} className={`${className ?? ""} ${isOver ? "ring-2 ring-primary rounded-md" : ""}`}>
      {children}
    </div>
  );
}

function TableroProveedor() {
  const { id } = useParams({ from: "/_authenticated/proveedores/$id" });
  const qc = useQueryClient();
  const { user } = useAuth();
  const esSin = id === SIN;
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [busca, setBusca] = useState("");
  const [focusResumen, setFocusResumen] = useState<null | "movs-sin-factura" | "facturas-sin-mov">(null);
  const [busy, setBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));




  const { data: terceros } = useQuery({
    queryKey: ["terceros-tablero"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("id,razon_social,nombre_comercial").order("razon_social");
      return (data ?? []) as any[];
    },
  });
  const nombreProveedor = esSin
    ? "Sin proveedor"
    : (terceros ?? []).find((t) => t.id === id)?.nombre_comercial ||
      (terceros ?? []).find((t) => t.id === id)?.razon_social ||
      "Proveedor";

  const { data: proveedorActual } = useQuery({
    queryKey: ["tercero-actual", id],
    enabled: !esSin,
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("*").eq("id", id).maybeSingle();
      return data as any;
    },
  });
  const [registrando, setRegistrando] = useState(false);
  const [editandoMov, setEditandoMov] = useState<any | null>(null);
  const [editandoFactura, setEditandoFactura] = useState<any | null>(null);
  const [rifForm, setRifForm] = useState({ razon_social: "", nombre_comercial: "", tipo_rif: "J", rif: "" });
  const abrirRegistro = () => {
    setRifForm({
      razon_social: proveedorActual?.razon_social ?? "",
      nombre_comercial: proveedorActual?.nombre_comercial ?? "",
      tipo_rif: "J",
      rif: "",
    });
    setRegistrando(true);
  };
  const registrarOficialmente = async () => {
    if (!rifForm.razon_social.trim()) return toast.error("Ingresa el nombre del proveedor");
    if (!rifForm.rif.trim()) return toast.error("Ingresa el RIF");
    const { error } = await supabase
      .from("terceros")
      .update({
        estado_registro: "oficial",
        razon_social: rifForm.razon_social.trim(),
        nombre_comercial: rifForm.nombre_comercial.trim() || null,
        tipo_rif: rifForm.tipo_rif,
        rif: rifForm.rif.trim(),
      } as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Proveedor registrado oficialmente");
    setRegistrando(false);
    qc.invalidateQueries({ queryKey: ["tercero-actual", id] });
    qc.invalidateQueries({ queryKey: ["terceros-tablero"] });
  };

  /** Guarda solo el nombre corregido, sin exigir RIF ni cambiar el estado (sigue como candidato). */
  const guardarSoloNombre = async () => {
    if (!rifForm.razon_social.trim()) return toast.error("Ingresa el nombre del proveedor");
    const { error } = await supabase
      .from("terceros")
      .update({
        razon_social: rifForm.razon_social.trim(),
        nombre_comercial: rifForm.nombre_comercial.trim() || null,
      } as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Nombre actualizado — sigue pendiente de verificar hasta que registres el RIF");
    setRegistrando(false);
    qc.invalidateQueries({ queryKey: ["tercero-actual", id] });
    qc.invalidateQueries({ queryKey: ["terceros-tablero"] });
  };

  const { data: cxps } = useQuery({
    queryKey: ["tablero-cxp", id],
    queryFn: async () => {
      let q = supabase.from("cuentas_por_pagar").select("*").order("fecha_vencimiento", { ascending: true });
      q = esSin ? q.is("tercero_id", null) : q.eq("tercero_id", id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: movimientos } = useQuery({
    queryKey: ["tablero-movs"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      return (await fetchAllRows(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("*")
          .neq("standby", true)
          .neq("cuenta_codigo", CUENTA_CAMBIO)
          .like("referencia", "BANK:%")
          .order("fecha", { ascending: false })
          .range(from, to),
      )) as any[];
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

  const facturaIds = useMemo(
    () => new Set((cxps ?? []).map((c) => c.transaccion_id).filter(Boolean) as string[]),
    [cxps],
  );

  /** Transacciones de las facturas (para conocer su grupo contable y su fecha). */
  const { data: facturasTx } = useQuery({
    queryKey: ["tablero-facturas-tx", id, [...facturaIds].sort().join(",")],
    enabled: facturaIds.size > 0,
    queryFn: async () => {
      const ids = [...facturaIds];
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase
          .from("transacciones")
          .select("id, grupo_transaccion_id, fecha")
          .in("id", ids.slice(i, i + 200));
        out.push(...(data ?? []));
      }
      return out;
    },
  });

  /** grupo_transaccion_id -> transaccion_factura_id */
  const grupoAFactura = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of facturasTx ?? []) {
      if (t.grupo_transaccion_id) m.set(t.grupo_transaccion_id, t.id);
    }
    return m;
  }, [facturasTx]);

  /** transaccion_factura_id -> fecha de emisión de la factura. */
  const fechaEmisionPorFactura = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of facturasTx ?? []) {
      if (t.id && t.fecha) m.set(t.id, t.fecha);
    }
    return m;
  }, [facturasTx]);

  const emisionDeCxp = (c: any) => (c?.transaccion_id ? fechaEmisionPorFactura.get(c.transaccion_id) : undefined);

  /** numero_factura -> transaccion_factura_id */
  const numeroAFactura = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cxps ?? []) {
      const n = String(c.numero_factura ?? "").trim();
      if (n && c.transaccion_id) m.set(n, c.transaccion_id);
    }
    return m;
  }, [cxps]);

  /** movId -> facturaTxIds (vínculo formal + pareo manual + pago directo del importador) */
  const movAFacturas = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of vinculos ?? []) {
      if (!v.transaccion_factura_id || v.estado === "rechazado") continue;
      const arr = m.get(v.transaccion_bancaria_id) ?? [];
      arr.push(v.transaccion_factura_id);
      m.set(v.transaccion_bancaria_id, arr);
    }
    // Pagos directos: el movimiento es la propia transacción 13.2.
    for (const mv of movimientos ?? []) {
      if (m.has(mv.id)) continue;
      if (String(mv.cuenta_codigo) !== "8.2") continue;
      const ligados = new Set<string>();
      const porGrupo = mv.grupo_transaccion_id ? grupoAFactura.get(mv.grupo_transaccion_id) : undefined;
      if (porGrupo) ligados.add(porGrupo);
      const det = String(mv.detalle ?? "");
      if (det.startsWith("Pago facturas")) {
        for (const n of det.replace("Pago facturas", "").split(",")) {
          const f = numeroAFactura.get(n.trim());
          if (f) ligados.add(f);
        }
      }
      if (ligados.size) m.set(mv.id, [...ligados]);
    }
    return m;
  }, [vinculos, movimientos, grupoAFactura, numeroAFactura]);

  const movsDelProveedor = useMemo(() => {
    return (movimientos ?? []).filter((mv) => {
      // An explicit supplier assignment on the bank movement is authoritative for
      // the supplier dashboard. A reconciliation link must not hide that movement.
      if (esSin) {
        if (mv.tercero_id) return false;
      } else if (mv.tercero_id === id) {
        return true;
      }

      const ligados = movAFacturas.get(mv.id) ?? [];
      if (ligados.some((f) => facturaIds.has(f))) return true;
      if (ligados.length) return false; // pareado con otro proveedor
      return esSin ? !mv.tercero_id : mv.tercero_id === id;
    });
  }, [movimientos, movAFacturas, facturaIds, esSin, id]);

  /** movId -> CxP asignadas (ordenadas por fecha de emisión). */
  const cxpsPorMov = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const mv of movsDelProveedor) {
      const txIds = movAFacturas.get(mv.id) ?? [];
      const lista = (cxps ?? [])
        .filter((c) => c.transaccion_id && txIds.includes(c.transaccion_id))
        .sort((a, b) => String(emisionDeCxp(a) ?? "").localeCompare(String(emisionDeCxp(b) ?? "")));
      m.set(mv.id, lista);
    }
    return m;
  }, [movsDelProveedor, movAFacturas, cxps, fechaEmisionPorFactura]);

  const cxpsDeMov = (movId: string) => cxpsPorMov.get(movId) ?? [];

  /** Facturas que no están asignadas a ningún movimiento del proveedor. */
  const facturasSinMov = useMemo(() => {
    const asignadas = new Set<string>();
    for (const lista of cxpsPorMov.values()) for (const c of lista) asignadas.add(c.id);
    return (cxps ?? [])
      .filter((c) => !asignadas.has(c.id))
      .sort((a, b) => String(emisionDeCxp(b) ?? "").localeCompare(String(emisionDeCxp(a) ?? "")));
  }, [cxps, cxpsPorMov, fechaEmisionPorFactura]);

  /** Bs de la factura valorados a la tasa BCV del día del pago. */
  const facturaBsAlPago = (c: any, mov: any) => {
    const tasa = Number(mov?.tasa_bcv) || 0;
    const usd = usdBcvFactura(c);
    if (tasa > 0 && usd > 0) return +(usd * tasa).toFixed(2);
    return Number(c.monto_bs) || 0;
  };

  const resumenMov = (mov: any) => {
    const lista = cxpsDeMov(mov.id);
    const montoMov = Math.abs(Number(mov.monto_bs) || 0);
    let restante = montoMov;
    const aplicadoPorCxp = new Map<string, number>();
    for (const c of lista) {
      const necesita = facturaBsAlPago(c, mov);
      const aplica = +Math.min(necesita, Math.max(0, restante)).toFixed(2);
      aplicadoPorCxp.set(c.id, aplica);
      restante = +(restante - aplica).toFixed(2);
    }
    const aplicado = +(montoMov - Math.max(0, restante)).toFixed(2);
    const sinAplicar = dentroDeTolerancia(restante, montoMov) ? 0 : Math.max(0, restante);
    // Equivalente en USD BCV: misma proporción sobre el monto del movimiento
    // ya expresado en USD BCV (misma tasa que ya se muestra en pantalla).
    const usdBcvMov = usdBcvDeMov(mov);
    const aplicadoUsd = montoMov > 0 ? +((aplicado / montoMov) * usdBcvMov).toFixed(2) : 0;
    const sinAplicarUsd = montoMov > 0 ? +((sinAplicar / montoMov) * usdBcvMov).toFixed(2) : 0;
    return { lista, montoMov, aplicado, sinAplicar, aplicadoUsd, sinAplicarUsd, aplicadoPorCxp };
  };

  const movsFiltrados = useMemo(() => {
    const txt = busca.trim().toLowerCase();
    return movsDelProveedor.filter((mv) => {
      const lista = cxpsDeMov(mv.id);
      const { sinAplicar } = resumenMov(mv);
      if (filtroEstado === "sin-facturas" && lista.length) return false;
      if (filtroEstado === "con-facturas" && !lista.length) return false;
      if (filtroEstado === "con-remanente" && !(sinAplicar > 0.01)) return false;
      if (txt) {
        const hay = `${mv.referencia ?? ""} ${mv.notas ?? ""} ${mv.detalle ?? ""} ${lista
          .map((c) => c.numero_factura ?? "")
          .join(" ")}`.toLowerCase();
        if (!hay.includes(txt)) return false;
      }
      return true;
    });
  }, [movsDelProveedor, cxpsPorMov, filtroEstado, busca]);

  const movsSinFacturas = movsDelProveedor.filter((mv) => !cxpsDeMov(mv.id).length);
  const totalSinAplicar = movsDelProveedor.reduce((s, mv) => s + resumenMov(mv).sinAplicar, 0);
  const totalSinAplicarUsd = movsDelProveedor.reduce((s, mv) => s + resumenMov(mv).sinAplicarUsd, 0);

  const totalUsdBcvFacturasSinMov = facturasSinMov.reduce((s, c) => s + pendienteUsdBcv(c), 0);
  const totalUsdBcvMovsSinFactura = movsSinFacturas.reduce((s, mv) => s + usdBcvDeMov(mv), 0);


  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ["conciliacion-bancaria"] });
    await qc.invalidateQueries({ queryKey: ["tablero-cxp", id] });
    await qc.invalidateQueries({ queryKey: ["tablero-movs"] });
    await qc.invalidateQueries({ queryKey: ["cxp-analisis"] });
    await qc.invalidateQueries({ queryKey: ["mov-bancarios"] });
  };

  /** Estado manual actual de un movimiento (vínculo sin factura, si existe). */
  const estadoManualDeMov = (movId: string): EstadoManual | null => {
    const v = (vinculos ?? []).find((x: any) => x.transaccion_bancaria_id === movId && !x.transaccion_factura_id);
    return v ? normalizarEstadoManual(v.estado) : null;
  };
  const cambiarEstadoManual = async (movId: string, estado: EstadoManual | null) => {
    const r = await marcarEstadoConciliacion({ movimientoId: movId, estado, userId: user?.id ?? null });
    if (!r.ok) { toast.error(r.error ?? "No se pudo cambiar el estado"); return; }
    toast.success(estado ? `Marcado como ${ESTADO_MANUAL_LABEL[estado]}` : "Estado devuelto a automático");
    await refrescar();
  };

  /** Deja el movimiento con exactamente el conjunto de facturas indicado. */
  const aplicarConjunto = async (mov: any, nuevas: any[]) => {
    if (!user) throw new Error("Sesión no disponible");
    const actuales = cxpsDeMov(mov.id);
    const ordenadas = [...nuevas].sort((a, b) =>
      String(emisionDeCxp(a) ?? "").localeCompare(String(emisionDeCxp(b) ?? "")),
    );
    if (esPagoDirecto(mov)) {
      const r = await reasignarPagoDirecto({
        mov,
        cxpsActuales: actuales,
        destinos: ordenadas,
        userId: user.id,
      });
      if (!r.ok) throw new Error(r.error ?? "No se pudo reasignar");
      return;
    }
    if (actuales.length) {
      const r = await quitarPareoCxp(mov.id);
      if (!r.ok) throw new Error(r.error ?? "No se pudo liberar el movimiento");
    }
    if (ordenadas.length) {
      await aplicarPareoCxp({
        mov,
        terceroId: (ordenadas[0].tercero_id ?? mov.tercero_id ?? null) as string,
        cxps: ordenadas,
        userId: user.id,
      });
    }
  };

  /** Mueve una factura a un movimiento (o la libera si destino === null). */
  const moverFactura = async (cxpId: string, destinoMovId: string | null) => {
    const cxp = (cxps ?? []).find((c) => c.id === cxpId);
    if (!cxp) return;
    if (!cxp.transaccion_id) return toast.error("La factura no tiene transacción asociada.");
    const origen = movsDelProveedor.find((mv) => cxpsDeMov(mv.id).some((c) => c.id === cxpId)) ?? null;
    if (origen && origen.id === destinoMovId) return;
    const destino = destinoMovId ? movsDelProveedor.find((mv) => mv.id === destinoMovId) ?? null : null;
    if (destinoMovId && !destino) return;

    setBusy(true);
    try {
      if (origen) {
        await aplicarConjunto(
          origen,
          cxpsDeMov(origen.id).filter((c) => c.id !== cxpId),
        );
      }
      if (destino) {
        await aplicarConjunto(destino, [...cxpsDeMov(destino.id), cxp]);
      }
      toast.success(destino ? "Factura asignada al movimiento" : "Factura liberada");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo mover la factura");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Igual que moverFactura, pero NO quita el vínculo que la factura ya tenga
   * con otro movimiento — se usa para dividir el pago de una factura entre
   * 2 o 3 movimientos distintos (una factura grande pagada en varias partes).
   */
  const agregarFacturaAOtroMovimiento = async (cxpId: string, destinoMovId: string) => {
    const cxp = (cxps ?? []).find((c) => c.id === cxpId);
    if (!cxp) return;
    if (!cxp.transaccion_id) return toast.error("La factura no tiene transacción asociada.");
    const destino = movsDelProveedor.find((mv) => mv.id === destinoMovId) ?? null;
    if (!destino) return;
    if (cxpsDeMov(destino.id).some((c) => c.id === cxpId)) return; // ya está ahí

    setBusy(true);
    try {
      await aplicarConjunto(destino, [...cxpsDeMov(destino.id), cxp]);
      toast.success("Factura agregada también a este movimiento (pago dividido)");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo agregar la factura");
    } finally {
      setBusy(false);
    }
  };

  /** Libera todas las facturas de un movimiento. */
  const liberarMov = async (mov: any) => {
    setBusy(true);
    try {
      if (esPagoDirecto(mov)) {
        const r = await liberarPagoDirecto(mov, cxpsDeMov(mov.id));
        if (!r.ok) throw new Error(r.error ?? "No se pudo liberar");
      } else {
        const r = await quitarPareoCxp(mov.id);
        if (!r.ok) throw new Error(r.error ?? "No se pudo liberar");
      }
      toast.success("Movimiento liberado");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo liberar");
    } finally {
      setBusy(false);
    }
  };

  const cambiarProveedorMov = async (movId: string, nuevo: string | null) => {
    const { error } = await supabase.from("transacciones").update({ tercero_id: nuevo } as any).eq("id", movId);
    if (error) return toast.error(error.message);
    toast.success(nuevo ? "Proveedor asignado al movimiento" : "Movimiento sin proveedor");
    await refrescar();
  };

  const cambiarProveedorFactura = async (cxp: any, nuevo: string | null) => {
    const nombre = nuevo
      ? (terceros ?? []).find((t) => t.id === nuevo)?.nombre_comercial ||
        (terceros ?? []).find((t) => t.id === nuevo)?.razon_social
      : null;
    const { error } = await supabase
      .from("cuentas_por_pagar")
      .update({ tercero_id: nuevo, proveedor: nombre } as any)
      .eq("id", cxp.id);
    if (error) return toast.error(error.message);
    if (cxp.transaccion_id) {
      await supabase.from("transacciones").update({ tercero_id: nuevo } as any).eq("id", cxp.transaccion_id);
    }
    toast.success("Proveedor de la factura actualizado");
    await refrescar();
  };

  /** Parea automáticamente los movimientos sin facturas cuyo monto coincide con una sola factura. */
  const parearEvidentes = async () => {
    if (!user) return;
    const disponibles = facturasSinMov.filter((c) => c.estado !== "pagada" && c.transaccion_id);
    const usados = new Set<string>();
    let n = 0;
    setBusy(true);
    try {
      for (const mv of movsSinFacturas) {
        const monto = Math.abs(Number(mv.monto_bs) || 0);
        const cands = disponibles.filter(
          (c) => !usados.has(c.id) && dentroDeTolerancia(Math.abs(pendienteBsHistorico(c) - monto), monto),
        );
        if (cands.length !== 1) continue;
        await aplicarConjunto(mv, [cands[0]]);
        usados.add(cands[0].id);
        n++;
      }
      toast[n ? "success" : "info"](n ? `${n} movimiento(s) pareado(s)` : "No hay coincidencias evidentes");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al parear");
    } finally {
      setBusy(false);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    if (!active.startsWith("cxp:")) return;
    const cxpId = active.slice(4);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    if (over === BANDEJA) return void moverFactura(cxpId, null);
    if (over.startsWith("mov:")) return void moverFactura(cxpId, over.slice(4));
  };
  const onResumenClick = (tipo: "movs-sin-factura" | "facturas-sin-mov") => {
    if (focusResumen === tipo) {
      setFocusResumen(null);
      setFiltroEstado("todos");
    } else {
      setFocusResumen(tipo);
      if (tipo === "movs-sin-factura") {
        setFiltroEstado("sin-facturas");
      } else {
        setFiltroEstado("todos");
        setTimeout(() => document.getElementById("bandeja-facturas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    }
  };
  const exportar = async () => {
    const filas = movsFiltrados.map((mv) => {

      const { lista, montoMov, aplicado, sinAplicar } = resumenMov(mv);
      return {
        tipo: "Movimiento",
        fecha: fmtDate(mv.fecha),
        banco: bancoDeReferencia(mv.referencia) || "—",
        referencia: String(mv.referencia ?? ""),
        concepto: String(mv.notas ?? mv.detalle ?? ""),
        bs: montoMov,
        usd: usdBcvDeMov(mv),
        estado: lista.length ? (sinAplicar > 0.01 ? "Parcial" : "Pareado") : "Sin facturas",
        aplicado,
        remanente: sinAplicar,
        facturas: lista
          .map((c) => {
            const em = emisionDeCxp(c);
            return `${c.numero_factura ?? "s/n"}${em ? ` (${fmtDate(em)})` : ""} ${fmtBs(Number(c.monto_bs) || 0)}`;
          })
          .join(" | "),
      };
    });
    const sinMov = facturasSinMov.map((c) => ({
      tipo: "Factura sin movimiento",
      fecha: emisionDeCxp(c) ? fmtDate(emisionDeCxp(c) as string) : "—",
      banco: "—",
      referencia: c.numero_factura ?? "s/n",
      concepto: c.proveedor ?? "",
      bs: Number(c.monto_bs) || 0,
      usd: usdBcvFactura(c),
      estado: c.estado,
      aplicado: 0,
      remanente: pendienteBsHistorico(c),
      facturas: "",
    }));

    await exportTableToExcel({
      filename: `conciliacion-${nombreProveedor.replace(/\s+/g, "-").toLowerCase()}.xlsx`,
      sheetName: "Conciliación",
      columns: [
        { header: "Tipo", key: "tipo", width: 22 },
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Banco", key: "banco", width: 14 },
        { header: "Referencia / N° factura", key: "referencia", width: 28 },
        { header: "Concepto", key: "concepto", width: 40 },
        { header: "Monto Bs", key: "bs", width: 16, fmt: "bs" },
        { header: "Monto USD BCV", key: "usd", width: 16, fmt: "usd" },
        { header: "Estado", key: "estado", width: 14 },
        { header: "Aplicado Bs", key: "aplicado", width: 16, fmt: "bs" },
        { header: "Sin aplicar / Pendiente Bs", key: "remanente", width: 22, fmt: "bs" },
        { header: "Facturas asignadas", key: "facturas", width: 60 },
      ],
      rows: [...filas, ...sinMov],
    });
    toast.success("Excel generado");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/proveedores"><ArrowLeft className="h-4 w-4 mr-1" />Proveedores</Link>
          </Button>
          <h1 className="text-xl font-semibold">{nombreProveedor}</h1>
          {proveedorActual?.estado_registro === "candidato" && (
            <Badge variant="outline" className="text-amber-600 border-amber-600/40">Pendiente de verificar</Badge>
          )}
          {proveedorActual?.origen_registro && proveedorActual.origen_registro !== "desconocido" && (
            <Badge variant="secondary" className="text-[10px]">
              {ORIGEN_LABEL[proveedorActual.origen_registro] ?? proveedorActual.origen_registro}
            </Badge>
          )}
        </div>
        {proveedorActual?.estado_registro === "candidato" && !registrando && (
          <Button size="sm" variant="outline" onClick={abrirRegistro}>Registrar oficialmente</Button>
        )}
      </div>
      {proveedorActual?.estado_registro === "candidato" && registrando && (
        <Card>
          <CardContent className="pt-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Razón social</Label>
              <Input value={rifForm.razon_social} onChange={(e) => setRifForm({ ...rifForm, razon_social: e.target.value })} placeholder="Nombre del proveedor" className="w-56" />
            </div>
            <div>
              <Label className="text-xs">Nombre comercial (opcional)</Label>
              <Input value={rifForm.nombre_comercial} onChange={(e) => setRifForm({ ...rifForm, nombre_comercial: e.target.value })} placeholder="Como se conoce comúnmente" className="w-56" />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={rifForm.tipo_rif} onValueChange={(v) => setRifForm({ ...rifForm, tipo_rif: v })}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["J", "V", "E", "G"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">RIF</Label>
              <Input value={rifForm.rif} onChange={(e) => setRifForm({ ...rifForm, rif: e.target.value })} placeholder="12345678-9" className="w-40" />
            </div>
            <Button size="sm" variant="secondary" onClick={guardarSoloNombre}>Guardar solo nombre</Button>
            <Button size="sm" onClick={registrarOficialmente}>Registrar con RIF</Button>
            <Button size="sm" variant="ghost" onClick={() => setRegistrando(false)}>Cancelar</Button>
          </CardContent>
        </Card>
      )}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos ({movsDelProveedor.length})</SelectItem>
              <SelectItem value="sin-facturas">Sin facturas ({movsSinFacturas.length})</SelectItem>
              <SelectItem value="con-facturas">
                Con facturas ({movsDelProveedor.length - movsSinFacturas.length})
              </SelectItem>
              <SelectItem value="con-remanente">Con remanente sin aplicar</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Buscar movimiento o factura…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-56"
          />
          <Button variant="outline" size="sm" onClick={parearEvidentes} disabled={busy}>
            <Wand2 className="h-4 w-4 mr-1" />Parear lo evidente
          </Button>
          <Button variant="outline" size="sm" onClick={exportar}>
            <Download className="h-4 w-4 mr-1" />Excel
          </Button>
        </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Movimientos</div>
            <div className="text-lg font-semibold">{movsDelProveedor.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Sin facturas asignadas</div>
            <div className="text-lg font-semibold">{movsSinFacturas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Facturas sin movimiento</div>
            <div className="text-lg font-semibold">{facturasSinMov.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Sin aplicar (USD BCV)</div>
            <div className="text-lg font-semibold mono">{fmtUsd(totalSinAplicarUsd)}</div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${focusResumen === "facturas-sin-mov" ? "ring-2 ring-primary" : ""}`}
          onClick={() => onResumenClick("facturas-sin-mov")}
        >
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Facturas sin movimiento (USD BCV)</div>
            <div className="text-lg font-semibold mono">{fmtUsd(totalUsdBcvFacturasSinMov)}</div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${focusResumen === "movs-sin-factura" ? "ring-2 ring-primary" : ""}`}
          onClick={() => onResumenClick("movs-sin-factura")}
        >
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Movimientos sin factura (USD BCV)</div>
            <div className="text-lg font-semibold mono">{fmtUsd(totalUsdBcvMovsSinFactura)}</div>
          </CardContent>
        </Card>
      </div>


      <p className="text-sm text-muted-foreground">
        Arrastra una factura al movimiento bancario que la paga. Un movimiento puede tener varias facturas; arrastra la
        factura a la bandeja de la derecha para liberarla.
      </p>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr] items-start">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Movimientos bancarios <Badge variant="secondary">{movsFiltrados.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {movsFiltrados.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin movimientos para este filtro.</p>
              )}
              {movsFiltrados.map((mv) => {
                const { lista, montoMov, aplicado, sinAplicar, aplicadoUsd, sinAplicarUsd, aplicadoPorCxp } = resumenMov(mv);
                const asignables = facturasSinMov.filter((c) => c.transaccion_id);
                // Facturas que YA están en otro movimiento de este proveedor,
                // pero todavía tienen saldo pendiente: se pueden agregar TAMBIÉN
                // aquí para dividir su pago entre varios movimientos.
                const facturasParaDividir = (cxps ?? []).filter(
                  (c) =>
                    c.transaccion_id &&
                    c.estado !== "pagada" &&
                    pendienteUsdBcv(c) > 0.01 &&
                    !cxpsDeMov(mv.id).some((x) => x.id === c.id) &&
                    movsDelProveedor.some((m) => m.id !== mv.id && cxpsDeMov(m.id).some((x) => x.id === c.id)),
                );
                return (
                  <Zona key={mv.id} id={`mov:${mv.id}`} className="border rounded-md p-3 cursor-pointer hover:bg-muted/20" onClick={() => setEditandoMov(mv)}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-medium">{fmtDate(mv.fecha)}</span>{" "}
                        <span className="text-muted-foreground">{bancoDeReferencia(mv.referencia) || "banco"}</span>
                        <div className="text-xs">
                          <span className="mono font-medium">{fmtBs(montoMov)}</span>{" "}
                          <span className="mono text-muted-foreground">{fmtUsd(usdBcvDeMov(mv))} USD BCV</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Aplicado {fmtUsd(aplicadoUsd)} USD BCV ·{" "}
                          {sinAplicarUsd > 0.01 ? (
                            <span className="font-bold text-foreground">Sin aplicar {fmtUsd(sinAplicarUsd)} USD BCV</span>
                          ) : (
                            <>Sin aplicar {fmtUsd(sinAplicarUsd)} USD BCV</>
                          )}{" "}
                          · {lista.length} factura(s)
                        </div>
                        <div className="text-xs text-muted-foreground break-words">
                          {mv.notas ?? mv.detalle ?? ""}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Badge
                          variant={!lista.length ? "destructive" : sinAplicar > 0.01 ? "default" : "secondary"}
                        >
                          {!lista.length ? "Sin facturas" : sinAplicar > 0.01 ? "Parcial" : "Pareado"}
                        </Badge>
                        <Select
                          value={mv.tercero_id ?? "none"}
                          onValueChange={(v) => cambiarProveedorMov(mv.id, v === "none" ? null : v)}
                        >
                          <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin proveedor</SelectItem>
                            {(terceros ?? []).map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.nombre_comercial || t.razon_social}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {lista.length > 0 && (
                          <Button variant="ghost" size="sm" onClick={() => liberarMov(mv)} disabled={busy}>
                            <Link2Off className="h-3.5 w-3.5 mr-1" />Liberar todo
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditandoMov(mv)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />Editar
                        </Button>
                        {lista.length === 0 ? (
                          <Select
                            value={estadoManualDeMov(mv.id) ?? "auto"}
                            onValueChange={(v) => cambiarEstadoManual(mv.id, v === "auto" ? null : (v as EstadoManual))}
                          >
                            <SelectTrigger className="h-7 w-[190px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Automático (sugerido)</SelectItem>
                              {(Object.keys(ESTADO_MANUAL_LABEL) as EstadoManual[]).map((k) => (
                                <SelectItem key={k} value={k}>{ESTADO_MANUAL_LABEL[k]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Para cambiar el estado a mano, primero quita el pareo.</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                      {lista.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          Sin facturas asignadas — suelta aquí una factura…
                        </p>
                      ) : (
                        lista.map((c) => (
                          <FacturaChip
                            key={c.id}
                            cxp={c}
                            emision={emisionDeCxp(c)}
                            aplicadoBs={aplicadoPorCxp.get(c.id)}
                            disabled={busy}
                            onQuitar={() => moverFactura(c.id, null)}
                            onEditar={() => setEditandoFactura(c)}
                          />
                        ))
                      )}
                      {(asignables.length > 0 || facturasParaDividir.length > 0) && (
                        <Select
                          onValueChange={(v) => {
                            const [accion, id] = v.split(":");
                            if (accion === "dividir") agregarFacturaAOtroMovimiento(id, mv.id);
                            else moverFactura(id, mv.id);
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs w-64 mt-1">
                            <SelectValue placeholder="Agregar factura…" />
                          </SelectTrigger>
                          <SelectContent>
                            {asignables.map((c) => (
                              <SelectItem key={c.id} value={`mover:${c.id}`}>
                                {c.numero_factura ?? "s/n"} · {fmtBs(pendienteBsHistorico(c))}
                              </SelectItem>
                            ))}
                            {facturasParaDividir.length > 0 && (
                              <>
                                <div className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                                  Dividir pago (ya asignadas a otro movimiento)
                                </div>
                                {facturasParaDividir.map((c) => (
                                  <SelectItem key={`div-${c.id}`} value={`dividir:${c.id}`}>
                                    {c.numero_factura ?? "s/n"} · {fmtUsd(pendienteUsdBcv(c))} USD BCV pendiente
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </Zona>
                );
              })}
            </CardContent>
          </Card>

          <Card id="bandeja-facturas">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Facturas sin movimiento <Badge variant="destructive">{facturasSinMov.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Zona id={BANDEJA} className="space-y-2 min-h-24 border border-dashed rounded-md p-2">
                {facturasSinMov.length === 0 && (
                  <p className="text-xs text-muted-foreground">Todas las facturas tienen movimiento asignado.</p>
                )}
                {facturasSinMov.map((c) => (
                  <div key={c.id} className="space-y-1">
                    <FacturaChip cxp={c} emision={emisionDeCxp(c)} disabled={busy} onEditar={() => setEditandoFactura(c)} />
                    <div className="flex gap-2">
                      <Select onValueChange={(v) => moverFactura(c.id, v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Asignar a movimiento…" />
                        </SelectTrigger>
                        <SelectContent>
                          {movsDelProveedor.map((mv) => (
                            <SelectItem key={mv.id} value={mv.id}>
                              {fmtDate(mv.fecha)} · {fmtBs(Math.abs(Number(mv.monto_bs) || 0))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={c.tercero_id ?? "none"}
                        onValueChange={(v) => cambiarProveedorFactura(c, v === "none" ? null : v)}
                      >
                        <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin proveedor</SelectItem>
                          {(terceros ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.nombre_comercial || t.razon_social}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Pendiente {fmtBs(pendienteBsHistorico(c))} · {fmtUsd(pendienteUsdBcv(c))} USD BCV
                    </div>
                  </div>
                ))}
              </Zona>
            </CardContent>
          </Card>
        </div>
      </DndContext>
      {editandoFactura && (
        <FacturaDetalleDialog
          factura={editandoFactura}
          onClose={() => setEditandoFactura(null)}
          onSaved={async () => { setEditandoFactura(null); await refrescar(); }}
        />
      )}
      {editandoMov && (
        <EditDialog
          tx={editandoMov}
          onClose={() => setEditandoMov(null)}
          onSaved={async () => { setEditandoMov(null); await refrescar(); }}
        />
      )}
    </div>
  );
}
