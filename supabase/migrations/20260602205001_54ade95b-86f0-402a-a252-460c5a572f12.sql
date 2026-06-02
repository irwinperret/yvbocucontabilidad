DROP VIEW IF EXISTS public.v_cxc_activas;
DROP VIEW IF EXISTS public.v_transacciones_mensual;
DROP VIEW IF EXISTS public.v_off_balance_pendientes;
DROP VIEW IF EXISTS public.v_gyp_mes_actual;
DROP VIEW IF EXISTS public.v_fc_mes_actual;

ALTER TABLE public.plan_de_cuentas ALTER COLUMN centros_permitidos TYPE text[] USING centros_permitidos::text[];
UPDATE public.plan_de_cuentas
  SET centros_permitidos = ARRAY(SELECT x FROM unnest(centros_permitidos) AS x WHERE x IN ('YV','Bocu','Compartido'))
  WHERE centros_permitidos IS NOT NULL;

ALTER TYPE public.centro_costo RENAME TO centro_costo_old;
CREATE TYPE public.centro_costo AS ENUM ('YV', 'Bocu', 'Compartido');

ALTER TABLE public.transacciones ALTER COLUMN centro_costo TYPE public.centro_costo USING centro_costo::text::public.centro_costo;
ALTER TABLE public.cuentas_por_cobrar ALTER COLUMN centro_costo TYPE public.centro_costo USING centro_costo::text::public.centro_costo;
ALTER TABLE public.cuentas_por_pagar ALTER COLUMN centro_costo TYPE public.centro_costo USING centro_costo::text::public.centro_costo;
ALTER TABLE public.plan_de_cuentas ALTER COLUMN centros_permitidos TYPE public.centro_costo[] USING centros_permitidos::public.centro_costo[];

DROP TYPE public.centro_costo_old;

CREATE VIEW public.v_cxc_activas AS
SELECT id, cliente, centro_costo, monto_bs, monto_usd, fecha_vencimiento, estado, created_at,
  CASE
    WHEN fecha_vencimiento < CURRENT_DATE THEN 'vencida'
    WHEN fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days' THEN 'por_vencer'
    ELSE 'vigente'
  END AS urgencia
FROM public.cuentas_por_cobrar
WHERE estado = 'vigente'
ORDER BY fecha_vencimiento;

CREATE VIEW public.v_transacciones_mensual AS
SELECT to_char(fecha::timestamptz, 'YYYY-MM') AS periodo,
  EXTRACT(year FROM fecha)::int AS anio,
  EXTRACT(month FROM fecha)::int AS mes,
  cuenta_codigo, centro_costo, modo,
  sum(monto_base_bs) AS base_bs,
  sum(iva_bs) AS iva_bs,
  sum(monto_bs) AS total_bs,
  sum(monto_base_bs / NULLIF(tasa_bcv, 0)) AS base_usd,
  sum(monto_bs / NULLIF(tasa_bcv, 0)) AS total_usd,
  count(*) AS movimientos
FROM public.transacciones t
GROUP BY 1,2,3,4,5,6;

CREATE VIEW public.v_off_balance_pendientes AS
SELECT t.id, t.fecha, t.cuenta_codigo, pc.nombre AS cuenta_nombre,
  t.centro_costo, t.monto_bs, t.monto_usd,
  (CURRENT_DATE - t.fecha) AS dias_pendientes,
  CASE
    WHEN (CURRENT_DATE - t.fecha) > 15 THEN 'critico'
    WHEN (CURRENT_DATE - t.fecha) > 7 THEN 'advertencia'
    ELSE 'reciente'
  END AS urgencia
FROM public.transacciones t
JOIN public.plan_de_cuentas pc ON pc.codigo = t.cuenta_codigo
WHERE t.modo = 'off_balance' AND t.marcada_error = false
ORDER BY t.fecha;

CREATE VIEW public.v_gyp_mes_actual AS
SELECT pc.codigo, pc.nombre, pc.grupo, t.centro_costo,
  sum(t.monto_bs) AS total_bs, sum(t.monto_usd) AS total_usd, count(*) AS num_movimientos
FROM public.transacciones t
JOIN public.plan_de_cuentas pc ON pc.codigo = t.cuenta_codigo
WHERE pc.afecta_gyp = true AND t.modo = 'on_balance' AND t.marcada_error = false
  AND date_trunc('month', t.fecha::timestamptz) = date_trunc('month', CURRENT_DATE::timestamptz)
GROUP BY pc.codigo, pc.nombre, pc.grupo, t.centro_costo, pc.orden
ORDER BY pc.orden;

CREATE VIEW public.v_fc_mes_actual AS
SELECT pc.codigo, pc.nombre, pc.grupo, t.centro_costo,
  sum(t.monto_bs) AS total_bs, sum(t.monto_usd) AS total_usd
FROM public.transacciones t
JOIN public.plan_de_cuentas pc ON pc.codigo = t.cuenta_codigo
WHERE pc.afecta_fc = true AND t.modo = 'on_balance' AND t.marcada_error = false
  AND date_trunc('month', t.fecha::timestamptz) = date_trunc('month', CURRENT_DATE::timestamptz)
GROUP BY pc.codigo, pc.nombre, pc.grupo, t.centro_costo, pc.orden
ORDER BY pc.orden;