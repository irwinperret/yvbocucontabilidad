-- Tabla de notas / pendientes de seguimiento para la pantalla Iris.
CREATE TABLE IF NOT EXISTS public.iris_pendientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  texto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'resuelta')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  resuelta_at TIMESTAMPTZ,
  resuelta_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.iris_pendientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iris_pendientes_select" ON public.iris_pendientes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "iris_pendientes_insert" ON public.iris_pendientes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "iris_pendientes_update" ON public.iris_pendientes
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "iris_pendientes_delete_admin" ON public.iris_pendientes
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
