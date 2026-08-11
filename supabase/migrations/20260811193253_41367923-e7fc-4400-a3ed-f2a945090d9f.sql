CREATE OR REPLACE VIEW public.v_transacciones_mensual WITH (security_invoker = true) AS
 SELECT to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
    (EXTRACT(year FROM fecha))::integer AS anio,
    (EXTRACT(month FROM fecha))::integer AS mes,
    cuenta_codigo,
    centro_costo,
    modo,
    sum(monto_base_bs) AS base_bs,
    sum(iva_bs) AS iva_bs,
    sum(monto_bs) AS total_bs,
    sum(
        CASE
            WHEN ((cuenta_codigo = '13.2'::text) OR (notas ~~* 'Pago CxP%'::text)) THEN (0)::numeric
            WHEN (COALESCE(monto_bs, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            ELSE (COALESCE(monto_usd, (0)::numeric) * (COALESCE(monto_base_bs, monto_bs) / monto_bs))
        END) AS base_usd,
    sum(
        CASE
            WHEN (metodo_pago = 'pendiente'::metodo_pago) THEN (0)::numeric
            ELSE COALESCE(monto_usd, (0)::numeric)
        END) AS total_usd,
    count(*) AS movimientos
   FROM transacciones t
  WHERE t.standby IS NOT TRUE
  GROUP BY (to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text)), ((EXTRACT(year FROM fecha))::integer), ((EXTRACT(month FROM fecha))::integer), cuenta_codigo, centro_costo, modo;

CREATE OR REPLACE VIEW public.v_transacciones_mensual_bcv WITH (security_invoker = true) AS
 SELECT to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
    (EXTRACT(year FROM fecha))::integer AS anio,
    (EXTRACT(month FROM fecha))::integer AS mes,
    cuenta_codigo,
    centro_costo,
    modo,
    sum(monto_base_bs) AS base_bs,
    sum(iva_bs) AS iva_bs,
    sum(monto_bs) AS total_bs,
    sum(
        CASE
            WHEN ((cuenta_codigo = '13.2'::text) OR (notas ~~* 'Pago CxP%'::text)) THEN (0)::numeric
            WHEN (COALESCE(monto_bs, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            WHEN (COALESCE(tasa_bcv, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            ELSE (COALESCE(monto_base_bs, monto_bs) / tasa_bcv)
        END) AS base_usd,
    sum(
        CASE
            WHEN (metodo_pago = 'pendiente'::metodo_pago) THEN (0)::numeric
            WHEN (COALESCE(monto_bs, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            WHEN (COALESCE(tasa_bcv, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            ELSE (monto_bs / tasa_bcv)
        END) AS total_usd,
    count(*) AS movimientos
   FROM transacciones t
  WHERE t.standby IS NOT TRUE
  GROUP BY (to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text)), ((EXTRACT(year FROM fecha))::integer), ((EXTRACT(month FROM fecha))::integer), cuenta_codigo, centro_costo, modo;

CREATE OR REPLACE VIEW public.v_iva_mensual WITH (security_invoker = true) AS
 SELECT to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
    tipo_iva,
    sum(iva_bs) AS iva_bs,
    sum((iva_bs / NULLIF(tasa_bcv, (0)::numeric))) AS iva_usd,
    count(*) AS movimientos
   FROM transacciones
  WHERE ((iva_aplica = true) AND (modo = 'on_balance'::modo_transaccion) AND standby IS NOT TRUE)
  GROUP BY (to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text)), tipo_iva;

CREATE OR REPLACE VIEW public.v_gyp_mes_actual WITH (security_invoker = true) AS
 SELECT pc.codigo, pc.nombre, pc.grupo, t.centro_costo,
    sum(t.monto_bs) AS total_bs,
    sum(t.monto_usd) AS total_usd,
    count(*) AS num_movimientos
   FROM (transacciones t JOIN plan_de_cuentas pc ON ((pc.codigo = t.cuenta_codigo)))
  WHERE ((pc.afecta_gyp = true) AND (t.modo = 'on_balance'::modo_transaccion) AND (t.marcada_error = false) AND t.standby IS NOT TRUE AND (date_trunc('month'::text, (t.fecha)::timestamp with time zone) = date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)))
  GROUP BY pc.codigo, pc.nombre, pc.grupo, t.centro_costo, pc.orden
  ORDER BY pc.orden;

CREATE OR REPLACE VIEW public.v_fc_mes_actual WITH (security_invoker = true) AS
 SELECT pc.codigo, pc.nombre, pc.grupo, t.centro_costo,
    sum(t.monto_bs) AS total_bs,
    sum(t.monto_usd) AS total_usd
   FROM (transacciones t JOIN plan_de_cuentas pc ON ((pc.codigo = t.cuenta_codigo)))
  WHERE ((pc.afecta_fc = true) AND (t.modo = 'on_balance'::modo_transaccion) AND (t.marcada_error = false) AND t.standby IS NOT TRUE AND (date_trunc('month'::text, (t.fecha)::timestamp with time zone) = date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)))
  GROUP BY pc.codigo, pc.nombre, pc.grupo, t.centro_costo, pc.orden
  ORDER BY pc.orden;

CREATE OR REPLACE VIEW public.v_off_balance_pendientes WITH (security_invoker = true) AS
 SELECT t.id, t.fecha, t.cuenta_codigo, pc.nombre AS cuenta_nombre, t.centro_costo, t.monto_bs, t.monto_usd,
    (CURRENT_DATE - t.fecha) AS dias_pendientes,
        CASE
            WHEN ((CURRENT_DATE - t.fecha) > 15) THEN 'critico'::text
            WHEN ((CURRENT_DATE - t.fecha) > 7) THEN 'advertencia'::text
            ELSE 'reciente'::text
        END AS urgencia
   FROM (transacciones t JOIN plan_de_cuentas pc ON ((pc.codigo = t.cuenta_codigo)))
  WHERE ((t.modo = 'off_balance'::modo_transaccion) AND (t.marcada_error = false) AND t.standby IS NOT TRUE)
  ORDER BY t.fecha;