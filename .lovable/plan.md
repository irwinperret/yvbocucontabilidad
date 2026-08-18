# Revertir los pareos de Agrosnacks a como estaban hace ~10 minutos

## Qué encontré en los datos

Los únicos cambios de conciliación en las últimas horas son dos vínculos manuales creados hoy a las 00:46 UTC (20:46 hora local), ambos de Agrosnacks:

- Movimiento del 28/05 por Bs 30.757,27 → Factura 90655
- Movimiento del 20/06 por Bs 45.936,84 → Factura 1383

Como consecuencia, esas dos facturas pasaron de pendientes a **pagadas** con saldo 0 (fecha de pago 18/08 00:46).

No hay ningún otro cambio registrado en ese lapso: el resto de las facturas de Agrosnacks (1250, 1295, 1325, 1554) siguen pendientes por su monto completo y los otros dos movimientos del proveedor (18/05 por Bs 60.027,42 y Bs 60.201,48) siguen sin pareo. No existe un registro de auditoría de los movimientos que usted hizo, así que el estado anterior se reconstruye a partir de esos dos vínculos: antes de las 00:46 no existía ningún vínculo manual para Agrosnacks y las facturas 90655 y 1383 estaban pendientes.

## Qué haría

1. Eliminar los dos vínculos de conciliación creados a las 00:46 (movimientos 28/05 y 20/06 contra las facturas 90655 y 1383).
2. Devolver la factura **90655** a estado pendiente: saldo Bs 29.186,39 / USD BCV 55,99 y sin fecha de pago.
3. Devolver la factura **1383** a estado pendiente: saldo Bs 41.898,27 / USD BCV 75,00 y sin fecha de pago.
4. No tocar nada más: no se borra ninguna transacción bancaria ni de compra, y las facturas 1250, 1295, 1325 y 1554 quedan igual.

Nota: los dos movimientos seguirán apareciendo asociados de forma implícita a esas facturas (comparten el grupo contable creado en la importación), tal como estaban antes de que usted los moviera. Si quiere que también se rompa ese vínculo implícito, dígamelo y lo agrego.

## Detalle técnico

- Borrado de las 2 filas de `conciliacion_bancaria` con `created_at = 2026-08-18 00:46`.
- `UPDATE` en `cuentas_por_pagar` para las dos facturas: `estado = 'pendiente'`, `monto_pendiente_bs` y `monto_pendiente_usd_bcv` restaurados a su monto original, `pagada_at = NULL`.
- Se ejecuta como corrección de datos; no hay cambios de código.
