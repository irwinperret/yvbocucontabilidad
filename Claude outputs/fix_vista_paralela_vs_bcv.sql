BEGIN;

-- 1) Función para buscar la tasa paralela vigente de una fecha (mismo
--    patrón que ya existe para tasa_bcv_para_fecha): la más reciente en o
--    antes de esa fecha; si no hay ninguna anterior (fechas muy viejas),
--    usa la primera que exista después.
CREATE OR REPLACE FUNCTION public.tasa_paralela_para_fecha(_fecha date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT tasa FROM public.tasas_paralela WHERE fecha <= _fecha ORDER BY fecha DESC LIMIT 1),
    (SELECT tasa FROM public.tasas_paralela WHERE fecha >= _fecha ORDER BY fecha ASC LIMIT 1)
  );
$$;

REVOKE ALL ON FUNCTION public.tasa_paralela_para_fecha(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasa_paralela_para_fecha(date) TO authenticated, service_role;

-- 2) Trigger general (no solo para un módulo puntual, como el que ya
--    existe para anticipos a proveedor): si una fila de transacciones
--    llega sin tasa_paralela (o en 0), se la rellena sola con la de su
--    fecha. Así ningún formulario nuevo puede volver a olvidarla, como
--    pasó con la reclasificación de ISLR.
CREATE OR REPLACE FUNCTION public.rellenar_tasa_paralela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.tasa_paralela, 0) <= 0 AND NEW.fecha IS NOT NULL THEN
    NEW.tasa_paralela := public.tasa_paralela_para_fecha(NEW.fecha);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rellenar_tasa_paralela ON public.transacciones;
CREATE TRIGGER trg_rellenar_tasa_paralela
BEFORE INSERT OR UPDATE OF fecha, tasa_paralela
ON public.transacciones
FOR EACH ROW
EXECUTE FUNCTION public.rellenar_tasa_paralela();

-- 3) La vista "paralelo" deja de confiar ciegamente en la columna monto_usd
--    guardada (que ya vimos que a veces se calcula mal) y pasa a calcular
--    en vivo monto_bs / tasa_paralela, igual que ya hace
--    v_transacciones_mensual_bcv con tasa_bcv. Única excepción: cuenta 2.2
--    (ajuste de COGS al cierre de mes), que ya trae un monto_usd calculado
--    con más precisión (día por día, no con una tasa promedio simple) --
--    ahí se sigue respetando el valor guardado, sin tocarlo.
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
            WHEN (cuenta_codigo = '2.2'::text) THEN (COALESCE(monto_usd, (0)::numeric) * (COALESCE(monto_base_bs, monto_bs) / monto_bs))
            WHEN (COALESCE(tasa_paralela, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            ELSE (COALESCE(monto_base_bs, monto_bs) / tasa_paralela)
        END) AS base_usd,
    sum(
        CASE
            WHEN (metodo_pago = 'pendiente'::metodo_pago) THEN (0)::numeric
            WHEN (cuenta_codigo = '2.2'::text) THEN COALESCE(monto_usd, (0)::numeric)
            WHEN (COALESCE(monto_bs, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            WHEN (COALESCE(tasa_paralela, (0)::numeric) = (0)::numeric) THEN (0)::numeric
            ELSE (monto_bs / tasa_paralela)
        END) AS total_usd,
    count(*) AS movimientos
   FROM transacciones t
  WHERE t.standby IS NOT TRUE
  GROUP BY (to_char((fecha)::timestamp with time zone, 'YYYY-MM'::text)), ((EXTRACT(year FROM fecha))::integer), ((EXTRACT(month FROM fecha))::integer), cuenta_codigo, centro_costo, modo;

COMMIT;

-- VERIFICACIÓN: busca, para TODO 2026, cualquier cuenta/mes donde el total
-- paralelo (en valor absoluto) termine siendo MAYOR que el total BCV --
-- eso nunca debería pasar matemáticamente. Si esto devuelve 0 filas, el
-- arreglo funcionó para todo el sistema (no solo para ISLR).
SELECT
  b.anio, b.mes, b.cuenta_codigo,
  ROUND(b.total_usd, 2) AS total_usd_bcv,
  ROUND(p.total_usd, 2) AS total_usd_paralelo
FROM v_transacciones_mensual_bcv b
JOIN v_transacciones_mensual p
  ON p.anio = b.anio AND p.mes = b.mes AND p.cuenta_codigo = b.cuenta_codigo
   AND p.centro_costo = b.centro_costo AND p.modo = b.modo
WHERE b.anio = 2026
  AND ABS(p.total_usd) > ABS(b.total_usd) + 0.5
ORDER BY b.mes, b.cuenta_codigo;
