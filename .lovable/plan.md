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

---

# Revertir importación: también quitar los diferenciales cambiarios

## Qué pasa

Al pagar facturas durante la importación bancaria, el sistema crea asientos de "diferencial cambiario" (cuentas 7.2 pérdida / 11.1 ganancia). Verificado en la base: las 187 filas existentes (173 en 7.2, 14 en 11.1) se guardaron **sin lote de importación**, porque el helper que las registra no recibe ese dato. Como la reversión borra por lote, esos asientos quedan huérfanos.

## Arreglo

1. **Hacia adelante:** al registrar el diferencial durante la importación bancaria, guardarlo con el mismo lote de importación (y el mismo grupo de transacción del pago), para que la reversión lo arrastre sin lógica extra.
2. **Reversión y purgas:** ampliar la función de reversión (y las de purga de revertidas / purga total) para borrar también los asientos de 7.2 y 11.1 que compartan grupo de transacción con las transacciones del lote, cubriendo los que ya existen sin lote.
3. **Datos existentes:** asignar el lote correspondiente a los diferenciales actuales cuando su grupo coincida con transacciones de un lote; los que no tengan grupo se resuelven igual por la regla de grupo del punto 2.

## Verificación

Revertir un lote de movimientos bancarios y confirmar que no quedan filas en 7.2/11.1 asociadas a ese lote, además de que las cuentas por pagar vuelven a su saldo anterior.
