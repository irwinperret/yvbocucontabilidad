# Convertir todas las compras registradas en cuentas por pagar

Hoy hay **438 compras** registradas (cuenta 2.1, desde el 01/04/2026 hasta el 02/07/2026) y **202 líneas de IVA crédito** asociadas, pero la tabla de cuentas por pagar está **completamente vacía**. Además, todas las compras figuran con método de pago "transferencia", es decir, como si ya estuvieran pagadas.

## Qué se va a hacer

1. **Crear una cuenta por pagar por cada compra**, con fecha, proveedor, número de factura, centro de costo y las tasas del día de la factura tal como fueron registradas.
2. **El monto de cada deuda incluye el IVA**: se suma la línea de compra más su IVA crédito del mismo grupo (la mayoría de las facturas Xetux traen IVA; las que no lo tienen quedan solo con el neto). Se guardan el monto en bolívares, el equivalente en USD paralelo y el equivalente en USD BCV.
3. **Todas quedan en estado pendiente**, con el saldo pendiente igual al total (nada marcado como pagado).
4. **Origen**: las importadas de Xetux se marcan como `xetux`, el resto como `manual`.
5. **Las compras pasan a método de pago "pendiente"** y se les quita la cuenta bancaria, para que no descuenten saldo bancario. El pago real se registrará después con el importador de movimientos bancarios o desde Pagar CxP.
6. **Los 3 ajustes de COGS por inventario (cuenta 2.2) NO se incluyen**, ya que son ajustes de cierre de mes y no deudas con proveedores.

Tras esto, la pestaña **Cuentas por pagar** mostrará las 438 facturas abiertas, filtrables por origen, y el importador de movimientos bancarios podrá emparejarlas contra los pagos reales.

## Detalle técnico

- Un solo script de datos (`INSERT ... SELECT`) que agrupa `transacciones` por `grupo_transaccion_id` para las filas con `cuenta_codigo = '2.1'`, sumando el `monto_bs` de la fila `12.5` del mismo grupo.
- Campos poblados en `cuentas_por_pagar`: `transaccion_id`, `tercero_id`, `proveedor` (razón social), `numero_factura`, `centro_costo`, `monto_bs`, `monto_usd`, `monto_pendiente_bs`, `monto_pendiente_usd_bcv`, `usd_bcv_factura`, `usd_paralelo_factura`, `tasa_bcv_factura`, `tasa_paralela_factura`, `estado = 'pendiente'`, `origen`.
- `fecha_vencimiento` = fecha de la factura (no hay plazos de crédito registrados).
- `UPDATE` sobre las 438 filas 2.1: `metodo_pago = 'pendiente'`, `cuenta_bancaria_id = NULL`. Las líneas de IVA 12.5 no se tocan.
- Se excluyen las compras `off_balance` si las hubiera, y se evita duplicar si ya existe una CxP para esa transacción.
- No hay cambios de código de la aplicación; el flujo de importación Xetux ya crea las CxP para las facturas nuevas.
