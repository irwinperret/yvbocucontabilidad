-- Retroactivo: para gastos/facturas/COGS registrados como CxP (metodo_pago='pendiente'),
-- recalcular monto_usd usando tasa_paralela (USD contable) en lugar de tasa_bcv.
-- El valor en USD BCV (deuda) se conserva en cuentas_por_pagar.usd_bcv_factura.

UPDATE public.transacciones
SET monto_usd = round((monto_bs / tasa_paralela)::numeric, 2)
WHERE metodo_pago = 'pendiente'
  AND tasa_paralela IS NOT NULL
  AND tasa_paralela > 0
  AND monto_bs > 0
  AND abs(monto_usd - round((monto_bs / tasa_paralela)::numeric, 2)) > 0.02;

-- Sincronizar cuentas_por_pagar.usd_paralelo_factura (referencia contable paralela)
-- cuando exista tasa_paralela_factura.
UPDATE public.cuentas_por_pagar
SET usd_paralelo_factura = round((monto_bs / tasa_paralela_factura)::numeric, 2)
WHERE tasa_paralela_factura IS NOT NULL
  AND tasa_paralela_factura > 0
  AND monto_bs > 0
  AND (usd_paralelo_factura IS NULL
       OR abs(usd_paralelo_factura - round((monto_bs / tasa_paralela_factura)::numeric, 2)) > 0.02);