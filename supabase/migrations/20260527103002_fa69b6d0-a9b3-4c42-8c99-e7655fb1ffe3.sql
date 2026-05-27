ALTER TABLE public.inventario_snapshots
  ADD COLUMN IF NOT EXISTS fecha date,
  ADD COLUMN IF NOT EXISTS tasa_bcv numeric,
  ADD COLUMN IF NOT EXISTS tercero_id uuid,
  ADD COLUMN IF NOT EXISTS numero_factura text,
  ADD COLUMN IF NOT EXISTS pagada boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cuenta_bancaria_id uuid,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento date,
  ADD COLUMN IF NOT EXISTS cxp_id uuid,
  ADD COLUMN IF NOT EXISTS notas text;