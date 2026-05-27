ALTER TABLE public.inventario_snapshots
  ADD COLUMN IF NOT EXISTS iva_aplica boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS iva_bs numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_base_bs numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS modo modo_transaccion NOT NULL DEFAULT 'on_balance';