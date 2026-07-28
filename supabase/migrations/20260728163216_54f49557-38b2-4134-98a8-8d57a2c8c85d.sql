ALTER VIEW public.v_transacciones_mensual SET (security_invoker = true);
ALTER VIEW public.v_transacciones_mensual_bcv SET (security_invoker = true);

ALTER TABLE public._recalc_bcv_backup_20260618 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._recalc_bcv_backup_20260618 FROM anon;
GRANT SELECT ON public._recalc_bcv_backup_20260618 TO authenticated;
GRANT ALL ON public._recalc_bcv_backup_20260618 TO service_role;
CREATE POLICY "backup_select_admin" ON public._recalc_bcv_backup_20260618
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));