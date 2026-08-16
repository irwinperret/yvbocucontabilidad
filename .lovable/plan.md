# Corregir "DELETE requires a WHERE clause" al borrar todo lo importado

## Qué pasa

El botón "Borrar todo lo importado" llama a una función de base de datos que hace dos borrados totales sin condición: uno sobre las conciliaciones bancarias y otro sobre el historial de importaciones. La base de datos tiene activada una protección que rechaza cualquier borrado sin condición, así que la operación falla completa y no se borra nada.

## Arreglo

Migración que recrea la función de purga cambiando únicamente esos dos borrados para que lleven una condición explícita (equivalente a "todas las filas"), sin tocar el resto de la lógica ni el orden de las operaciones.

- `DELETE FROM public.conciliacion_bancaria` → agrega `WHERE true`
- `DELETE FROM public.importaciones` → agrega `WHERE true`

Todo lo demás (qué se considera importado, restauración de referencias, conteos devueltos y la verificación de rol admin) queda igual.

## Verificación

Tras aplicar la migración, ejecutar el botón desde Transacciones y confirmar que devuelve los conteos y que no quedan transacciones con lote de importación, referencias `BANK:`/`PAREO:`/`xetux`, ni filas en conciliación e historial de importaciones.
