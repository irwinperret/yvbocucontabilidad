## Diagnóstico

La lógica actual mezcla criterios. El ejemplo Excel confirma la regla correcta: **el proveedor reconoce el anticipo en USD BCV**, congelado a la fecha de pago. Cuando se emite una factura posterior, el anticipo se reexpresa en Bs usando la tasa BCV del día de la factura. La diferencia entre la tasa BCV del anticipo y la tasa BCV de la factura **no genera ganancia/pérdida cambiaria** (el proveedor absorbe ese cambio implícitamente, no afecta nuestro G&P).

El paralelo sigue siendo solo referencia contable interna (igual que en el resto del sistema).

## Cambios

### 1. Snapshot USD BCV del anticipo

Agregar a `transacciones` (vía migración) `anticipo_usd_bcv` y `anticipo_aplicado_usd_bcv` cuando `cuenta_codigo = '14.2'`. Al registrar un anticipo:
- `anticipo_usd_bcv = monto_bs / tasa_bcv` (deuda congelada del proveedor con nosotros)
- `monto_usd` sigue siendo paralelo (contabilidad, sin cambios en la regla global)

Backfill retroactivo: `anticipo_usd_bcv = monto_bs / tasa_bcv` para todos los 14.2 existentes; `anticipo_aplicado_usd_bcv` se recalcula desde los reversos ya emitidos (suma de `−monto_bs / tasa_bcv_del_reverso`).

### 2. RPC `aplicar_anticipo_a_factura`

Reescribir para operar en USD BCV, no USD paralelo:
- Input: `aplicar_usd_bcv` (no paralelo).
- Reverso en Bs = `aplicar_usd_bcv × tasa_bcv_factura` (igual que hoy, pero el input ahora es BCV).
- `monto_usd` del reverso = `reverso_bs / tasa_paralela_factura` (para contabilidad — diferencial paralelo/BCV emerge implícito, igual que en CxC/CxP).
- **Eliminar** la inserción automática a 11.1 / 11.2 por diferencia entre tasa BCV del anticipo y tasa BCV de la factura.
- Actualizar `anticipo_aplicado_usd_bcv` y `anticipo_estado` con base en USD BCV.

### 3. Helpers y UI

- `src/lib/anticipos-proveedor.ts`: `saldoAnticipo()` retorna USD BCV. Tipos extendidos con `anticipo_usd_bcv` y `anticipo_aplicado_usd_bcv`.
- `src/components/anticipo-proveedor-banner.tsx`: mostrar saldo en USD BCV, recibir `facturaTotalUsdBcv` (no paralelo). Aplicaciones expresadas en USD BCV; el preview "≈ Bs" usa `usd_bcv × tasa_bcv_factura`.
- `src/routes/_authenticated/registrar.tsx` (flujos factura + COGS): pasar `facturaTotalUsdBcv` al banner, y al `aplicarAnticiposContraFactura` pasar `aplicarUsdBcv`.
- `src/routes/_authenticated/pagar-cxp.tsx`: el banner ya recibe USD BCV pendiente — ajustar para usar el saldo BCV del anticipo y eliminar el cálculo de `aplicadoUsd` en paralelo.
- `src/routes/_authenticated/anticipos-proveedores.tsx`: KPIs (total anticipado / aplicado / saldo pendiente) en USD BCV, columna USD pasa a "USD BCV"; mantener "USD paralelo" como columna secundaria de referencia.

### 4. Limpieza retroactiva de diferenciales falsos

Identificar transacciones 11.1 / 11.2 insertadas por el RPC anterior (notas: `"Diferencial cambiario por aplicación de anticipo"`) y eliminarlas, recalculando saldos donde aplique. Reportar las afectadas antes de borrar.

## Detalles técnicos

- La migración agrega solo dos columnas nuevas; no rompe registros existentes porque el backfill se ejecuta en la misma migración.
- El RPC mantiene firma compatible renombrando `aplicar_usd → aplicar_usd_bcv` (cambio de semántica, no de tipo).
- Mantenemos `tasa_paralela` y `monto_usd` paralelo en cada reverso para que el resto del sistema (G&P, FC) siga viendo todo en paralelo.

## Validación

- Reproducir el caso del Excel: anticipo 61.243,30 Bs @ BCV 612,4332, factura 100.000 + 16% IVA @ BCV 623,0223 → saldo a pagar 53.697,79 Bs, sin entrada en 11.1/11.2.
- Confirmar que para anticipos parciales el saldo restante se mantiene en USD BCV constante a través de varias facturas con tasas BCV distintas.