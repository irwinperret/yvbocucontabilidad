ALTER TABLE public.conciliacion_bancaria
  DROP CONSTRAINT IF EXISTS conciliacion_bancaria_transaccion_bancaria_id_key;

ALTER TABLE public.conciliacion_bancaria
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'manual';

ALTER TABLE public.conciliacion_bancaria
  DROP CONSTRAINT IF EXISTS conciliacion_bancaria_origen_check;
ALTER TABLE public.conciliacion_bancaria
  ADD CONSTRAINT conciliacion_bancaria_origen_check CHECK (origen IN ('auto','manual'));

CREATE UNIQUE INDEX IF NOT EXISTS conciliacion_bancaria_mov_fact_uq
  ON public.conciliacion_bancaria (transaccion_bancaria_id, COALESCE(transaccion_factura_id, '00000000-0000-0000-0000-000000000000'::uuid));