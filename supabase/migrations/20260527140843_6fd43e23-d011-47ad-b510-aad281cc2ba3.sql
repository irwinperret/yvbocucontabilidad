ALTER TABLE public.cuentas_por_cobrar ADD COLUMN IF NOT EXISTS monto_pendiente_bs numeric;
UPDATE public.cuentas_por_cobrar SET monto_pendiente_bs = CASE WHEN estado = 'cobrada' THEN 0 ELSE monto_bs END WHERE monto_pendiente_bs IS NULL;
ALTER TABLE public.cuentas_por_cobrar ALTER COLUMN monto_pendiente_bs SET DEFAULT 0;