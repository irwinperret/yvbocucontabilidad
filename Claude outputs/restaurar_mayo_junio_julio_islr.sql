BEGIN;

-- Mayo: 695.44 (antes de mi corrección ya estaba así; mi script lo cambió mal a 525.32)
UPDATE transacciones SET monto_usd = 695.44
  WHERE grupo_transaccion_id = '2063d2c1-31b1-440d-ae46-de47df968b56' AND cuenta_codigo = '9.5';
UPDATE transacciones SET monto_usd = -695.44
  WHERE grupo_transaccion_id = '2063d2c1-31b1-440d-ae46-de47df968b56' AND cuenta_codigo = '4.8';

-- Junio: 1142.40 (mi script lo cambió mal a 979.51)
UPDATE transacciones SET monto_usd = 1142.40
  WHERE grupo_transaccion_id = 'd59a6019-f5d4-40f0-9b08-9b3d6cb7314f' AND cuenta_codigo = '9.5';
UPDATE transacciones SET monto_usd = -1142.40
  WHERE grupo_transaccion_id = 'd59a6019-f5d4-40f0-9b08-9b3d6cb7314f' AND cuenta_codigo = '4.8';

-- Julio: 1358.22 (mi script lo cambió mal a 1209.28)
UPDATE transacciones SET monto_usd = 1358.22
  WHERE grupo_transaccion_id = 'e32086b8-f443-4402-af03-473ddd164948' AND cuenta_codigo = '9.5';
UPDATE transacciones SET monto_usd = -1358.22
  WHERE grupo_transaccion_id = 'e32086b8-f443-4402-af03-473ddd164948' AND cuenta_codigo = '4.8';

-- Verificación: deben quedar Mayo 695.44, Junio 1142.40, Julio 1358.22, Agosto 1616.23, Septiembre 1417.72
SELECT cuenta_codigo, fecha, grupo_transaccion_id, monto_bs, monto_usd, tasa_bcv, tasa_paralela,
       ROUND(monto_bs / tasa_paralela, 2) AS debería_ser
FROM transacciones
WHERE cuenta_codigo IN ('9.5','4.8')
  AND fecha BETWEEN '2026-05-01' AND '2026-09-30'
ORDER BY fecha, cuenta_codigo;

COMMIT;
