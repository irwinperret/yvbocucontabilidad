# Portal del proveedor: pareos invisibles, montos y reasignación

Revisé el caso AGROSNACKS en la base de datos y el problema de fondo está confirmado.

## Qué está pasando realmente

Sus facturas 1295, 1325, 90655 y 1383 figuran como **pagadas con pendiente 0**, pero el portal dice "pareado 0" y las manda a la lista de huérfanas. Motivo: esos pagos los creó el **importador de movimientos bancarios**, que registra el pago (cuenta 13.2) enlazado a la factura de forma *implícita* — mismo grupo contable y un texto "Pago facturas 1295, 1325" — y **no escribe la fila de vínculo** en la tabla de conciliación. El portal del proveedor solo lee esa tabla de vínculos, así que no ve nada. No es un error de saldos: la deuda sí se aplicó bien.

Consecuencia: el mismo movimiento aparece dos veces mal — como "movimiento huérfano" abajo y como factura "pagada sin pareo" arriba.

## Cambios

1. **Ver el pareo real**: el portal reconocerá tres formas de enlace — el vínculo formal de conciliación, los pagos hechos con pareo manual, y los pagos del importador (13.2 con el grupo de la factura o su número en el detalle). Con eso, cada factura pagada mostrará **contra cuál movimiento** se pareó, y esos movimientos dejarán de contarse como huérfanos.

2. **Montos completos por factura**: en cada tarjeta se verá **fecha de emisión**, **monto de la factura** (Bs y USD BCV), **pendiente** y **pareado**, con la etiqueta correcta (Pagada / Parcial / Con pareo / Sin pareo).

3. **Fin de la contradicción de la derecha**: el panel pasa a llamarse **"Facturas sin movimiento asignado"** y excluye las pagadas. Las que estén pagadas pero sin ningún movimiento identificable se listan aparte, como **"Pagadas sin movimiento identificado"**, con su monto original (no Bs 0), que son los casos a revisar.

4. **Mover cualquier pareo entre facturas**: hoy solo se puede mover lo pareado manualmente. Se extiende para que también los pagos venidos del importador se puedan **reasignar a otra factura** o **liberar**, tanto arrastrando como con el selector "Mover a…". Al reasignar se devuelve el saldo a la factura anterior, se aplica a la nueva a la tasa BCV del día del movimiento y se deja registrado el vínculo formal.

5. **Normalización de lo existente**: al reconocer un pago implícito, el portal graba el vínculo formal, de modo que el historial se va ordenando solo a medida que se usa.

## Detalles técnicos

- `src/routes/_authenticated/proveedores/$id.tsx`: nuevo `useMemo` que fusiona `conciliacion_bancaria` + `detalle ~ PAREO_CXP:<cxpId>` + pagos `cuenta_codigo = '13.2'` cuyo `grupo_transaccion_id` coincide con el de la transacción de la factura (o cuyo `detalle` contiene su `numero_factura`); ese mapa reemplaza a `movAFacturas` en `movsPorFactura` y `movsHuerfanos`. Cabecera de factura con `monto_bs`, `usd_bcv_factura`, `pendienteBsHistorico`, `pendienteUsdBcv` y suma pareada.
- `src/lib/pareo-cxp.ts`: `quitarPareoCxp` se amplía para revertir también pagos sin marca `PAREO:` — reconoce el pago por su `referencia BANK:` / grupo, restituye `monto_pendiente_bs` y `monto_pendiente_usd_bcv` de la CxP y limpia el enlace, sin borrar el movimiento bancario original (se re-clasifica como movimiento libre). Nueva función `reasignarPagoCxp(movId, cxpDestino)` que combina la reversión con `aplicarPareoCxp`.
- No cambia la contabilidad: mismas cuentas 13.2 / 14.2 y misma revaluación en USD BCV a la fecha de pago.
