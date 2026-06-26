DROP VIEW IF EXISTS public.v_transacciones_mensual;

CREATE VIEW public.v_transacciones_mensual
WITH (security_invoker = true)
AS
SELECT
  to_char(t.fecha::timestamptz, 'YYYY-MM') AS periodo,
  EXTRACT(year FROM t.fecha)::integer AS anio,
  EXTRACT(month FROM t.fecha)::integer AS mes,
  t.cuenta_codigo,
  t.centro_costo,
  t.modo,
  sum(t.monto_base_bs) AS base_bs,
  sum(t.iva_bs) AS iva_bs,
  sum(t.monto_bs) AS total_bs,
  sum(
    t.monto_base_bs / NULLIF(COALESCE(t.tasa_paralela, t.tasa_bcv), 0::numeric)
  ) AS base_usd,
  sum(
    t.monto_bs / NULLIF(COALESCE(t.tasa_paralela, t.tasa_bcv), 0::numeric)
  ) AS total_usd,
  count(*) AS movimientos
FROM public.transacciones t
GROUP BY
  to_char(t.fecha::timestamptz, 'YYYY-MM'),
  EXTRACT(year FROM t.fecha)::integer,
  EXTRACT(month FROM t.fecha)::integer,
  t.cuenta_codigo,
  t.centro_costo,
  t.modo;

GRANT SELECT ON public.v_transacciones_mensual TO authenticated;
GRANT SELECT ON public.v_transacciones_mensual TO service_role;