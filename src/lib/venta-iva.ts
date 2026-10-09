import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import type { Centro } from "@/lib/account-helpers";

/**
 * "Venta de IVA" (6to input mensual): un ingreso neto puro, registrado una
 * vez al mes como monto en USD a tasa BCV, igual que el inventario final.
 * Se registra directo en la cuenta 1.8 ("Ingresos (Neto) Ops IVA"), que ya
 * está marcada afecta_gyp=true y afecta_fc=true en el plan de cuentas, y ya
 * está incluida en CUENTAS_INGRESO_GYP (flujo-caja.ts) -- así que un simple
 * insert on_balance en 1.8 ya cuenta correctamente en G&P y Flujo de Caja,
 * sin tocar ninguna otra fórmula.
 *
 * No lleva cuenta_bancaria_id: no es un depósito bancario rastreable, es un
 * estimado mensual (igual que el inventario), así que no debe aparecer en
 * Saldos Bancarios como si fuera un movimiento real de banco.
 *
 * Reemplaza al tab "Ops IVA" que existía en Registrar, que insertaba en la
 * misma cuenta 1.8 pero con modo "off_balance" (nunca llegó a contar en G&P
 * ni FC -- quedaba pendiente de una confirmación manual que nunca se hacía).
 * No había datos reales cargados con ese formulario viejo.
 */
export const CUENTA_VENTA_IVA = "1.8";
export const DETALLE_VENTA_IVA = "Venta de IVA (ingreso neto Ops IVA)";

export type VentaIvaRow = {
  id: string;
  fecha: string;
  monto_usd: number;
  monto_bs: number;
  tasa_bcv: number;
  centro_costo: string;
  notas: string | null;
};

export function periodoDeFecha(fecha: string): string {
  return fecha.slice(0, 7);
}

function periodoABounds(periodo: string): { desde: string; hasta: string } {
  const [y, m] = periodo.split("-").map(Number);
  const desde = `${periodo}-01`;
  const hasta = new Date(y, m, 0).toISOString().slice(0, 10);
  return { desde, hasta };
}

/** Todos los registros de Venta de IVA, más reciente primero. */
export async function listarVentaIva(): Promise<VentaIvaRow[]> {
  const { data, error } = await supabase
    .from("transacciones")
    .select("id, fecha, monto_usd, monto_bs, tasa_bcv, centro_costo, notas")
    .eq("cuenta_codigo", CUENTA_VENTA_IVA)
    .order("fecha", { ascending: false });
  if (error) throw error;
  return (data ?? []) as any as VentaIvaRow[];
}

/** El registro de Venta de IVA de un período (YYYY-MM) dado, si existe. */
export async function fetchVentaIvaDelPeriodo(periodo: string): Promise<VentaIvaRow | null> {
  const { desde, hasta } = periodoABounds(periodo);
  const { data, error } = await supabase
    .from("transacciones")
    .select("id, fecha, monto_usd, monto_bs, tasa_bcv, centro_costo, notas")
    .eq("cuenta_codigo", CUENTA_VENTA_IVA)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

/**
 * Crea o actualiza (si se pasa `id`) el registro de Venta de IVA. Un solo
 * registro representa todo el mes -- si ya existe uno para el período, se
 * debe pasar su `id` para actualizarlo en vez de duplicar.
 */
export async function guardarVentaIva(args: {
  id?: string;
  fecha: string;
  montoUsd: number;
  tasaBcv: number;
  centro?: Centro;
  notas?: string | null;
  userId: string;
}): Promise<VentaIvaRow> {
  const { id, fecha, montoUsd, tasaBcv, centro = "Compartido", notas = null, userId } = args;
  const montoBs = +(montoUsd * tasaBcv).toFixed(2);
  const payload = {
    fecha,
    cuenta_codigo: CUENTA_VENTA_IVA,
    centro_costo: centro as any,
    monto_bs: montoBs,
    monto_base_bs: montoBs,
    iva_bs: 0,
    iva_aplica: false,
    tipo_iva: null,
    tasa_bcv: tasaBcv,
    tasa_paralela: null,
    monto_usd: +montoUsd.toFixed(2),
    metodo_pago: null,
    cuenta_bancaria_id: null,
    referencia: null,
    detalle: DETALLE_VENTA_IVA,
    notas,
    modo: "on_balance" as any,
    created_by: userId,
  };
  if (id) {
    const { data: antes } = await supabase.from("transacciones").select("*").eq("id", id).single();
    const { data: tx, error } = await supabase.from("transacciones").update(payload as any).eq("id", id).select().single();
    if (error) throw error;
    if (tx) await logAudit("transacciones", "UPDATE", id, antes, tx);
    return tx as any;
  }
  const { data: tx, error } = await supabase.from("transacciones").insert(payload as any).select().single();
  if (error) throw error;
  if (tx) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);
  return tx as any;
}

export async function borrarVentaIva(id: string): Promise<void> {
  const { data: antes } = await supabase.from("transacciones").select("*").eq("id", id).single();
  const { error } = await supabase.from("transacciones").delete().eq("id", id);
  if (error) throw error;
  if (antes) await logAudit("transacciones", "DELETE", id, antes, null);
}
