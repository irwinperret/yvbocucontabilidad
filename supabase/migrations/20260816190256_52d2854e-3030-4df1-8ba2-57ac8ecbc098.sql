CREATE TABLE IF NOT EXISTS public._backup_pagos_bank_20260816 (
  id uuid PRIMARY KEY,
  numero bigint,
  fecha date,
  monto_bs_anterior numeric,
  monto_base_bs_anterior numeric,
  monto_usd_anterior numeric,
  monto_bs_nuevo numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._backup_pagos_bank_20260816 TO authenticated;
GRANT ALL ON public._backup_pagos_bank_20260816 TO service_role;
ALTER TABLE public._backup_pagos_bank_20260816 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura autenticada respaldo pagos"
ON public._backup_pagos_bank_20260816 FOR SELECT TO authenticated USING (true);