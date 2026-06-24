## Problema

En `src/routes/_authenticated/importar-ventas.tsx`, `syncPropina` solo inserta/actualiza la fila en `propinas` apuntando `transaccion_id` a la venta. No crea movimiento contable en `13.1 Propinas por pagar al personal`, por lo que la propina aparece en el tab Propinas pero no en Transacciones, y `transaccion_entrada_id` queda vacío.

## Cambios

### 1. `syncPropina` (importar-ventas.tsx, líneas 272–296)

Replicar el patrón de `syncBono`: antes de tocar la tabla `propinas`, hacer upsert manual de una transacción contable en `13.1` y obtener su `id`.

- Dedupe key: `referencia='xetux'` + `cuenta_codigo='13.1'` + `numero_factura` (si existe) o `numero_orden`.
- Payload de la transacción 13.1:
  - `fecha`, `centro_costo` = los de la fila
  - `cuenta_codigo = '13.1'`, `modo = 'on_balance'`
  - `monto_bs = propinaBs`, `monto_base_bs = propinaBs`, `iva_bs = 0`, `iva_aplica = false`
  - `monto_usd = propinaUsdPar` (ya calculado a paralela), `tasa_bcv`, `tasa_paralela`
  - `metodo_pago` = el de la venta (`r.metodo_pago` mapeado) si está disponible, si no `'pendiente'`
  - `referencia = 'xetux'`, `numero_factura`, `numero_orden`
  - `grupo_transaccion_id`: pasar el `grupoId` de la venta (firmar `syncPropina` con `grupoId` igual que `syncBono`)
  - `notas`: `Xetux · Propina · factura ${numero_factura} · ${cliente}`
  - `created_by: user.id`
- Si existe → update; si no → insert returning `id`.
- Pasar ese `id` como `transaccion_entrada_id` en el payload de `propinas`. Mantener `transaccion_id` apuntando a la venta (`txId`) para trazabilidad.

Actualizar las dos llamadas a `syncPropina` (líneas 476 y 523) para pasar `grupoId`/`grupoExistente` y el `metodo_pago` de la venta.

### 2. Retroactivo

Actualmente hay **0** filas en `propinas` con `referencia='xetux'` (se limpiaron en el turno anterior), por lo que no hay backfill que ejecutar. La próxima importación generará los movimientos 13.1 correctamente y enlazará `transaccion_entrada_id` desde el inicio. No se requiere migración de datos.

## Verificación

Después de implementar:
1. Re-importar un reporte Xetux de prueba.
2. Confirmar en Transacciones que aparecen las legs `13.1` con `referencia='xetux'`.
3. Confirmar en `propinas` que `transaccion_entrada_id` está poblado.
4. Re-importar el mismo archivo y confirmar que no se duplican (update path).
