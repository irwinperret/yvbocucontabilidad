CREATE OR REPLACE VIEW public.v_transacciones_mensual AS
SELECT
  to_char(t.fecha::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
  EXTRACT(year FROM t.fecha)::integer AS anio,
  EXTRACT(month FROM t.fecha)::integer AS mes,
  t.cuenta_codigo,
  t.centro_costo,
  t.modo,
  sum(t.monto_base_bs) AS base_bs,
  sum(t.iva_bs) AS iva_bs,
  sum(t.monto_bs) AS total_bs,
  sum(
    CASE
      WHEN t.cuenta_codigo = '13.2' OR t.notas ILIKE 'Pago CxP%' THEN 0::numeric
      ELSE t.monto_base_bs / NULLIF(COALESCE(t.tasa_paralela, t.tasa_bcv), 0::numeric)
    END
  ) AS base_usd,
  sum(
    CASE
      WHEN t.notas ILIKE 'Pago CxP%' THEN t.monto_bs / NULLIF(COALESCE(t.tasa_paralela, t.tasa_bcv), 0::numeric)
      WHEN t.metodo_pago = 'pendiente' THEN 0::numeric
      WHEN t.grupo_transaccion_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.transacciones p
          WHERE p.grupo_transaccion_id = t.grupo_transaccion_id
            AND p.metodo_pago = 'pendiente'
        )
      THEN 0::numeric
      ELSE t.monto_bs / NULLIF(COALESCE(t.tasa_paralela, t.tasa_bcv), 0::numeric)
    END
  ) AS total_usd,
  count(*) AS movimientos
FROM public.transacciones t
GROUP BY
  to_char(t.fecha::timestamp with time zone, 'YYYY-MM'::text),
  EXTRACT(year FROM t.fecha)::integer,
  EXTRACT(month FROM t.fecha)::integer,
  t.cuenta_codigo,
  t.centro_costo,
  t.modo;