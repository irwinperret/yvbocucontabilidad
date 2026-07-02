
-- Promover a los 2 usuarios adicionales a admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users
WHERE email IN ('irwinperret@gmail.com','castillo_iris@yahoo.com')
ON CONFLICT (user_id, role) DO NOTHING;

-- Quitar rol 'usuario' de los recién promovidos (opcional, mantener limpio)
DELETE FROM public.user_roles ur
USING auth.users u
WHERE ur.user_id = u.id
  AND u.email IN ('irwinperret@gmail.com','castillo_iris@yahoo.com')
  AND ur.role = 'usuario'::app_role;

-- === Endurecer políticas de escritura: solo admins ===

-- transacciones
DROP POLICY IF EXISTS trans_insert_own ON public.transacciones;
DROP POLICY IF EXISTS trans_update_admin_or_note ON public.transacciones;
CREATE POLICY trans_insert_admin ON public.transacciones FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND auth.uid() = created_by);
CREATE POLICY trans_update_admin ON public.transacciones FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- cuentas_por_cobrar
DROP POLICY IF EXISTS cxc_insert ON public.cuentas_por_cobrar;
DROP POLICY IF EXISTS cxc_update ON public.cuentas_por_cobrar;
CREATE POLICY cxc_insert_admin ON public.cuentas_por_cobrar FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY cxc_update_admin ON public.cuentas_por_cobrar FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- cuentas_por_pagar
DROP POLICY IF EXISTS cxp_insert ON public.cuentas_por_pagar;
DROP POLICY IF EXISTS cxp_update ON public.cuentas_por_pagar;
CREATE POLICY cxp_insert_admin ON public.cuentas_por_pagar FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY cxp_update_admin ON public.cuentas_por_pagar FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- prestamos
DROP POLICY IF EXISTS prestamos_insert ON public.prestamos;
DROP POLICY IF EXISTS prestamos_update ON public.prestamos;
CREATE POLICY prestamos_insert_admin ON public.prestamos FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY prestamos_update_admin ON public.prestamos FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- propinas
DROP POLICY IF EXISTS propinas_insert ON public.propinas;
CREATE POLICY propinas_insert_admin ON public.propinas FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND auth.uid() = created_by);

-- inventario_snapshots
DROP POLICY IF EXISTS inv_insert ON public.inventario_snapshots;
CREATE POLICY inv_insert_admin ON public.inventario_snapshots FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND auth.uid() = registrado_por);

-- tasas_bcv
DROP POLICY IF EXISTS tasas_bcv_insert ON public.tasas_bcv;
CREATE POLICY tasas_bcv_insert_admin ON public.tasas_bcv FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND (auth.uid() = registrado_por OR registrado_por IS NULL));

-- tasas_paralela
DROP POLICY IF EXISTS tasas_paralela_insert ON public.tasas_paralela;
CREATE POLICY tasas_paralela_insert_admin ON public.tasas_paralela FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND (auth.uid() = registrado_por OR registrado_por IS NULL));

-- terceros
DROP POLICY IF EXISTS terceros_insert ON public.terceros;
DROP POLICY IF EXISTS terceros_update ON public.terceros;
CREATE POLICY terceros_insert_admin ON public.terceros FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY terceros_update_admin ON public.terceros FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ajustes_bancarios
DROP POLICY IF EXISTS ajustes_bancarios_insert ON public.ajustes_bancarios;
CREATE POLICY ajustes_bancarios_insert_admin ON public.ajustes_bancarios FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND auth.uid() = registrado_por);
