ALTER TABLE public.cuentas_por_pagar
  ADD COLUMN IF NOT EXISTS en_espera_movimiento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS en_espera_por uuid,
  ADD COLUMN IF NOT EXISTS en_espera_en timestamptz;
