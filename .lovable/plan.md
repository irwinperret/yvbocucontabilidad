# Propinas y bono 10%: separar devengo del pago

## El problema (confirmado en los datos)

Hoy hay dos registros distintos del mismo dinero:

- **Bono 10%**: al importar ventas se registra como **gasto** en 3.5 (Bocú) / 3.10 (YV) — 1.702 transacciones activas. Cuando después llega el pago por banco, se vuelve a registrar como gasto (13 movimientos en 3.14 "Otros Bonos"). El gasto queda **duplicado** y nunca existe una deuda con el personal.
- **Propinas**: al importar ventas se crea el pasivo 13.1 en positivo (755 registros). Los pagos que llegan por banco también entran a 13.1 **en positivo** (36 movimientos), así que el pasivo **crece** en vez de descargarse.

Nota importante: aunque creías que no quedaban movimientos bancarios importados, sí hay **743 transacciones con referencia BANK** activas, entre abril y noviembre de 2026. Por eso el plan incluye la corrección retroactiva.

## La solución

### 1. Nueva cuenta de pasivo para el bono

Crear **13.4 — Bonos 10% por pagar al personal** (Pasivos transitorios), igual que 13.1 para propinas.

Al importar ventas, cada factura genera:
- Gasto del bono en 3.5 / 3.10 (como hoy, sin tocar caja).
- Pasivo **13.4 en positivo** por el mismo monto (deuda con el personal).

Así el bono se reconoce como gasto una sola vez, en el mes en que se generó la venta.

### 2. El pago por banco descarga la deuda, no genera gasto

Cuando un pago al personal se clasifica como propina o bono:
- Propina → **13.1 en negativo**.
- Bono 10% → **13.4 en negativo**.
- Nómina real → cuenta de nómina correspondiente (gasto, como hoy).

Efecto neto en caja correcto y sin doble gasto.

### 3. Asignación automática por saldo pendiente

En la importación de movimientos bancarios, todo pago al personal (categoría MO / sin factura contra persona) pasa por un repartidor automático:

```text
Pago a MARIF · Bs 30.122,88 · 12-May
  1. Propinas pendientes de MARIF hasta esa fecha ....  Bs 18.400  → 13.1 (−)
  2. Bono 10% pendiente de MARIF hasta esa fecha ....   Bs 11.722  → 13.4 (−)
  3. Resto ..........................................   Bs      0  → nómina
```

Reglas:
- Se toma el saldo pendiente acumulado (devengado − ya pagado) por centro de costo y, cuando el nombre del beneficiario coincide con un tercero/empleado, por persona.
- Orden: primero propinas, luego bono 10%, el remanente a nómina.
- Un mismo movimiento puede partirse en 2 o 3 patas, unidas por `grupo_transaccion_id`, de forma que sigue siendo un solo movimiento bancario.
- La pantalla de importación muestra la propuesta antes de registrar, con el desglose por fila y totales por bucket, y permite corregir/dividir manualmente cualquier fila antes de confirmar.

### 4. Vista de control

En el tab de Propinas se agrega un resumen de saldos: devengado, pagado y pendiente por mes y centro, para 13.1 y 13.4. Sirve para verificar que las asignaciones automáticas dejan los pasivos en cero cuando toca.

### 5. Corrección retroactiva

Migración de datos, con respaldo previo:
- Convertir a **negativo** los 36 pagos bancarios registrados en 13.1.
- Reclasificar de 3.14 a **13.4 en negativo** los pagos bancarios que correspondan a bono 10% (se identifican por beneficiario con bono devengado pendiente); los que no calcen quedan en 3.14 como "Otros Bonos" reales.
- Generar la pata 13.4 (+) faltante para los 1.702 devengos de bono ya importados, para que el pasivo histórico exista y los pagos tengan contra qué descargarse.
- Revisar los 743 movimientos BANK activos y reasignar los que caigan en el circuito personal.

Los meses ya cerrados no se tocan sin reabrirlos; te reporto cuáles quedan pendientes si aparece alguno.

## Detalles técnicos

- Migración: alta de 13.4 en `plan_de_cuentas` (grupo Pasivos transitorios, `afecta_gyp = false`, `afecta_fc = true`).
- `src/routes/_authenticated/importar-ventas.tsx`: añadir la pata 13.4 en el upsert del bono, con la misma idempotencia por `numero_factura`/`numero_orden` que ya usan IVA/propina.
- Nuevo `src/lib/pagos-personal.ts`: cálculo de saldos pendientes 13.1/13.4 por fecha, centro y beneficiario, y función de reparto FIFO propina → bono → nómina.
- `src/routes/_authenticated/importar-movimientos.tsx`: usar el repartidor para las filas de personal, insertar patas múltiples con `grupo_transaccion_id` común y mostrar el desglose editable en la previsualización.
- `src/lib/conciliacion.ts` / `conciliacion-matching.ts`: incluir 13.4 en las cuentas "sin factura" para que no se intente parear contra CxP.
- `src/routes/_authenticated/propinas.tsx`: tarjeta de saldos 13.1 / 13.4.
- Reportes (G&P, flujo de caja, dashboard) no requieren cambios: 13.x ya está fuera de G&P.
