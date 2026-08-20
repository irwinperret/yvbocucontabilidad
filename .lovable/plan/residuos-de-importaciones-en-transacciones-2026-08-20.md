# Residuos de importaciones en Transacciones

## Qué encontré (verificado en la base de datos)

- El historial de importaciones está **vacío** (0 cargas), así que ya no hay nada que revertir desde esa pantalla.
- Aun así quedan **39 transacciones de origen importado** sin lote asociado (`import_batch_id` vacío), por eso la reversión nunca las tocó:
  - **28** movimientos bancarios (referencia `BANK:…`): 1 creada hoy 16:23 y 27 creadas hoy 23:12–23:13.
  - **9** compras Xetux (referencia `xetux`), del backfill retroactivo del 19-ago.
  - **2** transacciones generadas por pareo (referencia `PAREO:…`).
- El resto (148 sin referencia + manuales) son registros manuales legítimos: nómina, liquidaciones, inventario, etc.

## Por qué pasa

1. El etiquetado del lote se hace **al final** de la importación (`cerrarBatch` marca "todo lo creado desde que empezó"). Si el proceso se interrumpe, falla ese paso, o algunas filas se insertan **después** de cerrar el lote (pareos, gastos directos, excedentes), esas filas quedan sin lote y sobreviven a la reversión.
2. La relación con el historial borra el lote pero **deja la transacción huérfana** en vez de arrastrarla, así que borrar cargas revertidas también puede dejar rastros.

## Qué propongo hacer

**1. Limpiar lo que quedó ahora**
- Nueva sección en Historial de importaciones: **"Residuos de importaciones"**, que lista las transacciones de origen importado sin lote (`BANK:`, `xetux`, `PAREO:`), con fecha, cuenta, monto y origen.
- Botón para revisarlas y borrarlas en bloque, usando la misma lógica segura de reversión (restaurar CxP a pendiente, borrar conciliaciones y diferenciales asociados). Nunca toca transacciones manuales ni las que están en standby.

**2. Que no vuelva a pasar**
- Etiquetar cada fila con el lote **en el momento del insert** en las tres importaciones (movimientos, compras/ventas Xetux, ajustes) y también en los pareos y gastos directos que nacen del importador, en lugar de depender del etiquetado posterior.
- Reforzar `cerrarBatch` con una red de seguridad: adoptar además cualquier fila reciente con referencia de origen importado que siga sin lote.
- Al revertir, borrar también por huella de origen (`BANK:…`, `xetux` del mismo rango de fechas) para que no queden restos parciales.

## Detalle técnico

- `src/lib/import-batches.ts`: pasar `batchId` a los inserts; ampliar `cerrarBatch` con fallback por `referencia`; añadir `listarResiduos()` y `purgarResiduos(ids)`.
- Función SQL nueva `purgar_transacciones_huerfanas(p_ids uuid[])` (solo admin), que reutiliza los pasos de `purgar_filas_importacion` (conciliaciones, diferenciales 7.2/11.1, restauración de CxP) para un conjunto de transacciones sin lote.
- `src/routes/_authenticated/importar-movimientos.tsx`, `importar-compras.tsx`, `importar-ventas.tsx`, `importar-ajustes.tsx`: `import_batch_id: batch?.id` en todos los inserts derivados.
- Historial de importaciones: nueva tarjeta con la tabla de residuos y acción de borrado con confirmación.
