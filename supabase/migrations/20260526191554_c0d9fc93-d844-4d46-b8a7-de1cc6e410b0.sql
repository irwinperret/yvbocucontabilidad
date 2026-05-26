
-- 1. AUDITORIA: remove client insert policy
DROP POLICY IF EXISTS audit_insert ON public.auditoria;

-- 2. CIERRES DE MES: restrict insert to admin
DROP POLICY IF EXISTS cierres_insert ON public.cierres_de_mes;
CREATE POLICY cierres_insert_admin ON public.cierres_de_mes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = registrado_por AND public.has_role(auth.uid(), 'admin'));

-- 3. CUENTAS BANCARIAS: admin-only writes, all authenticated can read
DROP POLICY IF EXISTS cuentas_bancarias_all_auth ON public.cuentas_bancarias;
CREATE POLICY cuentas_bancarias_select ON public.cuentas_bancarias
  FOR SELECT TO authenticated USING (true);
CREATE POLICY cuentas_bancarias_insert_admin ON public.cuentas_bancarias
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY cuentas_bancarias_update_admin ON public.cuentas_bancarias
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY cuentas_bancarias_delete_admin ON public.cuentas_bancarias
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4. CUENTAS POR PAGAR: authenticated read/insert/update, admin delete
DROP POLICY IF EXISTS cxp_all ON public.cuentas_por_pagar;
CREATE POLICY cxp_select ON public.cuentas_por_pagar FOR SELECT TO authenticated USING (true);
CREATE POLICY cxp_insert ON public.cuentas_por_pagar FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cxp_update ON public.cuentas_por_pagar FOR UPDATE TO authenticated USING (true);
CREATE POLICY cxp_delete_admin ON public.cuentas_por_pagar FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 5. CUENTAS POR COBRAR
DROP POLICY IF EXISTS cxc_all ON public.cuentas_por_cobrar;
CREATE POLICY cxc_select ON public.cuentas_por_cobrar FOR SELECT TO authenticated USING (true);
CREATE POLICY cxc_insert ON public.cuentas_por_cobrar FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cxc_update ON public.cuentas_por_cobrar FOR UPDATE TO authenticated USING (true);
CREATE POLICY cxc_delete_admin ON public.cuentas_por_cobrar FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 6. PRESTAMOS
DROP POLICY IF EXISTS prestamos_all ON public.prestamos;
CREATE POLICY prestamos_select ON public.prestamos FOR SELECT TO authenticated USING (true);
CREATE POLICY prestamos_insert ON public.prestamos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY prestamos_update ON public.prestamos FOR UPDATE TO authenticated USING (true);
CREATE POLICY prestamos_delete_admin ON public.prestamos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 7. INVENTARIO SNAPSHOTS
DROP POLICY IF EXISTS inv_all ON public.inventario_snapshots;
CREATE POLICY inv_select ON public.inventario_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY inv_insert ON public.inventario_snapshots FOR INSERT TO authenticated WITH CHECK (auth.uid() = registrado_por);
CREATE POLICY inv_update_admin ON public.inventario_snapshots FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY inv_delete_admin ON public.inventario_snapshots FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 8. TERCEROS
DROP POLICY IF EXISTS terceros_all_authenticated ON public.terceros;
CREATE POLICY terceros_select ON public.terceros FOR SELECT TO authenticated USING (true);
CREATE POLICY terceros_insert ON public.terceros FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY terceros_update ON public.terceros FOR UPDATE TO authenticated USING (true);
CREATE POLICY terceros_delete_admin ON public.terceros FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 9. Revoke EXECUTE on internal SECURITY DEFINER functions from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_auditoria(text, text, uuid, jsonb, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.periodo_cerrado(date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;
