
-- 1. Nuevas cuentas IVA, bono alimentación, e impuestos
INSERT INTO public.plan_de_cuentas (codigo, nombre, grupo, afecta_gyp, afecta_fc, orden, activa, centros_permitidos) VALUES
  ('1.9',  'IVA débito fiscal cobrado',  'IVA',          false, true, 19,  true, NULL),
  ('2.3',  'IVA crédito fiscal pagado',  'IVA',          false, true, 23,  true, NULL),
  ('3.20', 'Bono de alimentación',       'Nomina',       true,  true, 320, true, NULL),
  ('12.1', 'Impuestos municipales',      'Impuestos',    true,  true, 1201, true, NULL),
  ('12.2', 'Pago IVA al SENIAT',         'Impuestos',    false, true, 1202, true, NULL),
  ('12.3', 'ISLR',                       'Impuestos',    true,  true, 1203, true, NULL)
ON CONFLICT (codigo) DO NOTHING;

-- 2. Tabla propinas
CREATE TABLE IF NOT EXISTS public.propinas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id uuid REFERENCES public.transacciones(id) ON DELETE SET NULL,
  fecha date NOT NULL,
  monto_usd numeric(18,2) NOT NULL,
  monto_bs numeric(18,2),
  tasa_paralela numeric(18,6),
  centro_costo centro_costo,
  concepto text,
  referencia text,
  numero_factura text,
  numero_orden text,
  notas text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.propinas TO authenticated;
GRANT ALL ON public.propinas TO service_role;

ALTER TABLE public.propinas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "propinas_select" ON public.propinas FOR SELECT TO authenticated USING (true);
CREATE POLICY "propinas_insert" ON public.propinas FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "propinas_update_admin" ON public.propinas FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "propinas_delete_admin" ON public.propinas FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_propinas_fecha ON public.propinas(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_propinas_tx ON public.propinas(transaccion_id);

-- 3. inventario_snapshots: monto_usd + tasa_paralela (USD = fuente de verdad)
ALTER TABLE public.inventario_snapshots
  ADD COLUMN IF NOT EXISTS monto_usd numeric(18,2),
  ADD COLUMN IF NOT EXISTS monto_base_usd numeric(18,2),
  ADD COLUMN IF NOT EXISTS iva_usd numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tasa_paralela numeric(18,6);

-- 4. transacciones: grupo_transaccion_id para enlazar IVA/bono/venta
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS grupo_transaccion_id uuid;

CREATE INDEX IF NOT EXISTS idx_transacciones_grupo ON public.transacciones(grupo_transaccion_id) WHERE grupo_transaccion_id IS NOT NULL;
