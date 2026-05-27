
-- 1) Tabla de tasas paralelas (espejo de tasas_bcv)
CREATE TABLE public.tasas_paralela (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha date NOT NULL UNIQUE,
  tasa numeric NOT NULL,
  registrado_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.tasas_paralela TO authenticated;
GRANT ALL ON public.tasas_paralela TO service_role;

ALTER TABLE public.tasas_paralela ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasas_paralela_select" ON public.tasas_paralela
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tasas_paralela_insert" ON public.tasas_paralela
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = registrado_por OR registrado_por IS NULL);

CREATE POLICY "tasas_paralela_update_admin" ON public.tasas_paralela
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Columna tasa_paralela en transacciones (off-balance, informativa)
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS tasa_paralela numeric;

CREATE INDEX IF NOT EXISTS idx_transacciones_tasa_paralela
  ON public.transacciones (fecha)
  WHERE tasa_paralela IS NOT NULL;
