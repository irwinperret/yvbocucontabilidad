CREATE OR REPLACE FUNCTION public.tiene_acceso_app(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;
REVOKE EXECUTE ON FUNCTION public.tiene_acceso_app(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.tiene_acceso_app(uuid) TO authenticated;

-- New signups no longer get automatic access; an admin must assign a role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, nombre)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nombre', NEW.email));
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('_backup_bcv_next_20260812','backup bcv solo lectura autenticados'),
    ('_backup_pagos_bank_20260816','Lectura autenticada respaldo pagos'),
    ('ajustes_bancarios','ajustes_bancarios_select'),
    ('bono10_propina','bonos10_select'),
    ('cierres_de_mes','cierres_select'),
    ('conciliacion_bancaria','conciliacion_select'),
    ('cuentas_bancarias','cuentas_bancarias_select'),
    ('cuentas_por_cobrar','cxc_select'),
    ('cuentas_por_pagar','cxp_select'),
    ('importaciones','importaciones_select'),
    ('inventario_snapshots','inv_select'),
    ('iris_pendientes','iris_pendientes_select'),
    ('plan_de_cuentas','plan_cuentas_select'),
    ('prestamos','prestamos_select'),
    ('proyecciones_mensuales','proyecciones_select'),
    ('resumen_mensual_notas','rmn_select'),
    ('tasas_bcv','tasas_bcv_select'),
    ('tasas_paralela','tasas_paralela_select'),
    ('terceros','terceros_select'),
    ('transacciones','trans_select_all'),
    ('xetux_payment_map','xetux_map_select')
  ) AS t(tbl, pol) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.tiene_acceso_app(auth.uid()))', r.pol, r.tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS iris_pendientes_update ON public.iris_pendientes;
CREATE POLICY iris_pendientes_update ON public.iris_pendientes FOR UPDATE TO authenticated
  USING (public.tiene_acceso_app(auth.uid())) WITH CHECK (public.tiene_acceso_app(auth.uid()));

DROP POLICY IF EXISTS rmn_insert ON public.resumen_mensual_notas;
DROP POLICY IF EXISTS rmn_update ON public.resumen_mensual_notas;
DROP POLICY IF EXISTS rmn_delete ON public.resumen_mensual_notas;
CREATE POLICY rmn_insert ON public.resumen_mensual_notas FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY rmn_update ON public.resumen_mensual_notas FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY rmn_delete ON public.resumen_mensual_notas FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS facturas_select_authenticated ON storage.objects;
CREATE POLICY facturas_select_authenticated ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'facturas' AND (((auth.uid())::text = (storage.foldername(name))[1]) OR public.tiene_acceso_app(auth.uid())));
DROP POLICY IF EXISTS facturas_update_owner_or_admin ON storage.objects;
CREATE POLICY facturas_update_owner_or_admin ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'facturas' AND (((auth.uid())::text = (storage.foldername(name))[1]) OR public.has_role(auth.uid(),'admin')))
  WITH CHECK (bucket_id = 'facturas' AND (((auth.uid())::text = (storage.foldername(name))[1]) OR public.has_role(auth.uid(),'admin')));