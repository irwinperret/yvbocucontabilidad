# Corregir movimientos INV registrados como compras (2.1)

## Problema

En la importación de movimientos bancarios, el mapa de categoría → cuenta asigna automáticamente la categoría **INV** a la cuenta **2.1 Compras de mercancía**. Como resultado, un pago bancario se registra como una compra nueva, sin proveedor, en lugar de emparejarse contra la cuenta por pagar que ya existe. Esto infla el COGS.

Verificado en la base de datos: hay **206 transacciones activas** en 2.1 con notas "Conciliación bancaria sin factura…" y sin proveedor, por un total de Bs 21.388.661,55.

## Cambios en la importación

1. Eliminar `INV: "2.1"` del mapa de fallback por categoría. Quedan solo ADM, MO, OC, MERCADEO, INVERSION.
2. Las filas INV quedan sin cuenta (`cuentaCodigo: null`) para que el usuario las empareje manualmente con su CxP, o use el botón existente "Asignar 99 — POR DETERMINAR".
3. Nuevo distintivo visual: las filas de categoría INV sin CxP emparejada muestran un badge azul **"Requiere emparejamiento con CxP"** en lugar del badge naranja genérico "Sin factura", y quedan excluidas del camino "no aplica factura".

## Limpieza retroactiva

Poner en standby las 206 transacciones afectadas (`standby = true`, `standby_at = now()`), de modo que dejen de afectar COGS y reportes. Quedan recuperables desde el tab Standby, y los movimientos correspondientes se pueden volver a importar y emparejar contra sus CxP.

## Detalles técnicos

- `src/routes/_authenticated/importar-movimientos.tsx`: quitar la entrada INV de `CATEGORIA_CUENTA`; agregar helper `requiereCxP(bankRow)` (categoría normalizada === "INV") usado para (a) forzar que la fila entre al motor de emparejamiento y nunca a la rama `noAplica`, y (b) renderizar el badge nuevo en la celda de concepto.
- Actualización de datos (no migración de esquema): `UPDATE transacciones SET standby = true, standby_at = now() WHERE cuenta_codigo = '2.1' AND notas LIKE 'Conciliación bancaria sin factura%' AND tercero_id IS NULL;`
