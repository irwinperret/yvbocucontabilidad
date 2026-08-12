# Borrar todo lo que no fue registrado manualmente

## Qué hay hoy (consultado en la base de datos)

Transacciones activas (no standby):

- **7.487** de importación Xetux (ventas y compras)
- **999** de importación de movimientos bancarios (huella `BANK:`)
- **3** ligadas a un lote de importación
- **120** manuales

Además hay **35 transacciones manuales en standby**, que no se tocan.

Registros derivados de esas importaciones:

- **604 cuentas por pagar** creadas por Xetux (345 pendientes, 208 pagadas, 51 parciales). Solo 2 CxP son manuales.
- **322 registros de conciliación bancaria**.
- **1.504 propinas** ligadas a transacciones Xetux (de 752 filas de propinas, 312 con lote de importación).
- **0 cuentas por cobrar** registradas.

## Qué se va a hacer

1. Eliminar las **8.489 transacciones activas** que no son manuales: Xetux (ventas y compras), movimientos bancarios y las de lote de importación.
2. Eliminar en cascada sus registros derivados: cuentas por pagar de Xetux, conciliación bancaria y propinas asociadas.
3. Conservar intactas: las **120 transacciones manuales activas**, las **35 manuales en standby**, las 2 CxP manuales, el plan de cuentas, terceros, cuentas bancarias, tasas e inventarios.
4. Marcar el historial de importaciones como revertido y dejar constancia en la auditoría.

Después de esto el sistema queda solo con lo registrado a mano, y todos los archivos se pueden volver a importar desde cero (la deduplicación por huella ya no bloquea).

## Puntos importantes

- Los meses **abril, junio y julio de 2026 están cerrados**. El borrado se ejecuta igual sobre los datos; esos cierres quedarán desactualizados y conviene recalcularlos después desde Registrar → COGS.
- Los **inventarios inicial/final** (4 y 4 registros) se conservan; sus montos ya no cuadrarán con las compras y habrá que revisarlos.
- La operación **no tiene deshacer**.

## Detalles técnicos

- Criterio de borrado: `standby = false` AND (`referencia LIKE 'BANK:%'` OR `referencia IN ('xetux','xetux-iva')` OR `import_batch_id IS NOT NULL`).
- Orden: propinas → conciliación bancaria → cuentas por pagar (de esas transacciones) → romper FK `pareja_off_balance_id` → transacciones.
- `importaciones`: marcar todas como `revertida`.
- Se ejecuta como operación de datos, sin cambios de esquema ni de código.
