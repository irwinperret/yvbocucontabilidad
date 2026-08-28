# Operaciones de cambio (cuenta 98) fuera de la conciliación de facturas

Las operaciones de cambio nunca tienen factura ni proveedor. Hoy el motor de pareo ya las marca como "No aplica", pero siguen entrando por otras puertas: el importador de movimientos puede adivinarles un proveedor desde el memo, y el portal de proveedores las lista como "movimientos sin factura" (aparecen bajo *Sin proveedor* y se les puede arrastrar facturas o asignarles un proveedor a mano).

El cambio aplica **solo a la cuenta 98**. La 99 (No contable) se deja exactamente como está hoy, incluida la deducción automática de proveedor.

Estado verificado en la base: hay 22 transacciones en cuentas 98/99 (14 provenientes del banco), ninguna con proveedor asignado hoy, y un solo registro de conciliación, ya marcado como "no contable". O sea: el riesgo es de flujo, no hay daño acumulado grande — igual se limpia lo que aparezca en 98.

## Qué se hará

### 1. Regla única "cuenta no conciliable"
Una sola función central declara que la cuenta 98 (Operaciones de cambio) no requiere factura, no admite proveedor y no participa en ningún pareo. Todas las pantallas la consultan en vez de repetir listas.

### 2. Importación de movimientos bancarios
- Nunca se adivina proveedor ni número de factura para un movimiento de 98: queda sin proveedor siempre.
- Al registrarse, queda automáticamente en estado **No aplica (no contable)**, sin pasar por revisión manual.

### 3. Portal de proveedores
- Los movimientos de 98 se excluyen por completo del tablero: no aparecen en la columna de movimientos, ni bajo "Sin proveedor", ni en la tarjeta de "movimientos sin factura".
- Al no listarse, no se les puede arrastrar facturas ni reasignar proveedor.

### 4. Movimientos bancarios
- Las filas de 98 muestran el chip **No contable** y no ofrecen el panel de pareo manual ni la asignación de proveedor; en su lugar un texto corto explica que las operaciones de cambio no se concilian.
- El botón "Recalcular pareos" las respeta y las deja en No aplica.

### 5. Al reclasificar una transacción a 98
Si desde el diálogo de edición se cambia la cuenta de una transacción a 98, se limpia su proveedor y se eliminan los vínculos de conciliación que tuviera, dejándola como no contable.

### 6. Limpieza de datos existentes
- Quitar proveedor a cualquier transacción de 98 que lo tenga.
- Borrar vínculos de conciliación de movimientos 98 contra facturas y dejar todos esos movimientos en estado No aplica (no contable).
- No se tocan montos, fechas ni cuentas bancarias, ni nada de la cuenta 99.

## Detalles técnicos

- `src/lib/operaciones-cambio.ts`: exportar `esCuentaNoConciliable(codigo)` (solo `98`) y reutilizarla desde las pantallas. `CUENTAS_SIN_FACTURA` en `conciliacion-matching.ts` y `cuentaSinFactura()` en `conciliacion.ts` no cambian (98 y 99 ya están ahí).
- `src/routes/_authenticated/importar-movimientos.tsx`: forzar `tercero_id: null` y `numero_factura: null` cuando la cuenta es 98; marcar `estado: "no_contable"` vía `marcarEstadoConciliacion` al insertar.
- `src/routes/_authenticated/proveedores/$id.tsx`: filtrar la consulta `tablero-movs` con `neq("cuenta_codigo", "98")` y excluirlas de los cálculos de resumen.
- `src/routes/_authenticated/movimientos-bancarios.tsx`: ocultar acciones de pareo/proveedor para la cuenta 98; `pareo-manual-dialog` no se abre para esas filas.
- `src/components/transaccion-edit-dialog.tsx`: al guardar con cuenta 98, `tercero_id = null` y borrado de filas de `conciliacion_bancaria` del movimiento.
- Operación de datos (sin cambios de esquema): limpieza descrita en el punto 6, acotada a `cuenta_codigo = '98'`.
