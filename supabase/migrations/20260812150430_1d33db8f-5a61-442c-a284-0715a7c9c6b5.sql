CREATE TABLE public._backup_bcv_next_20260812 (
  id uuid,
  tabla text NOT NULL,
  fecha date,
  tasa_bcv_anterior numeric,
  tasa_bcv_nueva numeric,
  extra jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._backup_bcv_next_20260812 TO authenticated;
GRANT ALL ON public._backup_bcv_next_20260812 TO service_role;
ALTER TABLE public._backup_bcv_next_20260812 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backup bcv solo lectura autenticados" ON public._backup_bcv_next_20260812 FOR SELECT TO authenticated USING (true);