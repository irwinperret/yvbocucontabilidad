DELETE FROM public.conciliacion_bancaria
WHERE id IN ('2351f935-e619-4251-b42e-871e4b4ed6d8','679de8ce-4a6e-4096-b6e9-f644def3f047');

UPDATE public.cuentas_por_pagar
SET estado = 'pendiente',
    monto_pendiente_bs = 29186.39,
    monto_pendiente_usd_bcv = 55.99,
    pagada_at = NULL
WHERE id = '18d18fe4-5c91-4c2b-8372-a31cfde02f20';

UPDATE public.cuentas_por_pagar
SET estado = 'pendiente',
    monto_pendiente_bs = 41898.27,
    monto_pendiente_usd_bcv = 75.00,
    pagada_at = NULL
WHERE id = '99ae7e9f-be8d-481a-97f2-de0e0338748f';