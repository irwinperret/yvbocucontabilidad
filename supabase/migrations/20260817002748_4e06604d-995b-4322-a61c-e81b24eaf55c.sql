ALTER TABLE public.conciliacion_bancaria DROP CONSTRAINT IF EXISTS conciliacion_bancaria_estado_check;
ALTER TABLE public.conciliacion_bancaria ADD CONSTRAINT conciliacion_bancaria_estado_check
  CHECK (estado IN ('pareado','parcial','rechazado','no_aplica','sin_pareo','gasto_directo','no_contable'));

-- Migrar marcas manuales 'no_aplica' según la naturaleza de la cuenta del movimiento
UPDATE public.conciliacion_bancaria cb
SET estado = CASE
  WHEN t.cuenta_codigo IN ('98','99','14.1','14.3') THEN 'no_contable'
  ELSE 'gasto_directo'
END
FROM public.transacciones t
WHERE t.id = cb.transaccion_bancaria_id
  AND cb.transaccion_factura_id IS NULL
  AND cb.estado = 'no_aplica';

-- La cuenta 99 (POR DETERMINAR) no debe afectar reportes hasta reclasificarse
UPDATE public.plan_de_cuentas SET afecta_gyp = false, afecta_fc = false WHERE codigo = '99';