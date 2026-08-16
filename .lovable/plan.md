# CxP fijadas en USD BCV y revaluadas en la fecha del pago

## Regla contable única

La variable independiente de cada cuenta por pagar será su saldo en **USD BCV** (`monto_pendiente_usd_bcv`). El valor histórico en bolívares de la factura se conserva únicamente como referencia.

Para cualquier movimiento o pago:

```text
Deuda Bs a la fecha del pago = saldo USD BCV × tasa BCV aplicable a la fecha del movimiento
Diferencia de conciliación = pago bancario Bs − deuda Bs revaluada
```

Se mantiene la regla vigente para fechas sin publicación: usar la próxima tasa BCV disponible. Una diferencia de hasta 0,5 % o Bs 500, lo que sea mayor, se considera pago completo.

## Cambios

### 1. Unificar el cálculo central

- Consolidar en `cxp-saldo.ts` el cálculo del saldo USD BCV, su equivalente en Bs a una fecha y la tolerancia.
- Eliminar cálculos paralelos basados en `monto_pendiente_bs` de los flujos de importación, conciliación y pago.
- Mantener `monto_bs` y `monto_pendiente_bs` como valores históricos/auditables; no usarlos para decidir si un pago cubre la deuda.

### 2. Corregir el motor de conciliación bancaria

- Ampliar la referencia de factura usada por `conciliacion-matching.ts` para incluir saldo USD BCV y tasa de factura.
- En búsqueda por monto, combinaciones de varias facturas, cobertura, sugerencias y recalcular pareos, valorar cada factura con la tasa BCV de la fecha de cada movimiento.
- Aplicar la tolerancia común para distinguir `Pareado` de `Pareado parcial`.
- En `movimientos-bancarios.tsx`, cargar las CxP vinculadas a las facturas y las tasas necesarias; dejar de usar el Bs histórico como total conciliable.

### 3. Mostrar claramente histórico vs. revaluado

En Movimientos bancarios, CxP y diálogos de pareo/pago:

- Mostrar el saldo fijo en USD BCV.
- Mostrar el Bs histórico de la factura solo como referencia.
- Mostrar la deuda revaluada a la fecha del movimiento o pago.
- Mostrar la diferencia real contra el pago bancario.
- Actualizar exportaciones para usar la misma semántica y evitar que “Pendiente Bs” se confunda con el monto histórico.

### 4. Corregir todos los flujos futuros

Aplicar la misma regla en:

- importación de movimientos bancarios;
- pareo automático y recálculo de pareos;
- pareo manual y deshacer pareo;
- pago individual de CxP;
- pago inline desde registros;
- pantalla y exportación de CxP.

Los pagos parciales descontarán primero USD BCV. El nuevo saldo en Bs será siempre una visualización derivada de ese saldo USD y de la fecha consultada, no una nueva deuda fija en bolívares.

### 5. Revisión retroactiva

- Recalcular todos los movimientos bancarios existentes contra las CxP en USD BCV y la tasa BCV de la fecha de cada movimiento.
- Actualizar estados persistidos de conciliación que hayan quedado como parciales/completos por comparar contra Bs históricos, sin crear pagos duplicados.
- Revisar saldos parciales para que su fuente sea `monto_pendiente_usd_bcv`; corregir únicamente inconsistencias comprobadas y conservar respaldo antes de cualquier actualización masiva.
- Mantener los asientos de diferencial cambiario existentes cuando sean correctos; completar o corregir solo los que no correspondan al USD BCV efectivamente aplicado.

## Caso de aceptación: factura 376 DELIVERMEAT

```text
Factura:                 USD BCV 182,00
Bs históricos 07-jul:   182 × 674,9305 = Bs 122.837,35
Deuda al pago 20-jul:   182 × 736,9339 = Bs 134.121,97
Pago bancario:                              Bs 134.524,34
Diferencia conciliación:                    Bs     402,37
Estado esperado:         Pareado / pagada (dentro de tolerancia)
Diferencial cambiario:   Bs 11.284,62 frente al valor histórico
```

La fila no volverá a presentar Bs 122.837,35 como deuda exigible al 20-jul; ese importe quedará identificado exclusivamente como valor histórico de emisión.

## Validación

- Verificar el caso 376 en pantalla, exportación y diálogo de pareo.
- Comparar una muestra de pagos completos, parciales, múltiples facturas y fines de semana/feriados.
- Confirmar que la suma del pago bancario exportado continúa siendo exactamente la del archivo original.
- Confirmar que no se duplican transacciones 13.2 ni diferenciales 7.2/11.1 durante el ajuste retroactivo.
