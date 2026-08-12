# Borrar todos los movimientos importados desde "Importar movimientos bancarios"

## Situación actual (consultada en la base de datos)

- **1.005 transacciones** provienen del importador de movimientos bancarios (llevan la huella `BANK:` en referencia). 890 activas y 115 en standby.
- Fechas cubiertas: **06/04/2026 al 06/11/2026**.
- Desglose principal por cuenta: 297 en 13.2 (pagos de facturas), 152 en 14.2 (anticipos), 115 en 2.1, 97 en 3.4, 53 en 5.6, y el resto en gastos varios.
- **322 registros de conciliación bancaria** están ligados a esos movimientos.
- **259 facturas por pagar** están hoy en pagada (208) o parcial (51), y todas fueron marcadas así por estos movimientos. No hay facturas pagadas por otra vía.
- Ninguna de estas cargas quedó registrada en el historial de importaciones (ese log solo tiene ventas y compras), por eso no se pueden revertir desde ahí.

## Qué se va a hacer

1. Eliminar las **1.005 transacciones** con huella `BANK:`, incluidas las de standby y las líneas derivadas (anticipos, IVA, parejas).
2. Eliminar los **322 registros de conciliación** asociados (se van en cascada con las transacciones).
3. **Restaurar las 259 facturas por pagar**: vuelven a estado "pendiente", con el monto pendiente igual al monto original de la factura y sin fecha de pago.
4. Dejar constancia de la operación en la auditoría.

Después de esto el sistema queda como antes de cualquier conciliación bancaria y los archivos se pueden volver a importar desde cero (la deduplicación por huella ya no bloquea porque las huellas se eliminan junto con las transacciones).

## Puntos importantes

- Los meses **abril, junio y julio de 2026 están cerrados**. El borrado se ejecuta directamente sobre los datos, por lo que se hará igual sin reabrirlos; los cierres de esos meses quedarán desactualizados y conviene recalcularlos después desde Registrar → COGS.
- Las facturas de compras de Xetux **no se tocan**: se conservan intactas, solo vuelven a quedar pendientes de pago.
- La operación **no tiene deshacer**.

## Detalles técnicos

- Criterio: `transacciones.referencia LIKE 'BANK:%'`.
- Orden de borrado: conciliación bancaria → romper FK `pareja_off_balance_id` → transacciones.
- Restauración de CxP: `estado = 'pendiente'`, `monto_pendiente_bs = monto_bs`, `monto_pendiente_usd_bcv = usd_bcv_factura`, `pagada_at = null`, limpiando también las columnas de respaldo `revert_*`.
- Se ejecuta como operación de datos (sin cambios de esquema ni de código).
