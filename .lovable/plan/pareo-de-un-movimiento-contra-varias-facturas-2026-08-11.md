# Pareo de un movimiento contra varias facturas

Caso real: el memo `COMERCIAL EL GUACHARO F241714 1860 61 77` corresponde a las facturas 0000241714, 0000241860, 0000241861 y 0000241877. Hoy el motor solo busca una factura por movimiento y solo entiende números completos, así que este pago no se parea.

## Qué cambia

### 1. Leer números abreviados del memo

Los memos escriben la primera factura completa y las siguientes solo con los dígitos finales. Nueva lectura:

- Se toma el primer número "largo" del memo como **base** (ej. 241714).
- Cada número corto que venga después se completa reemplazando los últimos dígitos de la base: `1860` -> 241860, `61` -> 241861, `77` -> 241877.
- También se prueba el token tal cual (por si es un número completo distinto).
- Solo se aceptan los candidatos que existan realmente como factura de compra en el sistema; los que no existan se descartan (evita inventar números).

### 2. Pareo múltiple (un movimiento -> varias facturas)

El motor pasa a devolver un **conjunto** de facturas en vez de una sola:

- Se agrupan las facturas encontradas por el memo, exigiendo que sean del mismo proveedor cuando el proveedor es identificable.
- Si la **suma** de las facturas coincide con el monto del movimiento (±1%) -> **Pareado**.
- Si los números coinciden pero la suma no cuadra -> **Posible pareo**, indicando la diferencia.
- Si no hay números, se mantiene la lógica actual (proveedor + monto, monto + fecha, etc.), ahora con un extra: si varias facturas del mismo proveedor **suman** el monto del movimiento (hasta 4 facturas, fechas dentro de ±30 días), se propone ese grupo como **Posible pareo**.

### 3. Cómo se ve

- La celda de conciliación muestra la lista de facturas sugeridas (número + monto) y el total del grupo, con el proveedor.
- El botón "Confirmar" acepta todo el grupo; "Rechazar" lo descarta completo.
- El Excel exporta los números de factura separados por coma y el total pareado.

### 4. Guardado y origen del pareo

Hoy la tabla de conciliación admite una sola factura por movimiento. Se ajusta para permitir varias filas por movimiento (una por factura), conservando lo ya confirmado. Cada vínculo guarda además si el pareo fue **automático** (aceptado tal cual lo sugirió el sistema) o **manual** (elegido o corregido por una persona), con quién y cuándo.

### 5. Columna y filtro "Origen del pareo"

En Movimientos bancarios se agrega la columna **Origen del pareo** con tres valores: Automático, Manual y — (sin pareo). Se puede filtrar por ese valor igual que por estado, y sale también en el Excel.

## Parte 2 — Pareo desde Cuentas por pagar

Nueva sección de conciliación en el tab de **Cuentas por pagar**:

- Cada CxP muestra su estado de pareo contra movimientos bancarios: Pareada, Posible, Sin pareo, con el movimiento (o movimientos) sugeridos: fecha, banco, memo y monto.
- Funciona en ambos sentidos: **una CxP puede estar cubierta por varios movimientos** (pagos parciales) y **un movimiento puede cubrir varias CxP/notas**. Se muestra el total pareado y el saldo por conciliar.
- Botones "Confirmar" / "Rechazar" por sugerencia, más un buscador para **elegir manualmente** uno o varios movimientos (por banco, fecha, monto o memo).
- Columna **Origen del pareo** (Automático / Manual) y filtro, igual que en Movimientos bancarios.
- Los vínculos son los mismos registros que usa Movimientos bancarios, así que confirmar desde un lado se refleja de inmediato en el otro.
- El Excel de CxP incluye estado de pareo, movimientos pareados, total pareado y origen.

## Detalle técnico

- `src/lib/conciliacion-matching.ts`: nuevas funciones `expandirNumerosMemo(memo, numerosConocidos)` y `buscarCombinacionPorMonto`; `parearMovimiento` devuelve `facturas: FacturaRef[]` (se mantiene `factura` como la primera, para compatibilidad) y un `total` del grupo. Se agrega el índice inverso (por factura -> movimientos) reutilizando la misma función de pareo.
- `src/routes/_authenticated/movimientos-bancarios.tsx`: el estado guardado pasa a leerse como lista por movimiento; `guardarVinculo` inserta/borra el conjunto de vínculos; celda, filtros y export muestran múltiples facturas y el origen.
- `src/routes/_authenticated/cxp.tsx`: nueva celda de conciliación con sugerencias, selector manual de movimientos, columna/filtro de origen y export ampliado. La lógica compartida se extrae a un hook `useConciliacion`.
- Migración: reemplazar el índice único `conciliacion_bancaria_transaccion_bancaria_id_key` por único en `(transaccion_bancaria_id, transaccion_factura_id)`; agregar columna `origen` ('auto' | 'manual', por defecto 'manual'). Sin borrado de datos.

