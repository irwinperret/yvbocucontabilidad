BEGIN;

-- Mayo: 22367.35 -> 25058.13
UPDATE transacciones SET monto_usd = 25058.13 WHERE id = 'd0aa6dd4-cf91-42db-9cb5-bd097aa0c7a5';
UPDATE cierres_de_mes SET cogs_usd_paralelo = 25058.13 WHERE periodo = '2026-05';

-- Junio: 17752.55 -> 18234.44
UPDATE transacciones SET monto_usd = 18234.44 WHERE id = '1a02cf79-f152-4537-8894-fd8e78893aed';
UPDATE cierres_de_mes SET cogs_usd_paralelo = 18234.44 WHERE periodo = '2026-06';

-- Julio: 33451.91 -> 32260.91
UPDATE transacciones SET monto_usd = 32260.91 WHERE id = '0dd8b061-0603-46a2-b06c-8067c6998310';
UPDATE cierres_de_mes SET cogs_usd_paralelo = 32260.91 WHERE periodo = '2026-07';

-- Agosto: 24704.71 -> 25350.15
UPDATE transacciones SET monto_usd = 25350.15 WHERE id = 'eb72a7f3-ae23-41fa-b40f-89fea164ecf8';
UPDATE cierres_de_mes SET cogs_usd_paralelo = 25350.15 WHERE periodo = '2026-08';

-- Septiembre: 22724.21 -> 22357.36
UPDATE transacciones SET monto_usd = 22357.36 WHERE id = 'ea758a06-944e-4471-a837-666b7c0b5723';
UPDATE cierres_de_mes SET cogs_usd_paralelo = 22357.36 WHERE periodo = '2026-09';

-- Verificación
SELECT t.fecha, t.referencia, t.monto_usd AS cogs_2_2_transaccion, cm.cogs_usd_paralelo AS cogs_cierre_de_mes, cm.cogs_usd AS cogs_bcv_referencia
FROM transacciones t
JOIN cierres_de_mes cm ON cm.periodo = to_char(t.fecha, 'YYYY-MM')
WHERE t.cuenta_codigo = '2.2' AND t.referencia LIKE 'CIERRE-2026-0%'
ORDER BY t.fecha;

COMMIT;
