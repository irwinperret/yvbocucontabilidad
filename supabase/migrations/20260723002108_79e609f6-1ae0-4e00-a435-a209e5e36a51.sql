
CREATE OR REPLACE FUNCTION public.get_analisis_snapshot(p_periodo text, p_vista text DEFAULT 'paralela')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_from date;
  v_to date;
  v_prev_from date;
  v_prev_to date;
  v_prev2_from date;
  v_prev2_to date;
  v_result jsonb;
  v_bcv boolean := (lower(coalesce(p_vista,'paralela')) = 'bcv');
BEGIN
  v_from := date_trunc('month', to_date(p_periodo, 'YYYY-MM'))::date;
  v_to := (date_trunc('month', to_date(p_periodo, 'YYYY-MM')) + interval '1 month' - interval '1 day')::date;
  v_prev_from := (v_from - interval '1 month')::date;
  v_prev_to := (v_to - interval '1 month')::date;
  v_prev2_from := (v_from - interval '2 months')::date;
  v_prev2_to := (v_to - interval '2 months')::date;

  WITH tx AS (
    SELECT
      t.fecha, t.cuenta_codigo, t.modo, t.centro_costo, p.afecta_gyp,
      CASE
        WHEN v_bcv THEN
          CASE WHEN coalesce(t.tasa_bcv,0) > 0 THEN t.monto_bs / t.tasa_bcv ELSE t.monto_usd END
        ELSE t.monto_usd
      END AS usd_visual
    FROM public.transacciones t
    JOIN public.plan_de_cuentas p ON p.codigo = t.cuenta_codigo
    WHERE t.fecha BETWEEN v_prev2_from AND v_to
  )
  SELECT jsonb_build_object(
    'ingresos_usd', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '1.%' AND modo = 'on_balance' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'cogs_usd', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo = '2.2' THEN usd_visual ELSE 0 END),0)::numeric,2),
    'nomina_usd', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '3.%' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'gastos_admin_usd', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '4.%' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'gastos_operativos_usd', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '5.%' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'gastos_mercadeo_usd', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '6.%' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'gastos_generales_usd', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '9.%' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'ingresos_yv', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '1.%' AND modo='on_balance' AND centro_costo='YV' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'ingresos_bocu', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_from AND v_to AND cuenta_codigo LIKE '1.%' AND modo='on_balance' AND centro_costo='Bocu' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'ingresos_mes_anterior', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_prev_from AND v_prev_to AND cuenta_codigo LIKE '1.%' AND modo='on_balance' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2),
    'ingresos_hace_2_meses', ROUND(COALESCE(SUM(CASE WHEN fecha BETWEEN v_prev2_from AND v_prev2_to AND cuenta_codigo LIKE '1.%' AND modo='on_balance' AND afecta_gyp THEN usd_visual ELSE 0 END),0)::numeric,2)
  ) INTO v_result FROM tx;

  RETURN v_result;
END;
$function$;
