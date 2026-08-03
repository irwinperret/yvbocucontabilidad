# Conciliación: pagos que no coinciden con el monto de la factura

Hoy el sistema ya descuenta la deuda en **USD BCV a la tasa del día del movimiento bancario** (correcto). Lo que falta es el manejo de las diferencias.

## Situación actual

- Pago menor a la factura: la CxP queda en `parcial` con el saldo restante en USD BCV. Correcto, se mantiene.
- Pago mayor: el saldo se trunca en cero, la CxP se marca `pagada` y **el excedente desaparece** — el asiento 13.2 se registra por el monto completo del banco, dejando un descuadre contra cuentas por pagar.
- La diferencia en Bs entre lo facturado y lo pagado no se muestra en ninguna parte.

## Cambios

### 1. Un movimiento puede pagar varias facturas

En la fila de conciliación, además de elegir una CxP, se podrá **agregar más facturas del mismo proveedor** a ese mismo movimiento.

- El monto del banco se aplica en orden a las facturas seleccionadas, hasta agotarse.
- Cada factura recibe su parte: se salda completa o queda `parcial` con su saldo en USD BCV.
- Se crea un asiento de pago (13.2) por cada factura cubierta, dentro del grupo de esa factura, para que el IVA y el centro de costo sigan siendo los correctos. La suma de los asientos es exactamente el monto del banco.

### 2. El sobrante se registra como anticipo al proveedor

Si después de aplicar todas las facturas seleccionadas todavía queda dinero:

- Ese remanente se registra como **anticipo a proveedor (cuenta 14.2)** a nombre del mismo proveedor, con la tasa BCV y paralela del día del movimiento.
- Queda disponible en la página de Anticipos para aplicarse a facturas futuras, usando el flujo que ya existe.
- Si no hay proveedor identificable (movimiento sin CxP), se sigue tratando como "sin factura" como hoy.

### 3. Diferencia cambiaria, solo informativa

Al conciliar, cada fila emparejada mostrará una columna con la **diferencia en Bs** entre lo que valía la factura y lo que se pagó, con su equivalente en USD BCV.

- Es solo visual: no se crea ningún asiento de ganancia/pérdida cambiaria.
- Un resumen arriba indicará el total de diferencia del archivo.

### 4. Resumen al confirmar

El mensaje final pasa a incluir: facturas pagadas, parciales, anticipos generados, movimientos sin factura y fallidos.

## Detalles técnicos

- Archivo principal: `src/routes/_authenticated/importar-movimientos.tsx`.
  - `Match.cxp` pasa a `Match.cxps: CxP[]` (lista ordenada); la UI permite añadir/quitar facturas del mismo `tercero_id`/proveedor.
  - Nueva función `distribuirPago(montoBs, fechaPago, cxps)` que reparte en USD BCV: `usd_pagado = monto_bs / tasa_bcv(fecha)`, consume `monto_pendiente_usd_bcv` de cada CxP en orden y devuelve los tramos más el remanente.
  - Por tramo: insert 13.2 con `calcularSplitIvaPagoCxp` sobre el grupo de esa factura (lógica ya existente), update de la CxP a `pagada`/`parcial`.
  - Remanente > 0.01 USD BCV: insert cuenta `14.2` con `tercero_id` del proveedor, `anticipo_usd_bcv` y `anticipo_estado: 'abierto'`; los triggers existentes (`enforce_anticipo_proveedor_currency`) ya fijan tasas y montos.
  - Huella anti-duplicados (`referencia`) se mantiene: se escribe en el primer asiento del movimiento; los tramos adicionales llevan la misma huella con sufijo de índice para no romper la detección.
  - Columna "Dif. Bs" calculada en cliente comparando `monto_bs` del banco contra `usd_bcv_pendiente * tasa_bcv_factura`.
- Sin cambios de base de datos: se usan `cuentas_por_pagar` y la cuenta 14.2 ya existentes.
