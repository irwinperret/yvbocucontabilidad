## Problema real

El flujo sigue frágil porque la aplicación del anticipo está dividida entre varias escrituras del navegador:

- La factura/CxP se crea en una llamada.
- El anticipo se aplica en otra llamada.
- El pago del remanente se hace en otra llamada.
- Si una parte falla, quedan datos parciales y parece que el anticipo “no descontó”.
- Además, la función actual `aplicar_anticipo_a_factura` solo crea el reverso en `14.2` y cierra el anticipo; no es dueña de crear/ajustar la CxP ni de registrar toda la factura atómicamente.

## Plan de corrección

1. **Mover el flujo crítico a funciones de base de datos atómicas**
   - Crear una función para registrar **Gastos/Facturas con anticipo** en una sola transacción interna.
   - Crear una función para registrar **COGS/Compra con anticipo** en una sola transacción interna.
   - Cada función hará todo o nada: si falla una parte, no queda factura, CxP, snapshot o anticipo a medio aplicar.

2. **Gastos/Facturas**
   - Registrar la factura por el monto completo correspondiente.
   - Aplicar el anticipo seleccionado contra la factura.
   - Insertar el reverso negativo en `14.2`.
   - Actualizar `anticipo_aplicado_usd` y `anticipo_estado` a `aplicado` o `parcialmente_aplicado`.
   - Crear CxP solo por el saldo pendiente real.
   - Si la factura fue marcada como pagada, registrar solo el pago del remanente, no el total.

3. **COGS/Compras**
   - Registrar el `inventario_snapshots` por el monto completo de la compra.
   - Aplicar el anticipo dentro de la misma operación.
   - Crear CxP solo por el remanente real.
   - Si la compra fue marcada como pagada, pagar solo el remanente.
   - Vincular correctamente `cxp_id` y `grupo_transaccion_id`.

4. **Ajustar el frontend**
   - Cambiar `registrar.tsx` para que, cuando haya anticipos seleccionados, llame a la función atómica en vez de ejecutar escrituras separadas desde el navegador.
   - Mantener el flujo normal sin anticipo como está, salvo ajustes mínimos necesarios.
   - Mostrar errores claros si el anticipo ya fue usado, no tiene saldo, o excede la factura.

5. **Backfill de datos actuales**
   - Revisar anticipos abiertos que ya fueron intentados aplicar.
   - Corregir anticipos con reversos existentes pero estado abierto.
   - Normalizar saldos para que la vista de anticipos, CxP y transacciones refleje lo mismo.

6. **Verificación**
   - Probar con el anticipo abierto actual de AGROSNACKS.
   - Confirmar después de registrar una factura que existan:
     - Factura registrada.
     - Reverso negativo en `14.2`.
     - Anticipo original cerrado/parcial.
     - CxP solo por el remanente.
     - Ningún pago duplicado del monto completo.