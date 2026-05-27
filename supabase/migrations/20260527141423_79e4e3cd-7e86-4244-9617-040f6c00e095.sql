ALTER TABLE public.cuentas_por_cobrar ADD COLUMN IF NOT EXISTS monto_pendiente_usd numeric;
UPDATE public.cuentas_por_cobrar SET monto_pendiente_usd = CASE WHEN estado='cobrada' THEN 0 ELSE monto_usd END WHERE monto_pendiente_usd IS NULL;
ALTER TABLE public.cuentas_por_cobrar ALTER COLUMN monto_pendiente_usd SET DEFAULT 0;