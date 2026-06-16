REVOKE EXECUTE ON FUNCTION public.aplicar_anticipo_a_factura(uuid, numeric, uuid, date, text, text, centro_costo) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.aplicar_anticipo_a_factura(uuid, numeric, uuid, date, text, text, centro_costo) FROM anon;
GRANT EXECUTE ON FUNCTION public.aplicar_anticipo_a_factura(uuid, numeric, uuid, date, text, text, centro_costo) TO authenticated;