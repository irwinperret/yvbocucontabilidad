BEGIN;
DROP INDEX IF EXISTS public.trans_xetux_numero_factura_cuenta_uq;
CREATE UNIQUE INDEX trans_xetux_numero_factura_cuenta_uq
  ON public.transacciones USING btree (
    numero_factura,
    cuenta_codigo,
    (CASE WHEN notas ILIKE '%Bono 10%' THEN 'bono' WHEN notas ILIKE '%Propina%' THEN 'propina' ELSE '' END)
  )
  WHERE (referencia = 'xetux'::text);
COMMIT;