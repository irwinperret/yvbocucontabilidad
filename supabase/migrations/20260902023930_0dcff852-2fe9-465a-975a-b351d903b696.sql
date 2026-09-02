ALTER TABLE public.cuentas_por_pagar
  ADD COLUMN IF NOT EXISTS cierre_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cierre_manual_motivo text,
  ADD COLUMN IF NOT EXISTS cierre_manual_nota text,
  ADD COLUMN IF NOT EXISTS cierre_manual_fecha date,
  ADD COLUMN IF NOT EXISTS cierre_manual_por uuid,
  ADD COLUMN IF NOT EXISTS cierre_manual_at timestamptz;