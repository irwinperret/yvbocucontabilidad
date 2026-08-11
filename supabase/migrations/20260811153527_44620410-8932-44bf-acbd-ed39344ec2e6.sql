CREATE TABLE public.conciliacion_bancaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_bancaria_id uuid NOT NULL REFERENCES public.transacciones(id) ON DELETE CASCADE,
  transaccion_factura_id uuid REFERENCES public.transacciones(id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pareado','rechazado','pendiente')),
  confirmado_por uuid REFERENCES auth.users(id),
  confirmado_en timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaccion_bancaria_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conciliacion_bancaria TO authenticated;
GRANT ALL ON public.conciliacion_bancaria TO service_role;

ALTER TABLE public.conciliacion_bancaria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conciliacion_select" ON public.conciliacion_bancaria
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "conciliacion_insert" ON public.conciliacion_bancaria
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "conciliacion_update" ON public.conciliacion_bancaria
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "conciliacion_delete" ON public.conciliacion_bancaria
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_conciliacion_banco ON public.conciliacion_bancaria(transaccion_bancaria_id);
CREATE INDEX idx_conciliacion_factura ON public.conciliacion_bancaria(transaccion_factura_id);

CREATE TRIGGER conciliacion_bancaria_updated_at
  BEFORE UPDATE ON public.conciliacion_bancaria
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();