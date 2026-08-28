# Operaciones de cambio (cuenta 98) fuera de la conciliación de facturas

Las operaciones de cambio nunca tienen factura ni proveedor. Hoy el motor de pareo ya las marca como "No aplica", pero siguen entrando por otras puertas: el importador de movimientos puede adivinarles un proveedor desde el memo, y el portal de proveedores las lista como "movimientos sin factura" (aparecen bajo *Sin proveedor* y se les puede arrastrar facturas o asignarles un proveedor a mano).

Estado verificado en la base: hay 22 transacciones en cuentas 98/99 (14 provenientes del banco), ninguna con proveedor asignado hoy, y un solo registro de conciliación, ya marcado como "no contable". O sea: el riesgo es de flujo, no hay daño acumulado grande — igual se limpia lo que aparezca.

## Qué se hará

### 1. Regla única "cuenta no conciliable"
Una sola función central declara que 98 (Operaciones de cambio) y 99 (No contable) no requieren factura, no admiten proveedor y no participan en ningún pareo. Todas las pantallas la consultan en vez de repetir listas.

### 2. Importación de movimientos bancarios
- Nunca se adivina proveedor ni número de factura para un movimiento de 98/99: quedan sin proveedor siempre.
- Al registrarse, quedan automáticamente en estado **No aplica (no contable)**, sin pasar por revisión manual.

### 3. Portal de proveedores
- Los movimientos de 98/99 se excluyen por completo del tablero: no aparecen en la columna de movimientos, ni bajo "Sin proveedor", ni en la tarjeta de "movimientos sin factura".
- Al no listarse, no se les puede arrastrar facturas ni reasignar proveedor.

### 4. Movimientos bancarios
- Las filas de 98/99 muestran el chip **No contable** y no ofrecen el panel de pareo manual ni la asignación de proveedor; en su lugar un texto corto explica que las operaciones de cambio no se concilian.
- El botón "Recalcular pareos" las respeta y las deja en No aplica.

### 5. Al reclasificar una transacción a 98/99
Si desde el diálogo de edición se cambia la cuenta de una transacción a 98 o 99, se limpia su proveedor y se eliminan los vínculos de conciliación que tuviera, dejándola como no contable.

### 6. Limpieza de datos existentes
- Quitar proveedor a cualquier transacción de 98/99 que lo tenga.
- Borrar vínculos de conciliación de movimientos 98/99 contra facturas y dejar todos esos movimientos en estado No aplica (no contable).
- No se tocan montos, fechas ni cuentas bancarias.

## Detalles técnicos

- `src/lib/operaciones-cambio.ts`: exportar `esCuentaNoConciliable(codigo)` (98, 99) y reutilizarla desde `src/lib/conciliacion-matching.ts` (`CUENTAS_SIN_FACTURA` sigue igual pero deriva de ahí).
- `src/routes/_authenticated/importar-movimientos.tsx`: forzar `tercero_id: null` y `numero_factura: null` cuando la cuenta es no conciliable; marcar `estado: "no_contable"` vía `marcarEstadoConciliacion` al insertar.
- `src/routes/_authenticated/proveedores/$id.tsx`: filtrar la consulta `tablero-movs` con `not("cuenta_codigo","in","(98,99)")` y excluirlas de los cálculos de resumen.
- `src/routes/_authenticated/movimientos-bancarios.tsx`: ocultar acciones de pareo/proveedor para esas cuentas; `pareo-manual-dialog` no se abre para ellas.
- `src/components/transaccion-edit-dialog.tsx`: al guardar con cuenta 98/99, `tercero_id = null` y borrado de filas de `conciliacion_bancaria` del movimiento.
- Operación de datos (sin cambios de esquema): limpieza descrita en el punto 6.
