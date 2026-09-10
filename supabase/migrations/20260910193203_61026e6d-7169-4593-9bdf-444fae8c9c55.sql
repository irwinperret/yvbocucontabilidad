BEGIN;

-- 1) Unificar bonos_10 y propinas en una sola tabla
ALTER TABLE bonos_10 RENAME TO bono10_propina;

INSERT INTO bono10_propina (
  id, transaccion_id, transaccion_entrada_id, transaccion_salida_id, fecha,
  monto_usd, monto_bs, tasa_paralela, centro_costo, concepto, referencia,
  numero_factura, numero_orden, notas, fecha_distribucion, monto_distribuido_usd,
  notas_distribucion, import_batch_id, created_by, created_at
)
SELECT
  id, transaccion_id, transaccion_entrada_id, transaccion_salida_id, fecha,
  monto_usd, monto_bs, tasa_paralela, centro_costo, concepto, referencia,
  numero_factura, numero_orden, notas, fecha_distribucion, monto_distribuido_usd,
  notas_distribucion, import_batch_id, created_by, created_at
FROM propinas;

DROP TABLE propinas;

-- 2) Fusionar las facturas que tienen pata 8.1 y pata 8.3 (932 casos, máx 1 por factura)
UPDATE transacciones t81
SET monto_bs = t81.monto_bs + t83.monto_bs,
    monto_base_bs = t81.monto_base_bs + t83.monto_base_bs,
    monto_usd = t81.monto_usd + t83.monto_usd,
    notas = left(coalesce(t81.notas,'') || ' · Fusionado bono 10% + propina (antes 8.3)', 255)
FROM transacciones t83
WHERE t83.cuenta_codigo = '8.3'
  AND t81.cuenta_codigo = '8.1'
  AND t81.numero_factura IS NOT NULL
  AND t81.numero_factura = t83.numero_factura;

DELETE FROM transacciones t83
WHERE t83.cuenta_codigo = '8.3'
  AND t83.numero_factura IS NOT NULL
  AND EXISTS (SELECT 1 FROM transacciones t81 WHERE t81.cuenta_codigo='8.1' AND t81.numero_factura = t83.numero_factura);

-- 3) Reasignar el resto de movimientos 8.3 a 8.1
UPDATE transacciones SET cuenta_codigo = '8.1' WHERE cuenta_codigo = '8.3';

-- 4) Renombrar 8.1 y eliminar 8.3 del plan de cuentas
UPDATE plan_de_cuentas SET nombre = 'Bono 10% y Propinas por pagar al personal' WHERE codigo = '8.1';
DELETE FROM plan_de_cuentas WHERE codigo = '8.3';

COMMIT;