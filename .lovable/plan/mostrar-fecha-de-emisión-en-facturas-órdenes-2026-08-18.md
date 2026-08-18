# Mostrar fecha de emisión en Facturas / órdenes

## Cambio
- Ampliar la consulta de las transacciones vinculadas a las CxP para traer también `fecha`.
- Asociar cada CxP con la fecha de su transacción de factura mediante `transaccion_id`.
- Mostrar siempre un campo explícito **“Fecha de emisión: DD/MM/AAAA”** en cada factura u orden, en lugar de consultar el campo inexistente `c.fecha`.
- Usar esa misma fecha correcta en la exportación Excel.
- Si una CxP excepcionalmente no tiene transacción vinculada, mostrar “Fecha de emisión: —” sin ocultar el campo.

## Verificación
- Revisar el proveedor Agrosnacks y confirmar que facturas como 1554, 1383 y 1325 muestren sus fechas de emisión registradas.
- Confirmar que la fecha siga visible en todos los filtros de Facturas / órdenes y en el Excel exportado.

## Detalle técnico
La tabla `cuentas_por_pagar` no contiene una fecha de emisión propia. La fuente correcta disponible es `transacciones.fecha` de la transacción enlazada en `cuentas_por_pagar.transaccion_id`; actualmente el componente intenta renderizar `c.fecha`, por lo que nunca aparece.