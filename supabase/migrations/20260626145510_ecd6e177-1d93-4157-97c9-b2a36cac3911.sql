
ALTER TABLE public.cuentas_por_pagar
  ADD COLUMN IF NOT EXISTS usd_bcv_factura numeric,
  ADD COLUMN IF NOT EXISTS usd_paralelo_factura numeric,
  ADD COLUMN IF NOT EXISTS tasa_bcv_factura numeric,
  ADD COLUMN IF NOT EXISTS tasa_paralela_factura numeric,
  ADD COLUMN IF NOT EXISTS monto_pendiente_usd_bcv numeric;
