import { supabase as defaultClient } from "@/integrations/supabase/client";

/**
 * Tasa BCV aplicable a una fecha.
 *
 * Regla (agosto 2026): si la fecha no tiene tasa publicada (fin de semana o
 * feriado), se usa la **próxima** tasa BCV posterior a esa fecha. Solo si no
 * existe ninguna tasa posterior se cae a la última tasa anterior, para no
 * dejar movimientos sin tasa.
 *
 * Devuelve `{ data }` con la misma forma que una consulta de supabase para que
 * los llamadores puedan sustituir la consulta directa sin cambiar su código.
 */
export async function tasaBcvQuery(
  fecha: string,
  cols = "fecha, tasa",
  client: any = defaultClient,
): Promise<{ data: any }> {
  const next = await client
    .from("tasas_bcv")
    .select(cols)
    .gte("fecha", fecha)
    .order("fecha", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (next?.data) return { data: next.data };
  const prev = await client
    .from("tasas_bcv")
    .select(cols)
    .lte("fecha", fecha)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: prev?.data ?? null };
}

/** Valor numérico de la tasa BCV aplicable a la fecha (0 si no hay ninguna). */
export async function tasaBcvParaFecha(fecha: string, client?: any): Promise<number> {
  const { data } = await tasaBcvQuery(fecha, "tasa", client);
  return Number(data?.tasa) || 0;
}
