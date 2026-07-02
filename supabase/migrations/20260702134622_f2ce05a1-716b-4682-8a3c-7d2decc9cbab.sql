CREATE OR REPLACE VIEW public.v_transacciones_mensual AS
SELECT
  to_char(fecha::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
  EXTRACT(year FROM fecha)::integer AS anio,
  EXTRACT(month FROM fecha)::integer AS mes,
  cuenta_codigo,
  centro_costo,
  modo,
  sum(monto_base_bs) AS base_bs,
  sum(iva_bs) AS iva_bs,
  sum(monto_bs) AS total_bs,
  sum(
    CASE
      WHEN cuenta_codigo = '13.2' OR notas ILIKE 'Pago CxP%' THEN 0::numeric
      WHEN COALESCE(monto_bs, 0) = 0 THEN 0::numeric
      ELSE COALESCE(monto_usd, 0) * (COALESCE(monto_base_bs, monto_bs) / monto_bs)
    END
  ) AS base_usd,
  sum(
    CASE
      WHEN metodo_pago = 'pendiente' THEN 0::numeric
      ELSE COALESCE(monto_usd, 0)
    END
  ) AS total_usd,
  count(*) AS movimientos
FROM public.transacciones t
GROUP BY
  to_char(fecha::timestamp with time zone, 'YYYY-MM'::text),
  EXTRACT(year FROM fecha)::integer,
  EXTRACT(month FROM fecha)::integer,
  cuenta_codigo,
  centro_costo,
  modo;

GRANT SELECT ON public.v_transacciones_mensual TO authenticated;