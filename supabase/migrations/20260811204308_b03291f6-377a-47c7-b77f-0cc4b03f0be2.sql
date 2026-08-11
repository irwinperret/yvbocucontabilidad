ALTER TABLE public.conciliacion_bancaria
  ADD COLUMN IF NOT EXISTS facturas_rechazadas uuid[] NOT NULL DEFAULT '{}'::uuid[];