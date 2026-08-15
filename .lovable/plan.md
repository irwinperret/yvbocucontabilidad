# Deudas en USD BCV: revaluar la CxP a la fecha de pago

## Qué está pasando (verificado en la base)

La factura 000376 de DELIVERMEAT (07-jul-2026) se importó como **182,00 USD BCV**, y el sistema guardó la deuda congelada en **Bs 122.837,35** (182 × 674,9305, tasa BCV del 07-jul).

El pago llegó el 20-jul por **Bs 134.524,34**. A la tasa BCV de ese día (736,9339) la deuda equivale a **Bs 134.121,97**, o sea el pago es correcto con apenas **Bs 402** de exceso (0,3 %).

El problema no es la importación de compras: el monto en USD está bien. El problema es que **todo el pareo y el pago comparan bolívares congelados a la fecha de la factura** (`monto_pendiente_bs`), así que el sistema ve una diferencia de Bs 11.687 y trata el pago como un excedente enorme (o no lo parea).

## Qué se va a cambiar

### 1. La deuda vive en USD BCV, no en bolívares

En pareo automático, pareo manual y pago de CxP, el saldo pendiente de cada factura se calcula así:

```text
pendiente Bs (a la fecha de pago) = monto_pendiente_usd_bcv × tasa BCV del día del pago
```

Los bolívares de la factura se conservan como referencia histórica, pero ya no se usan para comparar contra el movimiento bancario.

### 2. Tolerancia para diferencias despreciables

Si la diferencia entre el movimiento y la deuda revaluada es menor a **0,5 % o Bs 500** (lo que resulte mayor), la factura se marca **pagada** completa y no se ofrece "excedente / anticipo". Solo por encima de ese umbral se pregunta qué hacer con el sobrante o se marca pago parcial.

### 3. La diferencia cambiaria queda registrada

El delta entre lo que costaba la deuda al nacer y lo que costó pagarla se registra automáticamente en **7.2 — Diferencial cambiario** (pérdida) o **11.1 — Ganancia cambiaria por cobros** cuando corresponda, enlazado al mismo grupo de transacciones del pago, para que el balance cuadre.

### 4. Lo que se ve en pantalla

- En **Movimientos bancarios** y en el diálogo "Editar / Parear": la columna de pendiente muestra el saldo **revaluado a la fecha del movimiento**, con el USD BCV al lado y una nota del tipo "Bs 122.837 al 07-jul → Bs 134.122 al 20-jul".
- En **Cuentas por pagar**: se agrega una columna "Pendiente hoy (Bs)" revaluada a la tasa BCV actual, junto al monto histórico.
- El indicador de diferencia en vivo se pone en verde dentro de la tolerancia.

### 5. Esta factura en particular

Una vez aplicado el cambio, se parea la 000376 con el pago del 20-jul: queda **pagada**, con Bs 402 de diferencial cambiario, sin anticipo ni excedente.

## Detalles técnicos

- `src/lib/conciliacion-matching.ts`: `pendienteBs(cxp)` pasa a recibir la fecha del movimiento y resolver la tasa BCV con `tasaBcvParaFecha` de `src/lib/tasas.ts` (regla de tasa siguiente ya vigente). `coberturaPareo` compara contra ese valor y aplica la tolerancia.
- `src/components/pareo-manual-dialog.tsx`: `pendienteBsDe` recibe la fecha del movimiento; el bloque de excedente (14.2) solo aparece si la diferencia supera la tolerancia; al confirmar, se descuenta `monto_pendiente_usd_bcv` (USD) en vez de bolívares, y `monto_pendiente_bs` se recalcula desde el USD restante.
- `src/routes/_authenticated/pagar-cxp.tsx` y `src/components/pagar-cxp-inline.tsx`: mismo criterio de saldo en USD BCV a la fecha de pago.
- Nueva utilidad `src/lib/cxp-saldo.ts` con `pendienteUsdBcv(cxp)`, `pendienteBsAFecha(cxp, fecha, tasa)` y `dentroDeTolerancia(dif, base)` para que las tres pantallas usen exactamente la misma regla.
- Asiento de diferencial: helper que inserta una transacción 7.2 / 11.1 por el delta Bs, con `grupo_transaccion_id` del pago, `tasa_bcv` y `tasa_paralela` del día del pago.
- No hace falta migración de esquema: `monto_pendiente_usd_bcv` ya existe y está poblado.
