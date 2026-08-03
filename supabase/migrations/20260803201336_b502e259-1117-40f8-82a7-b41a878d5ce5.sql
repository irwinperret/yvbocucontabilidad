ALTER TABLE public.cuentas_por_pagar ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'manual';

-- Backfill existing CxP that come from Xetux imports
UPDATE public.cuentas_por_pagar c
SET origen = 'xetux'
FROM public.transacciones t
WHERE c.transaccion_id = t.id AND t.referencia = 'xetux';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cuentas_por_pagar TO authenticated;
GRANT ALL ON public.cuentas_por_pagar TO service_role;

ALTER TABLE public.cuentas_por_pagar ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before re-adding (idempotent)
DROP POLICY IF EXISTS "Users can view payables" ON public.cuentas_por_pagar;
DROP POLICY IF EXISTS "Users can create payables" ON public.cuentas_por_pagar;
DROP POLICY IF EXISTS "Users can update payables" ON public.cuentas_por_pagar;
DROP POLICY IF EXISTS "Users can delete payables" ON public.cuentas_por_pagar;

CREATE POLICY "Users can view payables" ON public.cuentas_por_pagar FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create payables" ON public.cuentas_por_pagar FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update payables" ON public.cuentas_por_pagar FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can delete payables" ON public.cuentas_por_pagar FOR DELETE TO authenticated USING (true);
