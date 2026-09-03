ALTER TABLE public.iris_pendientes
  ADD COLUMN IF NOT EXISTS seguimiento text,
  ADD COLUMN IF NOT EXISTS seguimiento_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS seguimiento_by uuid;
