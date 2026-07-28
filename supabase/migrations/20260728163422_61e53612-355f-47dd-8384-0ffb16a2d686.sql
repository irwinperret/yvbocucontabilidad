ALTER FUNCTION public.enforce_anticipo_iva_rules() SET search_path = public;
ALTER FUNCTION public.get_analisis_snapshot(text) SET search_path = public;
ALTER FUNCTION public.get_analisis_snapshot(text, text) SET search_path = public;

REVOKE ALL ON FUNCTION public.enforce_anticipo_proveedor_currency() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_anticipo_iva_rules() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_analisis_snapshot(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_analisis_snapshot(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aplicar_anticipo_a_factura(uuid, numeric, uuid, date, text, text, centro_costo) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_analisis_snapshot(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_analisis_snapshot(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_anticipo_a_factura(uuid, numeric, uuid, date, text, text, centro_costo) TO authenticated, service_role;