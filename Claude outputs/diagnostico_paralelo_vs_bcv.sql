-- QUERY A: busca en TODA la tabla transacciones filas donde monto_usd NO
-- coincide con monto_bs / tasa_paralela (el mismo patrón de bug que tenía
-- ISLR), sin importar qué formulario las creó. Esto nos dice si el bug es
-- solo de ISLR o si hay otros módulos con el mismo problema.
SELECT
  cuenta_codigo,
  EXTRACT(year FROM fecha)::int AS anio,
  COUNT(*) FILTER (WHERE COALESCE(tasa_paralela,0) > 0 AND COALESCE(monto_bs,0) <> 0) AS filas_con_tasa_paralela,
  COUNT(*) FILTER (
    WHERE COALESCE(tasa_paralela,0) > 0 AND COALESCE(monto_bs,0) <> 0
      AND ABS(monto_usd - (monto_bs / tasa_paralela)) > 0.05
  ) AS filas_inconsistentes,
  ROUND(SUM(monto_usd) FILTER (
    WHERE COALESCE(tasa_paralela,0) > 0 AND COALESCE(monto_bs,0) <> 0
      AND ABS(monto_usd - (monto_bs / tasa_paralela)) > 0.05
  ), 2) AS usd_guardado_mal,
  ROUND(SUM(monto_bs / tasa_paralela) FILTER (
    WHERE COALESCE(tasa_paralela,0) > 0 AND COALESCE(monto_bs,0) <> 0
      AND ABS(monto_usd - (monto_bs / tasa_paralela)) > 0.05
  ), 2) AS usd_deberia_ser
FROM transacciones
WHERE standby IS NOT TRUE
GROUP BY 1, 2
HAVING COUNT(*) FILTER (
    WHERE COALESCE(tasa_paralela,0) > 0 AND COALESCE(monto_bs,0) <> 0
      AND ABS(monto_usd - (monto_bs / tasa_paralela)) > 0.05
  ) > 0
ORDER BY 2, 1;

-- QUERY B: filas donde ni siquiera hay tasa_paralela guardada (la vista
-- paralelo igual las suma usando el monto_usd crudo, sea lo que sea que
-- tenga guardado). Agrupado por cuenta y año para ver qué módulos/cuentas
-- son los que más le faltan.
SELECT
  cuenta_codigo,
  EXTRACT(year FROM fecha)::int AS anio,
  COUNT(*) AS filas_totales,
  COUNT(*) FILTER (WHERE COALESCE(tasa_paralela,0) <= 0 AND COALESCE(monto_bs,0) <> 0) AS filas_sin_tasa_paralela,
  ROUND(SUM(monto_bs) FILTER (WHERE COALESCE(tasa_paralela,0) <= 0 AND COALESCE(monto_bs,0) <> 0), 2) AS bs_afectado,
  ROUND(SUM(monto_usd) FILTER (WHERE COALESCE(tasa_paralela,0) <= 0 AND COALESCE(monto_bs,0) <> 0), 2) AS usd_guardado_sin_tasa
FROM transacciones
WHERE standby IS NOT TRUE
GROUP BY 1, 2
HAVING COUNT(*) FILTER (WHERE COALESCE(tasa_paralela,0) <= 0 AND COALESCE(monto_bs,0) <> 0) > 0
ORDER BY 2, 1;
