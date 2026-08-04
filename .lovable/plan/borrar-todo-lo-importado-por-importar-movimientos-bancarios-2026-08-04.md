# Borrar todo lo importado por "Importar movimientos bancarios"

## Qué hay hoy en la base de datos

Consultado ahora mismo:

- **892 transacciones** creadas por ese importador (todas llevan la huella `BANK:...` en el campo de referencia). De ellas, 680 son movimientos sin factura (detalle con prefijo `SIN FACTURA XETUX`).
- Desglose principal: 260 en cuenta 2.1 (compras sin factura), 212 en 13.2 (pagos de facturas), 84 en 3.4, 57 en 5.6, y el resto repartido en gastos varios.
- **0 anticipos (14.2)** generados por excedentes, así que ese caso no aplica.
- Facturas por pagar hoy: 276 pendientes, 126 pagadas, 36 parciales.

## Qué se va a hacer

1. **Borrar las 892 transacciones** cuya referencia empieza por `BANK:`. No se toca ninguna otra transacción: las facturas originales de Xetux tienen su propio grupo y se conservan intactas.
2. **Revertir las facturas por pagar** que fueron marcadas como pagadas o parciales por esos pagos: vuelven a estado "pendiente", con el monto pendiente restaurado al monto original de la factura y sin fecha de pago.
3. Dejar registro de la operación en la auditoría.

Resultado: el sistema queda como antes de cualquier conciliación bancaria; los archivos de movimientos se pueden volver a importar desde cero (la deduplicación por huella dejará de bloquearlos porque las huellas se eliminan junto con las transacciones).

## Detalles técnicos

- Criterio de borrado: `transacciones.referencia LIKE 'BANK:%'` (cubre también las variantes `#1`, `#ANT`, y las filas sin factura, que igualmente llevan la huella).
- Reversión de CxP: se identifican vía `cuentas_por_pagar.transaccion_id` → `grupo_transaccion_id` compartido con las líneas 13.2 borradas; se restaura `monto_pendiente_bs = monto_bs`, `monto_pendiente_usd_bcv = usd_bcv_factura`, `estado = 'pendiente'`, `pagada_at = null`.
- Se ejecuta como operación de datos (no cambia el esquema) y es irreversible, por eso conviene confirmarla antes.

## Confirmación necesaria

Esta operación no tiene deshacer. Al aprobar el plan, se ejecuta el borrado completo de las 892 transacciones y la reversión de las facturas afectadas.
