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

-- Permisos base de la tabla (además de RLS): sin esto, Postgres/PostgREST
-- se comporta como si la tabla no existiera para el rol authenticated.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.iris_pendientes TO authenticated;
GRANT ALL ON public.iris_pendientes TO service_role;

ALTER TABLE public.iris_pendientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iris_pendientes_select" ON public.iris_pendientes;
CREATE POLICY "iris_pendientes_select" ON public.iris_pendientes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "iris_pendientes_insert" ON public.iris_pendientes;
CREATE POLICY "iris_pendientes_insert" ON public.iris_pendientes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "iris_pendientes_update" ON public.iris_pendientes;
CREATE POLICY "iris_pendientes_update" ON public.iris_pendientes
  FOR UPDATE TO authenticated USING (true);

-- Solo un admin (según el sistema de roles real de esta base, has_role +
-- app_role) puede borrar notas. La pantalla de Iris normalmente solo las
-- marca como resueltas, nunca las borra.
DROP POLICY IF EXISTS "iris_pendientes_delete_admin" ON public.iris_pendientes;
CREATE POLICY "iris_pendientes_delete_admin" ON public.iris_pendientes
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
