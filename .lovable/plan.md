# Pagos de CxP: registrar el monto realmente pagado (caso factura 376 DELIVERMEAT)

## Qué está pasando (verificado en la base de datos)

Factura 376 de DELIVERMEAT:

- CxP creada por Xetux: 182 USD BCV · Bs 122.837,35 · tasa 674,9305 (7-jul). Correcto.
- Movimiento bancario del 20-jul: el Excel trae Bs 134.524,34 (la huella guardada lo confirma: `BANK:BVC|2026-07-20|637038|134524.34`).
- Pero la transacción de pago (13.2, #44326) quedó con **monto_bs = 122.837,35**, no con los 134.524,34 realmente pagados.

Causa confirmada: el disparador `enforce_anticipo_iva_rules` de la base de datos. Cuando entra un pago 13.2 cuya factura no tiene IVA, reescribe el monto del pago con el **monto histórico de la factura** (`monto_bs` de la factura menos anticipos). Ese disparador se creó para el caso de anticipos, pero hoy pisa todos los pagos sin IVA. Por eso el export nunca coincide con el archivo importado.

Alcance actual: **156 pagos 13.2** con monto distinto al del Excel (suma de diferencias ≈ Bs 8,46 millones). Las diferencias en cuentas no-13.2 (2.1, 10.6, 4.x…) no son error: corresponden a bancos en USD (BOFA/CASH) donde la huella guarda el monto en dólares.

Además, hoy la importación no revalúa la deuda a la tasa BCV del día de pago ni registra la diferencia cambiaria (eso solo existe en el pareo manual, vía `src/lib/cxp-saldo.ts`).

## Cómo debería quedar (según tu anexo)

Para la factura 376:

| Concepto | Valor |
|---|---|
| Deuda | 182 USD BCV |
| Bs al día de emisión (674,9305) | 122.837,35 |
| Deuda revaluada al 20-jul (736,9339) | 134.121,97 |
| Pago bancario registrado | 134.524,34 |
| Diferencial cambiario (7.2, pérdida) | 11.284,62 |
| Excedente pagado (dentro de tolerancia) | 402,37 |

## Cambios

1. **Disparador de base de datos**: acotar `enforce_anticipo_iva_rules` para que solo actúe cuando el grupo tiene un anticipo aplicado (14.2 negativo). Nunca debe reescribir el monto de un pago bancario normal. Cuando no haya IVA, solo normaliza `iva_bs = 0` y `monto_base_bs = monto_bs`.

2. **Importación de movimientos bancarios** (`importar-movimientos.tsx`), pagos contra CxP:
   - Registrar el pago 13.2 con el monto exacto de la fila del Excel (ya lo calcula; ahora dejará de ser pisado).
   - Revaluar la deuda a la tasa BCV del día de pago con `pendienteBsAFecha` y aplicar el pago sobre USD BCV.
   - Registrar el diferencial cambiario del período (7.2 pérdida / 11.1 ganancia) con `registrarDiferencialCambiario`, en el mismo grupo de la factura.
   - Excedente o faltante frente a la deuda revaluada: si está dentro de tolerancia (0,5 % o Bs 500) se cierra la factura como pagada y el sobrante queda en la misma línea; si excede la tolerancia, se marca parcial (faltante) o se avisa en la vista previa (excedente) para decidir si va a anticipo 14.2.
   - En la vista previa, la columna de diferencia comparará contra la **deuda revaluada al día del pago**, no contra el Bs histórico de la factura.

3. **Corrección retroactiva** de los 156 pagos ya cargados: llevar `monto_bs` (y `monto_base_bs`, `monto_usd`) al monto real del Excel guardado en la huella, y generar el asiento de diferencial cambiario que falta en cada grupo. Se hará con respaldo previo en una tabla de auditoría para poder revertir.

4. **Verificación**: volver a exportar Movimientos bancarios y confirmar que la columna de monto coincide fila por fila con el archivo importado, empezando por la factura 376 (debe mostrar 134.524,34).

## Nota técnica

- Disparador afectado: `public.enforce_anticipo_iva_rules()` sobre `transacciones` (INSERT).
- Helpers ya disponibles y reutilizables: `pendienteUsdBcv`, `pendienteBsAFecha`, `tasaBcvFactura`, `dentroDeTolerancia`, `registrarDiferencialCambiario` en `src/lib/cxp-saldo.ts`.
- El backfill compara `abs(monto_bs)` contra `split_part(referencia,'|',4)` solo para cuentas 13.2 en bancos en bolívares, para no tocar los movimientos de bancos en USD.
