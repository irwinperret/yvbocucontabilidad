# Tasa BCV: usar la tasa siguiente en lugar de la anterior

Hoy, cuando un movimiento cae en un día sin tasa BCV (fin de semana o feriado), el sistema toma la última tasa **anterior**. Se cambia en toda la app para tomar la **próxima tasa BCV** publicada a partir de esa fecha. La tasa paralela sigue funcionando igual (tasa anterior más cercana).

## Regla nueva

- Tasa BCV de una fecha = tasa del día si existe; si no, la primera tasa con fecha **posterior**.
- Si no existe ninguna tasa posterior (fechas futuras, hoy 5 transacciones), se mantiene el comportamiento actual de tomar la anterior, para no dejar movimientos sin tasa.

## Alcance del cambio hacia adelante

Un único helper compartido (`tasaBcvParaFecha`) reemplaza las consultas dispersas actuales en:

- Registro manual y nómina (`registrar.tsx`)
- Edición de transacciones (`transaccion-edit-dialog.tsx`)
- Asistente de filas fallidas (`importacion-fallidas-wizard.tsx`)
- Importar compras Xetux, importar ventas, importar movimientos bancarios
- Propinas, CxC, Pagar CxP
- Inventarios (valuación de inventario inicial/final)

También se actualizan las funciones de base de datos que hoy buscan `fecha <= X ORDER BY fecha DESC`:

- `aplicar_anticipo_a_factura`
- `enforce_anticipo_proveedor_currency`

## Recálculo retroactivo (todos los meses, incluidos los cerrados)

Se recalcula la tasa BCV guardada en los registros cuya fecha no tiene tasa exacta:

- `transacciones`: 3.261 filas cambian de tasa. Se actualiza `tasa_bcv` y los montos derivados en BCV (`anticipo_usd_bcv`, `anticipo_aplicado_usd_bcv`).
- `cuentas_por_pagar`: `tasa_bcv_factura`, `usd_bcv_factura`, `monto_pendiente_usd_bcv`.
- `cuentas_por_cobrar`: `tasa_bcv_venta`, `monto_usd_bcv`, `monto_pendiente_usd_bcv`.
- `inventario_snapshots`: `tasa_bcv` y su valuación en USD BCV.

No se toca `monto_bs` ni `monto_usd` (el USD contable sigue calculándose con la tasa paralela, según la regla vigente del proyecto). El cambio afecta únicamente la vista/valuación en USD BCV y la referencia fiscal.

Antes de actualizar se crea una tabla de respaldo (`_backup_bcv_next_<fecha>`) con los valores anteriores, para poder revertir.

## Detalles técnicos

- Helper nuevo en `src/lib/tasas.ts`: `tasaBcvParaFecha(fecha)` → `{ tasa, fecha_origen }`, con consulta `gte(fecha) order asc limit 1` y respaldo `lte(fecha) order desc limit 1`.
- Los avisos de UI que hoy dicen "tasa del <fecha>" seguirán mostrando la fecha de origen, que ahora podrá ser posterior al movimiento.
- El recálculo retroactivo se ejecuta como operaciones de datos (UPDATE) por tabla, en lotes, con verificación de conteos antes y después.
- Los meses cerrados se recalculan igual; después conviene revisar el COGS/cierre de abril, junio y julio si su valuación BCV cambió.
