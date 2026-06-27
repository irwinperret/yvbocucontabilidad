
# IVA en compras/gastos como 2 filas reales

Ventas ya está correcto (split 12.4 + cuenta de ingreso). Solo aplica a **COGS/Compras** y **Gastos/Facturas**, en adelante y retroactivo.

## Cambios de comportamiento

Al registrar un gasto/compra con IVA, se insertan **dos transacciones** vinculadas por un mismo `grupo_transaccion_id`:

1. **Fila principal** (cuenta de gasto/COGS, p. ej. 4.2, 6.2):
   - `monto_bs` = monto **neto** (sin IVA)
   - `monto_base_bs` = monto neto, `iva_bs` = 0, `iva_aplica` = false
   - `monto_usd` = neto / `tasa_paralela` si pago al contado, neto / `tasa_bcv` si CxP
2. **Fila IVA** cuenta **12.5 "IVA crédito fiscal"**:
   - `monto_bs` = IVA en Bs
   - `monto_base_bs` = IVA, `iva_bs` = 0, `iva_aplica` = false (marcador `tipo_iva = 'credito_fiscal'`)
   - `monto_usd` = IVA / mismo divisor que la fila principal (paralela si contado, BCV si CxP)
   - `metodo_pago`, `tercero_id`, `fecha`, `centro_costo`, `modo` heredados
   - `notas`: prefijo "IVA crédito fiscal — " + nota original

Si IVA = 0 → solo se inserta la fila principal (como hoy ventas sin IVA).

## CxP

`cuentas_por_pagar.monto_bs` y `monto_pendiente_bs` siguen reflejando el **total con IVA** (lo que efectivamente se le debe al proveedor). `monto_usd` y snapshots BCV/paralela se calculan sobre el **total**, no sobre el neto. La fila vinculada vía `transaccion_id` sigue siendo la principal (cuenta de gasto/COGS); la fila 12.5 queda únicamente atada por `grupo_transaccion_id` (no genera CxP propia).

## Pago de CxP (`pagar-cxp.tsx` y `pagar-cxp-inline.tsx`)

El pago sigue siendo **una sola fila** a la cuenta de banco/efectivo por el monto total pagado (neto + IVA proporcional). No se divide el pago en 2; el IVA ya quedó registrado al momento de la factura. Se elimina la división `pagoBaseBs/pagoIvaBs` introducida en el último cambio y se vuelve a usar `monto_bs_a_pagar` completo, `monto_usd` = `monto_bs_a_pagar / tasa_paralela` (FX implícito).

## Reporte de impuestos (`impuestos.tsx`)

Volver a leer IVA crédito fiscal **solo** desde transacciones de cuenta `12.5` (quitar el `or iva_bs.gt.0`). IVA débito fiscal sigue desde `12.4` (ventas ya lo hacen así).

## Visualización en Transacciones

Quitar el "+ IVA …" stacked introducido en el turno anterior — ya no hace falta porque las 2 filas existen físicamente y se muestran como filas independientes. Agregar un pequeño badge "vinculado" cuando `grupo_transaccion_id` apunta al mismo grupo, para que el usuario vea visualmente que las 2 líneas pertenecen al mismo registro (opcional, podemos omitirlo si prefieres).

## Backfill retroactivo (migración de datos)

Para cada transacción de cuentas de gasto/COGS con `iva_bs > 0` y sin fila 12.5 hermana en su `grupo_transaccion_id`:

1. Crear nueva fila 12.5 con `monto_bs = iva_bs`, mismos `fecha/tercero/centro/metodo_pago/modo`, `monto_usd` recalculado con la misma tasa/divisor que la principal, `grupo_transaccion_id` = el de la principal (o uno nuevo si era null, y se actualiza también la principal).
2. Ajustar la fila principal: `monto_bs = monto_base_bs` (quitar el IVA del total), `iva_bs = 0`, `iva_aplica = false`, `monto_usd` recalculado sobre el neto.
3. CxP vinculada: mantener `monto_bs` total con IVA (cliente ya pagó/debe el total). Solo recalcular `monto_usd` y snapshots si el cambio anterior los había puesto sobre el neto.
4. Reporte previo de cuántas filas se tocan antes de ejecutar.

## Archivos a tocar

- `src/routes/_authenticated/registrar.tsx` — `submit` (GastosFacturaForm) y `addCompra` (CogsForm): insertar fila 12.5 hermana, fila principal con `monto_bs = neto`, `iva_bs = 0`.
- `src/routes/_authenticated/pagar-cxp.tsx` — revertir `pagoBaseBs/pagoIvaBs`, pago = una sola fila al total.
- `src/routes/_authenticated/pagar-cxp-inline.tsx` — mismo cambio.
- `src/routes/_authenticated/impuestos.tsx` — leer crédito fiscal solo de 12.5.
- `src/routes/_authenticated/transacciones.tsx` — quitar render stacked "+ IVA …".
- Migración SQL de backfill (data-only, vía insert tool).

## Verificación post-cambio

Registrar un gasto de prueba (neto 62.221, IVA 16%, contado, tasa paralela ≠ BCV) y confirmar:
- 2 filas en `transacciones` con mismo `grupo_transaccion_id`
- Principal: `monto_bs = 62.221`, `monto_usd = 62221 / tasa_paralela`
- 12.5: `monto_bs = 9.955,36`, `monto_usd = 9955.36 / tasa_paralela`
- Tabla Transacciones muestra 2 filas separadas
- Reporte de Impuestos suma correctamente el crédito fiscal del mes
