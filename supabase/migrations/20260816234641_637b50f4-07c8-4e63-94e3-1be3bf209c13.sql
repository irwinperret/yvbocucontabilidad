ALTER TABLE public.conciliacion_bancaria DROP CONSTRAINT IF EXISTS conciliacion_bancaria_estado_check;
ALTER TABLE public.conciliacion_bancaria ADD CONSTRAINT conciliacion_bancaria_estado_check
  CHECK (estado = ANY (ARRAY['pareado'::text,'parcial'::text,'rechazado'::text,'pendiente'::text,'no_aplica'::text,'sin_pareo'::text]));