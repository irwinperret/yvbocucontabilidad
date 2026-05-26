
ALTER VIEW public.v_gyp_mes_actual SET (security_invoker = true);
ALTER VIEW public.v_fc_mes_actual SET (security_invoker = true);
ALTER VIEW public.v_cxc_activas SET (security_invoker = true);
ALTER VIEW public.v_off_balance_pendientes SET (security_invoker = true);

ALTER FUNCTION public.set_updated_at() SET search_path = public;
