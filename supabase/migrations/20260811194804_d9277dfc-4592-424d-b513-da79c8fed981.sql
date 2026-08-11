DROP INDEX IF EXISTS public.conciliacion_bancaria_mov_fact_uq;

CREATE UNIQUE INDEX conciliacion_bancaria_mov_fact_uq
  ON public.conciliacion_bancaria (transaccion_bancaria_id, transaccion_factura_id)
  NULLS NOT DISTINCT;

ALTER TABLE public.conciliacion_bancaria
  DROP CONSTRAINT IF EXISTS conciliacion_bancaria_estado_check;

ALTER TABLE public.conciliacion_bancaria
  ADD CONSTRAINT conciliacion_bancaria_estado_check
  CHECK (estado = ANY (ARRAY['pareado'::text, 'parcial'::text, 'rechazado'::text, 'pendiente'::text]));