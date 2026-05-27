CREATE POLICY cierres_update_admin ON public.cierres_de_mes
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY cierres_delete_admin ON public.cierres_de_mes
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));