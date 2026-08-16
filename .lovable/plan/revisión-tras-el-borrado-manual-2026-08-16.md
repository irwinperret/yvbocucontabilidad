# Revisión tras el borrado manual

## Qué quedó bien

- Movimientos bancarios: 0 filas con huella `BANK:`.
- Conciliación bancaria: 0 registros.
- Historial de importaciones: vacío (0 cargas).
- Cuentas por cobrar: 0. Propinas: 0.
- Se conservan tasas, terceros, cuentas bancarias, plan de cuentas y los 8 snapshots de inventario.

## Qué quedó a medias

Quedan **1.844 transacciones**, de las cuales solo 148 son manuales (35 en standby). Las otras son restos de importaciones ya borradas:

1. **1.695 líneas en la cuenta 13.4 (Bonos 10% por pagar al personal)** con referencia `xetux`, del 01/04 al 01/08. Son los devengos del bono 10% que se crearon a partir de las ventas importadas. Las ventas ya no existen, así que ese pasivo quedó inflado y sin contrapartida: el saldo de 13.4 que se ve en Propinas y en los reportes es falso.
2. **1 línea suelta en 13.2** (pago parcial de una factura, Bs 168.156,01) con referencia `PAREO:...`, que apunta a una cuenta por pagar que ya fue borrada.
3. Quedan **2 cuentas por pagar** pendientes sueltas, restos de la importación de compras.

## Propuesta de limpieza

Dejar la base exactamente en "solo lo registrado manualmente":

- Eliminar las 1.695 transacciones de 13.4 con referencia `xetux`.
- Eliminar la línea huérfana de 13.2 con referencia `PAREO:`.
- Eliminar las 2 cuentas por pagar restantes que provienen de la importación de compras (se puede revisar antes cuáles son, por si alguna se quiere conservar).

Resultado: 148 transacciones manuales (113 activas + 35 en standby), sin CxP, sin CxC, sin propinas, sin conciliaciones y con el historial de importaciones limpio. A partir de ahí se pueden volver a subir los archivos de ventas, compras y movimientos bancarios desde cero, y cada carga quedará registrada en el historial con su botón de revertir.

## Detalles técnicos

- Borrado por sentencias de datos, en orden: cuentas por pagar restantes, luego `transacciones` filtrando `cuenta_codigo = '13.4' AND referencia = 'xetux'` y `referencia LIKE 'PAREO:%'`.
- Antes de borrar, se anula `pareja_off_balance_id` y se verifica que ninguna fecha caiga en un mes cerrado.
- Verificación posterior: conteos por origen (manual vs importado) y saldo de 13.4 en cero.
