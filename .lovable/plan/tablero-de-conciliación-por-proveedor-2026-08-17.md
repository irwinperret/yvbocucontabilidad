# Tablero de conciliación por proveedor

Hoy el pareo se edita movimiento por movimiento, desde Movimientos bancarios. Con 887 movimientos bancarios y 296 cuentas por pagar abiertas, y 876 movimientos aún sin vínculo, eso es demasiado lento. La solución es una vista de trabajo por proveedor donde se vean juntas sus facturas y sus movimientos, y se pueda arrastrar de una a otra.

## Cómo se va a usar

1. En **Proveedores**, cada fila se vuelve clickeable y lleva a la ficha de conciliación de ese proveedor. Arriba de la lista, tarjetas con el conteo de facturas huérfanas y movimientos huérfanos por proveedor, ordenables, para atacar primero a los peores.
2. La lista incluye una entrada especial **"Sin proveedor"**: bandeja única con todos los movimientos y facturas que no tienen tercero asignado.
3. Dentro de la ficha del proveedor:
   - **Facturas del proveedor**: cada factura es una tarjeta con su monto, saldo pendiente (USD BCV revaluado) y debajo los movimientos ya pareados.
   - Se puede **arrastrar un movimiento** de una factura a otra, o soltarlo en la zona de huérfanos para desasignarlo.
   - Filtro de facturas: abiertas (por defecto) / todas / pagadas.
   - **Zona inferior en dos columnas**: "Movimientos huérfanos" y "Facturas huérfanas" de ese proveedor. Desde ahí se arrastra un movimiento a la factura que le corresponde.
   - Cada movimiento y cada factura tiene un menú para **cambiar de proveedor** o **quitar el proveedor** (pasa a la bandeja "Sin proveedor").
   - Un movimiento sin factura se puede marcar como **Gasto directo (sin factura)** o **No aplica (no contable)** con un botón, sin salir de la vista; eso lo saca de "huérfanos" y lo deja correctamente registrado.

## Efecto contable

Soltar un movimiento sobre una factura hace exactamente lo mismo que el pareo manual actual: crea el pago 13.2, descuenta el saldo de la CxP revaluando la deuda en USD BCV a la tasa del día del movimiento, y guarda el vínculo de conciliación como manual. Desasignar (o mover a otra factura) revierte primero el pago anterior y devuelve el saldo a la CxP, igual que "Quitar pareo" hoy. No se generan transacciones de diferencial cambiario.

Si el movimiento es mayor que el saldo de la factura, se pregunta igual que hoy: dejar el excedente sin aplicar o registrarlo como anticipo (14.2).

## Recomendaciones adicionales para reducir huérfanos

- **Sugerencias en línea**: en la columna de movimientos huérfanos, mostrar bajo cada movimiento la factura candidata que propone el motor de pareo (mismo monto ±0,5%, fecha cercana, número en el memo) con un botón "Aceptar", además del arrastre.
- **Emparejar por monto en un click**: botón "Parear automáticamente lo evidente" a nivel de proveedor, que aplica solo los casos con coincidencia exacta de monto y sin ambigüedad, y muestra un resumen antes de confirmar.
- **Pareo N:M**: permitir soltar varios movimientos sobre una misma factura (pagos parciales) y seleccionar varias facturas para un solo movimiento (pago agrupado), que es el caso más común con Xetux.
- **Alias de proveedor**: guardar los textos de memo bancario que ya se resolvieron a un proveedor, para que las próximas importaciones asignen el tercero automáticamente y no nazcan huérfanas.
- **Semáforo de salud**: en la lista de proveedores, % de facturas pareadas y monto huérfano acumulado, para medir el avance.
- **Exportar a Excel** el estado de conciliación del proveedor (facturas, movimientos, saldo sin explicar) para revisarlo con el proveedor.

## Detalles técnicos

- Nueva ruta `src/routes/_authenticated/proveedores/$id.tsx` (ficha de conciliación) y `proveedores/index.tsx` para la lista actual; la fila enlaza a la ficha. La bandeja usa el id especial `sin-proveedor`.
- Drag and drop con `@dnd-kit/core` (arrastre entre contenedores, accesible y con soporte táctil).
- Reutilizar la lógica ya existente en vez de duplicarla: extraer de `src/components/pareo-manual-dialog.tsx` las funciones `aplicarPareo` (pagos 13.2 + actualización de CxP) y `quitarPareoManual` a `src/lib/pareo-cxp.ts`, y usar `guardarVinculosConciliacion` / `marcarEstadoConciliacion` de `src/lib/conciliacion.ts`, más `pendienteBsAFecha` / `pendienteUsdBcv` de `src/lib/cxp-saldo.ts`.
- Cambiar de proveedor actualiza `transacciones.tercero_id` (movimientos) o `cuentas_por_pagar.tercero_id` + la transacción de la factura, con `logAudit` en cada cambio.
- Las consultas se cargan por proveedor (facturas, movimientos con `tercero_id` y movimientos sin proveedor cuyo memo apunta al proveedor) usando `fetchAllRows`, e invalidan las queries `conciliacion-bancaria`, `mov-bancarios` y `cxp-analisis` al guardar.
- Toda escritura sigue restringida a los usuarios admin por las políticas ya existentes.
