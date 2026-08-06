# Log de importaciones con opción de revertir

Cada vez que se sube un archivo desde "Importar ventas (Xetux)", "Importar compras (Xetux)" o "Importar movimientos bancarios" se guardará un registro de esa carga, y desde una nueva pestaña se podrá ver el historial y deshacer una carga completa con todo lo que generó.

## 1. Registro de cada carga

Al confirmar una importación se guarda:

- Tipo de importación (ventas / compras / movimientos bancarios)
- Nombre del archivo y su tamaño
- Fecha y hora, y quién la hizo
- Rango de fechas de los movimientos incluidos
- Totales: filas leídas, filas registradas, filas omitidas por duplicado, monto total en Bs y USD
- Estado: activa o revertida (con fecha de reversión y quién la revirtió)

Cada transacción creada por esa carga queda ligada al registro de la carga, igual que las cuentas por cobrar, cuentas por pagar, propinas y snapshots que se deriven de ella.

## 2. Nueva pestaña "Importaciones"

Ubicada en el menú lateral junto a las páginas de importación. Muestra una tabla con: fecha/hora, tipo, archivo, usuario, filas registradas, montos, estado.

Al expandir una fila se ve el detalle de lo que generó esa carga: número de transacciones, cuentas por pagar, cuentas por cobrar, propinas y anticipos creados.

## 3. Revertir una carga

Botón "Revertir" en cada carga activa (solo para los usuarios administradores).

Antes de ejecutar se muestra una confirmación con el resumen exacto de lo que se va a eliminar y de lo que se va a restaurar. La reversión:

1. Elimina todas las transacciones creadas por esa carga, incluidas las líneas derivadas (IVA, propinas, diferencial cambiario, anticipos, parejas off-balance).
2. Elimina las cuentas por cobrar y por pagar creadas por esa carga.
3. **Restaura** las cuentas por pagar que esa carga marcó como pagadas o parciales: vuelven a "pendiente" con su monto pendiente original y sin fecha de pago.
4. Revierte las aplicaciones de anticipo que esa carga haya hecho (devuelve el saldo aplicado y el estado del anticipo).
5. Marca la carga como "revertida" y deja constancia en auditoría.

Bloqueos: si alguna transacción de la carga cae en un mes cerrado, la reversión se rechaza con el aviso de reabrir el mes primero. Una carga revertida no se puede revertir de nuevo, pero el archivo se puede volver a importar (la deduplicación por huella ya no lo bloquea porque las huellas se eliminan con las transacciones).

## 4. Importaciones anteriores

Las cargas hechas antes de este cambio no tienen registro asociado, así que no aparecerán en el historial ni se podrán revertir desde ahí. El historial arranca desde la primera importación posterior al cambio.

## Detalles técnicos

- Migración: nueva tabla `public.import_batches` (tipo, archivo_nombre, archivo_tamano, fecha_desde, fecha_hasta, filas_leidas, filas_registradas, filas_omitidas, total_bs, total_usd, estado, created_by, reverted_at, reverted_by, meta jsonb) con GRANTs, RLS (lectura para autenticados; escritura/reversión restringida a los correos admin actuales) y trigger de `updated_at`.
- Migración: columna `import_batch_id uuid` (nullable, índice) en `transacciones`, `cuentas_por_pagar`, `cuentas_por_cobrar`, `propinas`; y en `cuentas_por_pagar` columnas de respaldo `revert_estado_anterior`, `revert_pendiente_bs_anterior`, `revert_pendiente_usd_bcv_anterior`, `revert_pagada_at_anterior` que la importación llena al marcar una factura como pagada, para restaurar exactamente el estado previo.
- Nuevo `src/lib/import-batches.ts`: `crearBatch()`, `analizarReversion(batchId)` y `ejecutarReversion(batchId)`, reutilizando los patrones de `src/lib/eliminar-transaccion.ts` (orden CxC → CxP → propinas → romper FK `pareja_off_balance_id` → transacciones) y `isPeriodClosed` / `logAudit` de `src/lib/audit.ts`.
- Reversión de anticipos: para las líneas 14.2 negativas del batch se recalcula `anticipo_aplicado_usd_bcv` / `anticipo_estado` de la transacción de anticipo origen.
- Cambios en `importar-ventas.tsx`, `importar-compras.tsx` e `importar-movimientos.tsx`: crear el batch al inicio de la confirmación y propagar `import_batch_id` en cada insert; al final actualizar los totales del batch.
- Nueva ruta `src/routes/_authenticated/importaciones.tsx` + ítem en `src/components/app-sidebar.tsx`.
- Invalidación de queries de transacciones, CxP, CxC y saldos al revertir.
