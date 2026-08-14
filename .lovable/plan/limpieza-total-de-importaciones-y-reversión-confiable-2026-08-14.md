# Limpieza total de importaciones y reversión confiable

## Qué encontré (verificado en la base de datos)

- Hay **8.472 transacciones**: 8.324 vienen de importaciones y solo **148 son manuales** (35 de ellas en standby).
- **4.826 transacciones siguen vivas apuntando a cargas ya marcadas como "revertida"**. Esa es exactamente la "reversión a medias" que describes: la carga se marcó revertida pero sus transacciones nunca se borraron.
- Otros datos derivados de importaciones: 412 cuentas por pagar, 413 propinas, 21 registros de conciliación bancaria.
- Historial de importaciones: 16 cargas (4 activas, 12 revertidas).

## Qué voy a hacer

### 1. Borrado total de lo importado
Eliminar todo lo que provenga de cualquier carga (activa o revertida), en orden seguro para que no queden restos:
conciliaciones bancarias → propinas → cuentas por cobrar → cuentas por pagar → transacciones.
Se conservan **únicamente las 148 transacciones registradas manualmente** (incluidas las 35 en standby) y todo lo que no dependa de importaciones: tasas, terceros, cuentas bancarias, plan de cuentas, inventarios y cierres.

También se restauran las cuentas por pagar manuales que alguna carga hubiera marcado como pagadas, devolviéndolas a su estado anterior.

### 2. Reset del historial de importaciones
Vaciar por completo la tabla del historial, para que la pestaña "Historial de importaciones" arranque limpia.

### 3. Botón "Borrar revertidas" en el historial
En la pestaña Historial de importaciones, junto a los filtros, un botón (solo admin) que:
- Muestra cuántas cargas revertidas hay y qué restos siguen asociadas a ellas.
- Pide confirmación escrita.
- Borra en cascada todos los restos de esas cargas y luego el registro de la carga.

### 4. Reversión que ya no deja rastros
Hoy la reversión se hace desde el navegador con varias llamadas sueltas; si una falla, la carga igual queda marcada como revertida y las filas quedan huérfanas. Cambio a una operación única en el servidor que:
- Borra conciliaciones, propinas, CxC, CxP y transacciones de la carga en una sola transacción atómica.
- Si algo falla, **no** marca la carga como revertida (todo o nada).
- Al terminar, verifica que no quede ninguna fila asociada al lote y reporta el conteo real de lo borrado.

## Detalles técnicos

- Limpieza y reset vía sentencias de datos (`DELETE`) ejecutadas por lotes con dependencias en orden; `conciliacion_bancaria` ya tiene `ON DELETE CASCADE` hacia transacciones.
- Nueva función SQL `security definer` `revertir_importacion(batch_id uuid)` que hace todo el borrado en una sola transacción y devuelve los conteos; `src/lib/import-batches.ts` pasa a llamarla en vez de encadenar borrados desde el cliente.
- Nueva función `purgar_importaciones_revertidas()` para el botón, reutilizando la misma lógica.
- `src/routes/_authenticated/importaciones.tsx`: botón "Borrar revertidas" con diálogo de confirmación, restringido a los correos admin ya definidos.
