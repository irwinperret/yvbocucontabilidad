
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS anticipo_estado text,
  ADD COLUMN IF NOT EXISTS anticipo_aplicado_usd numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE public.transacciones
  DROP CONSTRAINT IF EXISTS transacciones_anticipo_estado_check;
ALTER TABLE public.transacciones
  ADD CONSTRAINT transacciones_anticipo_estado_check
  CHECK (anticipo_estado IS NULL OR anticipo_estado IN ('abierto','parcialmente_aplicado','aplicado'));

CREATE INDEX IF NOT EXISTS idx_transacciones_anticipo_abierto
  ON public.transacciones (tercero_id, anticipo_estado)
  WHERE cuenta_codigo = '14.2' AND anticipo_estado IN ('abierto','parcialmente_aplicado');

ALTER TABLE public.inventario_snapshots
  ADD COLUMN IF NOT EXISTS grupo_transaccion_id uuid;

CREATE INDEX IF NOT EXISTS idx_inventario_snapshots_grupo
  ON public.inventario_snapshots (grupo_transaccion_id)
  WHERE grupo_transaccion_id IS NOT NULL;
