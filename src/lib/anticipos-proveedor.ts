import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AnticipoProveedor = {
  id: string;
  fecha: string;
  tercero_id: string | null;
  monto_bs: number;
  monto_usd: number; // paralelo (contable)
  anticipo_usd_bcv: number; // snapshot USD BCV congelado al pago
  anticipo_aplicado_usd_bcv: number;
  tasa_paralela: number | null;
  tasa_bcv: number;
  cuenta_bancaria_id: string | null;
  notas: string | null;
  anticipo_estado: "abierto" | "parcialmente_aplicado" | "aplicado" | null;
  anticipo_aplicado_usd: number; // legado, mantener por compatibilidad
};

const SELECT_FIELDS =
  "id, fecha, tercero_id, monto_bs, monto_usd, anticipo_usd_bcv, anticipo_aplicado_usd_bcv, tasa_paralela, tasa_bcv, cuenta_bancaria_id, notas, anticipo_estado, anticipo_aplicado_usd";

// Saldo del anticipo expresado en USD BCV (deuda del proveedor con nosotros, congelada)
export function saldoAnticipo(a: AnticipoProveedor): number {
  const total = Number(a.anticipo_usd_bcv) || 0;
  const aplicado = Number(a.anticipo_aplicado_usd_bcv) || 0;
  return +(total - aplicado).toFixed(2);
}

export function useAnticiposAbiertosProveedor(terceroId: string | null | undefined) {
  return useQuery({
    queryKey: ["anticipos-abiertos", terceroId],
    enabled: !!terceroId,
    queryFn: async (): Promise<AnticipoProveedor[]> => {
      const { data } = await supabase
        .from("transacciones")
        .select(SELECT_FIELDS)
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
        .select(SELECT_FIELDS + ", grupo_transaccion_id")
        .eq("cuenta_codigo", "14.2")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      return (data ?? []) as any[];
    },
  });
}

/**
 * Aplica uno o más anticipos contra una factura. Las cantidades se expresan en USD BCV
 * (deuda congelada del proveedor con nosotros). El RPC del backend:
 *   - calcula reverso Bs = aplicarUsdBcv × tasa BCV de la factura
 *   - inserta el reverso en 14.2 con monto_usd contable en USD paralelo
 *   - actualiza anticipo_aplicado_usd_bcv y anticipo_estado
 *   - NO emite diferencial cambiario (el proveedor absorbe la variación BCV)
 */
// Valores válidos del enum `centro_costo` en la BD: 'YV' | 'Bocu' | 'Compartido'.
export type CentroCosto = "YV" | "Bocu" | "Compartido";

// Firma exacta esperada por la función SQL `public.aplicar_anticipo_a_factura`.
// Si cambia en la BD, actualizar este tipo para que el typecheck rompa en compilación
// en vez de fallar en runtime con "function not found in schema cache".
type AplicarAnticipoArgs = {
  anticipo_id: string;
  aplicar_usd_bcv: number;
  grupo_id: string;
  factura_fecha: string;
  factura_proveedor: string;
  factura_numero: string | null;
  centro: CentroCosto;
};

export async function aplicarAnticiposContraFactura(opts: {
  aplicaciones: { anticipo: AnticipoProveedor; aplicarUsdBcv: number }[];
  grupoId: string;
  facturaFecha: string;
  facturaProveedorNombre: string;
  facturaNumero: string | null;
  created_by: string;
  centro: CentroCosto;
}): Promise<{ ok: boolean; error?: string }> {
  for (const a of opts.aplicaciones) {
    const aplicar = Math.min(a.aplicarUsdBcv, saldoAnticipo(a.anticipo));
    if (aplicar <= 0) continue;

    const args: AplicarAnticipoArgs = {
      anticipo_id: a.anticipo.id,
      aplicar_usd_bcv: aplicar,
      grupo_id: opts.grupoId,
      factura_fecha: opts.facturaFecha,
      factura_proveedor: opts.facturaProveedorNombre,
      factura_numero: opts.facturaNumero,
      centro: opts.centro,
    };

    const { error } = await (supabase.rpc as any)("aplicar_anticipo_a_factura", args);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
