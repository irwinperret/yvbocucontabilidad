
CREATE TABLE IF NOT EXISTS public.cuentas_bancarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  banco TEXT NOT NULL,
  numero TEXT NOT NULL,
  titular TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'BS' CHECK (moneda IN ('BS','USD')),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cuentas_bancarias TO authenticated;
GRANT ALL ON public.cuentas_bancarias TO service_role;

ALTER TABLE public.cuentas_bancarias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cuentas_bancarias_all_auth" ON public.cuentas_bancarias
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_cuentas_bancarias_updated
  BEFORE UPDATE ON public.cuentas_bancarias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS cuenta_bancaria_id UUID REFERENCES public.cuentas_bancarias(id);

CREATE INDEX IF NOT EXISTS idx_transacciones_cuenta_bancaria ON public.transacciones(cuenta_bancaria_id);
