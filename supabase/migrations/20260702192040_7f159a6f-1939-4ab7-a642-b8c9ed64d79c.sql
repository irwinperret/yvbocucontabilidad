
CREATE OR REPLACE VIEW public.v_transacciones_mensual_bcv AS
SELECT
  to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
  (EXTRACT(year FROM fecha))::integer AS anio,
  (EXTRACT(month FROM fecha))::integer AS mes,
  cuenta_codigo,
  centro_costo,
  modo,
  sum(monto_base_bs) AS base_bs,
  sum(iva_bs) AS iva_bs,
  sum(monto_bs) AS total_bs,
  sum(
    CASE
      WHEN (cuenta_codigo = '13.2'::text) OR (notas ~~* 'Pago CxP%'::text) THEN 0::numeric
      WHEN COALESCE(monto_bs, 0::numeric) = 0::numeric THEN 0::numeric
      WHEN COALESCE(tasa_bcv, 0::numeric) = 0::numeric THEN 0::numeric
      ELSE (COALESCE(monto_base_bs, monto_bs) / tasa_bcv)
    END
  ) AS base_usd,
  sum(
    CASE
      WHEN metodo_pago = 'pendiente'::metodo_pago THEN 0::numeric
      WHEN COALESCE(monto_bs, 0::numeric) = 0::numeric THEN 0::numeric
      WHEN COALESCE(tasa_bcv, 0::numeric) = 0::numeric THEN 0::numeric
      ELSE (monto_bs / tasa_bcv)
    END
  ) AS total_usd,
  count(*) AS movimientos
FROM transacciones t
GROUP BY
  to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text),
  (EXTRACT(year FROM fecha))::integer,
  (EXTRACT(month FROM fecha))::integer,
  cuenta_codigo, centro_costo, modo;

GRANT SELECT ON public.v_transacciones_mensual_bcv TO authenticated;
GRANT ALL ON public.v_transacciones_mensual_bcv TO service_role;
