CREATE OR REPLACE FUNCTION public.tasa_bcv_para_fecha(_fecha date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT tasa FROM public.tasas_bcv WHERE fecha >= _fecha ORDER BY fecha ASC LIMIT 1),
    (SELECT tasa FROM public.tasas_bcv WHERE fecha <= _fecha ORDER BY fecha DESC LIMIT 1)
  );
$$;