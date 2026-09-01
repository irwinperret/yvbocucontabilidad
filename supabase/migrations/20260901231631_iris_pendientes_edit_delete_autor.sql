-- Permite que el autor de una nota de Iris pueda editarla (ya se podía a
-- nivel de base, solo faltaba en la UI) y borrarla (nuevo). La política de
-- DELETE para admin (iris_pendientes_delete_admin) se mantiene: con RLS,
-- varias políticas del mismo comando se combinan con OR, así que ahora
-- puede borrar una nota su autor O un admin.
DROP POLICY IF EXISTS "iris_pendientes_delete_autor" ON public.iris_pendientes;
CREATE POLICY "iris_pendientes_delete_autor" ON public.iris_pendientes
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

NOTIFY pgrst, 'reload schema';
