CREATE TABLE IF NOT EXISTS public.importaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  archivo_nombre text NOT NULL,
  archivo_tamano bigint,
  fecha_desde date,
  fecha_hasta date,
  filas_leidas integer NOT NULL DEFAULT 0,
  filas_registradas integer NOT NULL DEFAULT 0,
  filas_omitidas integer NOT NULL DEFAULT 0,
  total_bs numeric NOT NULL DEFAULT 0,
  total_usd numeric NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'activa',
  meta jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid REFERENCES auth.users(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.importaciones TO authenticated;
GRANT ALL ON public.importaciones TO service_role;

ALTER TABLE public.importaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS importaciones_select ON public.importaciones;
CREATE POLICY importaciones_select ON public.importaciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS importaciones_insert_admin ON public.importaciones;
CREATE POLICY importaciones_insert_admin ON public.importaciones FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS importaciones_update_admin ON public.importaciones;
CREATE POLICY importaciones_update_admin ON public.importaciones FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS importaciones_delete_admin ON public.importaciones;
CREATE POLICY importaciones_delete_admin ON public.importaciones FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS importaciones_updated_at ON public.importaciones;
CREATE TRIGGER importaciones_updated_at BEFORE UPDATE ON public.importaciones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.transacciones ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.importaciones(id) ON DELETE SET NULL;
ALTER TABLE public.cuentas_por_pagar ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.importaciones(id) ON DELETE SET NULL;
ALTER TABLE public.cuentas_por_cobrar ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.importaciones(id) ON DELETE SET NULL;
ALTER TABLE public.propinas ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.importaciones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transacciones_import_batch ON public.transacciones(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_cxp_import_batch ON public.cuentas_por_pagar(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_cxc_import_batch ON public.cuentas_por_cobrar(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_propinas_import_batch ON public.propinas(import_batch_id);

ALTER TABLE public.cuentas_por_pagar
  ADD COLUMN IF NOT EXISTS revert_batch_id uuid REFERENCES public.importaciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revert_estado_anterior text,
  ADD COLUMN IF NOT EXISTS revert_pendiente_bs_anterior numeric,
  ADD COLUMN IF NOT EXISTS revert_pendiente_usd_bcv_anterior numeric,
  ADD COLUMN IF NOT EXISTS revert_pagada_at_anterior timestamptz;

CREATE INDEX IF NOT EXISTS idx_cxp_revert_batch ON public.cuentas_por_pagar(revert_batch_id);