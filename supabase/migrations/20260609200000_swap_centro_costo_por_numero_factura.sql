-- Retroactive fix: swap centro_costo for ventas rows based on numero_factura
-- Rule: numero_factura >= 11000 -> YV, numero_factura < 11000 -> Bocu
-- Only affects rows where numero_factura is a pure integer (i.e. ventas imported from Xetux)
-- and where the centro_costo is currently wrong (either 'YV' or 'Bocu').

-- Step 1: facturas >= 11000 that are wrongly in 'Bocu' -> move to 'YV'
UPDATE public.transacciones
SET centro_costo = 'YV'
WHERE
  numero_factura ~ '^[0-9]+$'
  AND numero_factura::integer >= 11000
  AND centro_costo = 'Bocu';

-- Step 2: facturas < 11000 that are wrongly in 'YV' -> move to 'Bocu'
UPDATE public.transacciones
SET centro_costo = 'Bocu'
WHERE
  numero_factura ~ '^[0-9]+$'
  AND numero_factura::integer < 11000
  AND centro_costo = 'YV';
