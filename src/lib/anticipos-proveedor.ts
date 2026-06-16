import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AnticipoProveedor = {
  id: string;
  fecha: string;
  tercero_id: string | null;
  monto_bs: number;
  monto_usd: number;
  tasa_paralela: number | null;
  tasa_bcv: number;
  cuenta_bancaria_id: string | null;
  notas: string | null;
  anticipo_estado: "abierto" | "parcialmente_aplicado" | "aplicado" | null;
  anticipo_aplicado_usd: number;
};

export function saldoAnticipo(a: AnticipoProveedor): number {
  return +(Number(a.monto_usd) - Number(a.anticipo_aplicado_usd || 0)).toFixed(2);
}

export function useAnticiposAbiertosProveedor(terceroId: string | null | undefined) {
  return useQuery({
    queryKey: ["anticipos-abiertos", terceroId],
    enabled: !!terceroId,
    queryFn: async (): Promise<AnticipoProveedor[]> => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, tercero_id, monto_bs, monto_usd, tasa_paralela, tasa_bcv, cuenta_bancaria_id, notas, anticipo_estado, anticipo_aplicado_usd")
        .eq("cuenta_codigo", "14.2")
        .eq("tercero_id", terceroId!)
        .in("anticipo_estado", ["abierto", "parcialmente_aplicado"])
        .order("fecha", { ascending: true });
      return (data ?? []) as any;
    },
  });
}

export function useAnticiposProveedor(desde: string, hasta: string) {
  return useQuery({
    queryKey: ["anticipos-proveedor", desde, hasta],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("id, fecha, tercero_id, monto_bs, monto_usd, tasa_paralela, tasa_bcv, cuenta_bancaria_id, notas, anticipo_estado, anticipo_aplicado_usd, grupo_transaccion_id")
        .eq("cuenta_codigo", "14.2")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      return (data ?? []) as any[];
    },
  });
}

/**
 * Aplica un anticipo (o múltiples) contra una factura.
 * - Inserta una transacción de reversión en cuenta 14.2 por cada anticipo aplicado (monto negativo USD).
 * - Actualiza anticipo_aplicado_usd y anticipo_estado en el anticipo original.
 * - Vincula todo vía grupo_transaccion_id.
 *
 * Llamar DESPUÉS de insertar la factura. Pasa grupoId compartido y created_by.
 */
export async function aplicarAnticiposContraFactura(opts: {
  aplicaciones: { anticipo: AnticipoProveedor; aplicarUsd: number }[];
  grupoId: string;
  facturaFecha: string;
  facturaProveedorNombre: string;
  facturaNumero: string | null;
  created_by: string;
  centro: string;
}): Promise<{ ok: boolean; error?: string }> {
  for (const a of opts.aplicaciones) {
    const aplicar = Math.min(a.aplicarUsd, saldoAnticipo(a.anticipo));
    if (aplicar <= 0) continue;

    const { error } = await (supabase as any).rpc("aplicar_anticipo_a_factura", {
      anticipo_id: a.anticipo.id,
      aplicar_usd: aplicar,
      grupo_id: opts.grupoId,
      factura_fecha: opts.facturaFecha,
      factura_proveedor: opts.facturaProveedorNombre,
      factura_numero: opts.facturaNumero,
      centro: opts.centro,
    });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
