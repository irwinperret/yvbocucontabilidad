import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

/**
 * Después de insertar una transacción "principal" (venta o compra) con IVA,
 * crea la contrapartida de IVA enlazada por grupo_transaccion_id.
 *
 * Modelo: cada transacción con IVA se divide en 2 filas:
 *  - principal: monto_bs = base, iva_bs = 0, iva_aplica = false
 *  - leg IVA: cuenta_codigo = "12.4" (débito, ventas) ó "12.5" (crédito, compras),
 *             monto_bs = iva_bs, iva_bs = 0
 *
 * Las cuentas 12.4 / 12.5 viven en el grupo Impuestos. Solo afectan FC (no G&P).
 */
export type IvaLegInput = {
  fecha: string;
  centro_costo: any;
  modo: any;
  monto_bs_iva: number;
  monto_usd_iva: number;
  tasa_bcv: number | null;
  tasa_paralela: number | null;
  tercero_id?: string | null;
  numero_factura?: string | null;
  numero_orden?: string | null;
  cuenta_bancaria_id?: string | null;
  referencia?: string | null;
  notas?: string | null;
  created_by: string;
  grupo_transaccion_id: string;
  tipo: "debito" | "credito"; // débito = venta (12.4), crédito = compra (12.5)
};

export async function insertIvaLeg(input: IvaLegInput) {
  if (input.monto_bs_iva <= 0) return null;
  const cuenta = input.tipo === "debito" ? "12.4" : "12.5";
  const notasBase = input.tipo === "debito" ? "IVA débito" : "IVA crédito";
  const { data, error } = await supabase.from("transacciones").insert({
    fecha: input.fecha,
    cuenta_codigo: cuenta,
    centro_costo: input.centro_costo,
    modo: input.modo,
    monto_bs: input.monto_bs_iva,
    monto_base_bs: input.monto_bs_iva,
    iva_bs: 0,
    iva_aplica: false,
    tipo_iva: null,
    monto_usd: input.monto_usd_iva,
    tasa_bcv: input.tasa_bcv ?? 1,
    tasa_paralela: input.tasa_paralela ?? null,
    tercero_id: input.tercero_id ?? null,
    numero_factura: input.numero_factura ?? null,
    numero_orden: input.numero_orden ?? null,
    cuenta_bancaria_id: input.cuenta_bancaria_id ?? null,
    referencia: input.referencia ?? null,
    notas: `${notasBase} · ${input.notas ?? ""}`.trim().replace(/·\s*$/, "").trim(),
    created_by: input.created_by,
    grupo_transaccion_id: input.grupo_transaccion_id,
  } as any).select().single();
  if (error) {
    console.error("insertIvaLeg failed", error);
    return null;
  }
  if (data) await logAudit("transacciones", "INSERT", (data as any).id, null, data);
  return data;
}

/**
 * Borra cualquier leg IVA previamente asociado a una transacción principal
 * (mismo grupo_transaccion_id, cuenta 12.4/12.5). Útil para re-importaciones.
 */
export async function deleteIvaLegsByGrupo(grupoId: string | null | undefined) {
  if (!grupoId) return;
  await supabase
    .from("transacciones")
    .delete()
    .eq("grupo_transaccion_id", grupoId)
    .in("cuenta_codigo", ["12.4", "12.5"]);
}

