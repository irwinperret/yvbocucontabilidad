## Objetivo

Añadir un botón "Editar" (ícono lápiz) a cada fila del listado de compras en la pestaña **COGS e Inventario** (`src/routes/_authenticated/registrar.tsx`), abriendo un diálogo con **todos** los campos editables. Al guardar, se recalculan los USD (neto, IVA, total, USD BCV) usando las tasas de la fecha, y se sincronizan las filas dependientes (CxP y `periodo` si cambia la fecha).

Los anticipos aplicados a la factura permanecen intactos — se recalcula el saldo de CxP asumiendo que la porción cubierta por anticipos no cambia.

## Diálogo de edición

Componente nuevo `EditCompraDialog` (local en `registrar.tsx`), reutilizando los mismos controles que el formulario de alta:

- **Fecha** (`date`) → recalcula `periodo`, `tasa_bcv`, `tasa_paralela` sugeridas de esa fecha.
- **Proveedor** (autocomplete de terceros).
- **N° factura** (con verificación de duplicado excluyendo el propio `id`).
- **Moneda** de entrada (Bs / USD), **Monto neto**, **IVA aplica** + **Monto IVA**, **Tasa BCV** (editable), sugerida por fecha.
- **Off-balance** (switch).
- **Pagada / CxP** (radio) y, si pagada, **Cuenta bancaria**.
- **Vencimiento** (solo si CxP).
- **Notas**.

Deshabilitados: aplicación de anticipos (los aplicados no se pueden reasignar desde este diálogo; para eso, borrar y recrear). Se muestra un aviso `"Esta compra tiene $X en anticipos aplicados — no se pueden reasignar desde aquí"` cuando corresponda.

## Guardado (`updateCompra`)

1. **Validaciones**: mismos toasts que el alta (monto, tasa, proveedor, N° factura, banco si pagada). Bloquear si el mes del `periodo` actual o el nuevo `periodo` ya está cerrado (`cierres_de_mes` con `estado = 'cerrado'`).
2. **Duplicado**: rechazar si otro `inventario_snapshots` distinto tiene el mismo `tercero_id + numero_factura`.
3. **Recalcular** con la lógica actual de `addCompra`:
   - `montoBs`, `montoBase`, `montoIva`, `montoUsd` (paralela con fallback BCV), `montoUsdBcv`, `baseUsd`, `ivaUsd`, `periodo`.
4. **Anticipos ya aplicados**: leer `aplicado_usd_bcv_total` = suma de reversos negativos en `transacciones` (cuenta `14.2`) con `grupo_transaccion_id = snap.grupo_transaccion_id`. Ese monto no se toca.
5. **Saldo CxP nuevo**: `cxpSaldoBs = max(0, montoBsNuevo - aplicadoBsAntic)`, `cxpSaldoUsdBcv`, `cxpSaldoUsdPar`.
6. **Snapshot**: `UPDATE inventario_snapshots` con todos los campos recalculados; `pagada` = booleano según el estado + saldo; `cuenta_bancaria_id` solo si pagada sin CxP.
7. **CxP asociada** (`snap.cxp_id`):
   - Si existía y ahora queda pagada (saldo ≤ 0.01 o usuario marcó "pagada"): borrar CxP.
   - Si existía y sigue abierta: `UPDATE` con nuevos `monto_bs`, `monto_pendiente_bs`, `usd_bcv_factura`, `usd_paralelo_factura`, `tasa_*`, `fecha_vencimiento`, `proveedor`.
   - Si no existía y ahora debe crearse: `INSERT` (misma forma que `addCompra`).
8. **Aviso**: si había pagos parciales de la CxP (transacciones `Pago CxP` con el mismo `grupo_transaccion_id`), mostrar toast informativo `"Revisar pagos ya efectuados: $X pagado antes de la edición"` — no se auto-ajustan.
9. Invalidar queries: `compras-periodo`, `cxp`, `anticipos-abiertos`, `anticipos-proveedor`.

## UI del listado

En la tabla de compras dentro del cierre (`src/routes/_authenticated/registrar.tsx`, sección `{(compras ?? []).length > 0 && ...}`):

- Añadir botón lápiz (`<Pencil className="h-3.5 w-3.5" />`) a la izquierda del botón "×" existente, mismo estilo ghost.
- Deshabilitar ambos botones (editar y borrar) si el mes está cerrado (`cierreActual?.estado === 'cerrado'`), con tooltip "Mes cerrado, reabrir para editar".
- Al hacer click abre `EditCompraDialog` con el snapshot precargado.

## Fuera de alcance

- Reasignación de anticipos aplicados (requiere flujo distinto — borrar y recrear).
- Ajuste retroactivo de pagos CxP ya efectuados (solo se avisa, no se recalculan).
- Edición desde la tabla principal de Transacciones (esas son las 2.2 auto-generadas por cierre; ya se manejan con "Reabrir mes").

## Archivos

- `src/routes/_authenticated/registrar.tsx` — nuevo `EditCompraDialog`, `updateCompra`, botón en el `<tfoot>` del listado.
