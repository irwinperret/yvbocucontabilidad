## Diagnóstico

Revisé las transacciones del 20–25/06 y reproduje el bug:

- Venta a crédito 21/06 (grupo `f00e0f11…`):
  - 1.4 (base): bs 60 738.38 / USD 76.48 a paralela 794.1345 ✅
  - 12.4 (IVA): bs 9 718.14 / USD **16.00** → guardado a tasa BCV. Debería ser **12.24** (9 718.14 / 794.1345).
  - 3.10 (bono servicio): bs 6 073.84 / USD **10.00** → a BCV. Debería ser **7.65**.
  - 13.1 (propina): bs 5 999.99 / USD **9.88** → a BCV. Debería ser **7.55**.
- Cobro 25/06 (1.5 — `Cobro creditos anteriores`): bs 47 239.33 / USD **76.48** → guardado a BCV. Debería ser **60.40** (47 239.33 / 782.08725).

Causa raíz:
1. **`src/routes/_authenticated/registrar.tsx` (VentasForm)** — cuando `tipo === "credito"`, `usaBCV = true` y por lo tanto `tasaConvN = tasaBcvN`. La línea principal (1.4) se salva porque usa su propio helper `convertInput` que fuerza paralela, pero el resto (IVA en línea 466, bono en 269, propina en 274–276) divide los Bs entre `tasaN`/`tasaConvN` (BCV) en lugar de paralela.
2. **`src/routes/_authenticated/cxc.tsx` (CobroModal)** — el usuario ingresa el USD que coincide con el pendiente a BCV; luego se guarda `monto_usd: cobroUsd` tal cual y `monto_bs = cobroUsd * tasaBCV`. Nunca reexpresa el USD a paralela. Además, la diferencia cambiaria mezcla unidades (BCV vs paralela original).

## Cambios de código (de aquí en adelante)

### `src/routes/_authenticated/registrar.tsx` — VentasForm

Forzar que **todas** las patas de una venta (no solo la línea 1.4) reporten `monto_usd` a paralela:

- IVA leg (línea 466 y la llamada a `insertIvaLeg`):
  - Calcular `ivaUsd = iva / tasaParalelaN` (fallback a BCV solo si no hay paralela).
  - Pasar `tasa_bcv: tasaBcvN` (referencia fiscal) y `tasa_paralela: tasaParalelaN` al leg, sin importar `usaBCV`.
- Bono servicio (líneas 262–269) y propina (272–276): reemplazar la división por `tasaConvN` por una división por `tasaParalelaN`. Para la rama `pagoEnUsd` mantener el patrón "USD digitado a BCV → Bs → paralela" ya usado en el principal (`esVentaEnUsdBcv`).
- En los `insert` de las patas 3.x y 13.1 (líneas 547–559 y 565–578) guardar siempre `tasa_bcv: tasaBcvN` y `tasa_paralela: tasaParalelaN`, no `tasaN`.
- En el insert de `propinas` (línea 583+) guardar `tasa_paralela: tasaParalelaN` (no `tasaN`, que para crédito es BCV).

### `src/routes/_authenticated/cxc.tsx` — CobroModal

- Mantener el input "USD a tasa BCV" como conveniencia para igualar el pendiente, pero al insertar la transacción:
  - `monto_bs = cobroUsd * tasaBcv` (igual que hoy, el cliente paga ese Bs).
  - `monto_usd = monto_bs / tasaParalela` (USD contable real).
- Recalcular el dif. cambiario comparando paralela@cobro vs paralela@original (`tasaOrigParalela = cxc.monto_bs / cxc.monto_usd`, ya que el CxC se guardó a paralela). Mantener la regla actual: solo ganancia a 11.1; pérdida se ignora.
- Validar el tope contra `pendienteUsd` usando el USD-paralela equivalente, no el USD-BCV.

## Corrección retroactiva

Migración con `UPDATE` puntuales sobre `transacciones` y `propinas`:

| id (prefijo) | cuenta | bs actual | USD actual | USD correcto |
|---|---|---|---|---|
| `a10b27a8` | 12.4 | 9 718.14 | 16.00 | **12.24** (÷794.1345) |
| `db169156` | 3.10 | 6 073.84 | 10.00 | **7.65** (÷794.1345) |
| `16461c56` | 13.1 | 5 999.99 | 9.88 | **7.55** (÷794.1345) |
| `b4f8f1d9` | 1.5  | 47 239.33| 76.48 | **60.40** (÷782.08725) |

- También actualizar la fila correspondiente en `propinas` (`monto_usd = 7.55`, `tasa_paralela = 794.1345`).
- La CxC asociada a la venta 21/06 ya se guardó correctamente (76.48 USD paralela) y se marcó como `cobrada`. No se modifica su estado: el cliente sí canceló los Bs adeudados; la diferencia entre 76.48 (CxC) y 60.40 (cobro) en paralela es una pérdida cambiaria que la regla actual (11.2 eliminada) decide no contabilizar — se deja una nota en el cobro indicándolo, sin asiento adicional.

## Verificación

1. Re-leer las 4 filas afectadas y confirmar que `monto_bs / tasa_paralela ≈ monto_usd`.
2. Registrar una venta a crédito de prueba en Bs con IVA + bono + propina y validar que las 4 patas guardan `monto_usd` a paralela y `tasa_bcv` solo como referencia.
3. Hacer un cobro de prueba y verificar que el USD guardado sea `bs / paralela`.
