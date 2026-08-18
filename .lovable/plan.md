# Invertir el tablero de proveedor: el movimiento bancario como pilar

Hoy el tablero de proveedor lista las facturas como contenedores y se arrastran movimientos hacia ellas. Como en la práctica un solo pago bancario cubre varias facturas, se invierte: **cada movimiento bancario es la tarjeta principal y se le sueltan facturas dentro**.

## Nueva estructura de la pantalla

```text
Movimientos bancarios (pilar)
+-------------------------------------------------------------+
| 20/06  BVC  Bs 45.936,84  ($75,00 BCV)      [Pareado]        |
| Aplicado Bs 41.898,27 · Sin aplicar Bs 4.038,57              |
|   - Fact. 1383  emision 03/06  Bs 41.898,27  [quitar]        |
|   - (zona de suelta: arrastra aquí más facturas)             |
+-------------------------------------------------------------+
...

Facturas sin movimiento asignado (bandeja lateral, arrastrables)
- Fact. 1250 · emision 12/05 · Bs 13.873,22 · $29,44 BCV
- Fact. 1325 · ...
```

- Panel principal: lista de movimientos bancarios del proveedor. Cada uno muestra fecha, banco, monto Bs y USD BCV, concepto, estado del pareo, total aplicado a facturas y remanente sin aplicar.
- Dentro de cada movimiento: las facturas ya asignadas (con número, fecha de emisión, monto de la factura, monto aplicado) y un botón para quitar cada una individualmente, más un selector "Agregar factura…".
- Bandeja lateral: **facturas sin movimiento** (abiertas y también las marcadas pagadas sin movimiento identificado), arrastrables hacia cualquier movimiento.
- Arrastrar una factura de un movimiento a otro la reasigna; arrastrarla a la bandeja la libera.
- Se conserva el panel de movimientos sin ninguna factura (quedan como tarjetas vacías con aviso "Sin facturas asignadas") y el selector de proveedor por movimiento.

## Comportamiento del pareo

- Asignar varias facturas a un mismo movimiento aplica el pago en orden de fecha de emisión hasta agotar el monto del movimiento; lo que sobre queda como "sin aplicar" visible en la tarjeta (sin crear anticipos automáticos).
- Quitar una factura de un movimiento devuelve solo el saldo de esa factura; las demás siguen aplicadas.
- Se mantiene la lógica de deuda fijada en USD BCV y revaluada a la tasa del día del pago, sin generar diferencial cambiario.
- "Parear lo evidente" se mantiene, ahora recorriendo movimientos sin facturas y buscando la factura única cuyo saldo coincide dentro de la tolerancia.

## Filtros, resumen y export

- Filtros pasan a ser por movimiento: Todos / Sin facturas / Con facturas / Con remanente sin aplicar; el buscador busca por referencia, concepto y número de factura asignada.
- Tarjetas de resumen: movimientos totales, movimientos sin facturas, facturas sin movimiento, y monto total sin aplicar.
- El Excel se reorganiza con una fila por movimiento (fecha, banco, referencia, monto Bs/USD BCV, estado, aplicado, sin aplicar, facturas asignadas) y una segunda hoja con las facturas sin movimiento.

## Detalle técnico

- Reescritura de `src/routes/_authenticated/proveedores/$id.tsx`: los `useDraggable` pasan a las facturas (`cxp:<id>`) y los `useDroppable` a los movimientos (`mov:<id>`) más una zona `sin-asignar`.
- En `src/lib/pareo-cxp.ts`: `reasignarPagoDirecto` acepta una lista de facturas destino (`destinos: any[]`) en lugar de una sola, reparte el USD BCV del pago entre ellas y guarda todos los vínculos de conciliación en una sola llamada; `aplicarPareoCxp` ya soporta varias CxP y se sigue usando tal cual.
- Las mutaciones se ejecutan siempre sobre el movimiento completo (liberar + reaplicar el conjunto de facturas resultante) para que los saldos queden consistentes tras cada arrastre.
- Sin cambios de esquema en la base de datos.
