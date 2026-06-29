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
      ELSE monto_base_bs / NULLIF(COALESCE(tasa_paralela, tasa_bcv), 0::numeric)
    END
  ) AS base_usd,
  sum(
    CASE
      WHEN metodo_pago = 'pendiente' THEN 0::numeric
      ELSE monto_bs / NULLIF(COALESCE(tasa_paralela, tasa_bcv), 0::numeric)
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