
ALTER TABLE public.cuentas_bancarias
  ADD COLUMN IF NOT EXISTS saldo_inicial numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_inicial_fecha date;

CREATE TABLE public.ajustes_bancarios (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cuenta_bancaria_id uuid NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  monto numeric NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('error','robo','personal','otro')),
  notas text,
  registrado_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ajustes_bancarios TO authenticated;
GRANT ALL ON public.ajustes_bancarios TO service_role;

ALTER TABLE public.ajustes_bancarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ajustes_bancarios_select"
  ON public.ajustes_bancarios FOR SELECT TO authenticated USING (true);

CREATE POLICY "ajustes_bancarios_insert"
  ON public.ajustes_bancarios FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = registrado_por);

CREATE POLICY "ajustes_bancarios_update_admin"
  ON public.ajustes_bancarios FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ajustes_bancarios_delete_admin"
  ON public.ajustes_bancarios FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_ajustes_bancarios_cuenta ON public.ajustes_bancarios(cuenta_bancaria_id, fecha);
