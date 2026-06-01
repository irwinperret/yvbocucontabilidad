
CREATE TABLE public.xetux_payment_map (
  forma_pago text PRIMARY KEY,
  cuenta_bancaria_id uuid REFERENCES public.cuentas_bancarias(id) ON DELETE SET NULL,
  metodo_pago text NOT NULL DEFAULT 'transferencia',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.xetux_payment_map TO authenticated;
GRANT ALL ON public.xetux_payment_map TO service_role;

ALTER TABLE public.xetux_payment_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "xetux_map_select" ON public.xetux_payment_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "xetux_map_admin_manage" ON public.xetux_payment_map FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER xetux_map_set_updated_at BEFORE UPDATE ON public.xetux_payment_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Evitar importar dos veces el mismo número de factura Xetux
CREATE UNIQUE INDEX IF NOT EXISTS trans_xetux_numero_factura_uq
  ON public.transacciones(numero_factura)
  WHERE referencia = 'xetux';
