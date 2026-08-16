# Pagos al personal: clasificación en la importación bancaria

Híbrido entre las reglas de clasificación por texto (rápidas, prácticas) y la corrección contable de fondo (que el bono 10% y las propinas no se cuenten dos veces como gasto).

## El problema (confirmado en los datos)

- **Bono 10%**: al importar ventas se registra como **gasto** en 3.5 (Bocú) / 3.10 (YV) — 1.702 transacciones activas. Cuando llega el pago por banco se vuelve a registrar como gasto (13 movimientos en 3.14 "Otros Bonos"). Gasto **duplicado**, y no existe ninguna deuda con el personal en libros.
- **Propinas**: el devengo crea 13.1 en positivo (755 registros); los pagos bancarios también entran a 13.1 **en positivo** (36 movimientos), así que el pasivo crece en vez de descargarse.
- Aunque creías que no quedaban movimientos importados, hay **743 transacciones con referencia BANK activas** (abril a noviembre 2026). Por eso incluyo la corrección retroactiva.

## Qué se implementa

### 1. Clasificación automática por concepto (antes de la vista previa)

Se aplica en orden, gana la primera coincidencia:

```text
IVSS / FAOV / INCES / PARAFISCAL / SEGURO SOCIAL → 3.15  Parafiscales
PROPINA / PROP                                   → 13.1  Propinas por pagar (pago de pasivo)
BONO 10 / 10% / BONO SERV / SERV 10              → 13.4  Bonos 10% por pagar (pago de pasivo)
BONO ALIM / B. ALIM / CESTA TICKET               → 3.20  Bono de alimentación
LIQUID / TERMINACION / PERIODO PRUEBA            → 3.12 / 3.18 / 3.3 según centro
PRESTAMO                                         → 14.1
ANTICIPO / ANTC                                  → 14.3
COCINA / CHEF / COCINERO                         → 3.1   Nómina Cocina
SALA YV / NOMINA YV                              → 3.9   Nómina Sala YV
SALA BOCU / NOMINA BOCU                          → 3.4   Nómina Sala Bocú
ADMIN                                            → 3.16  Nómina Administración
(categoría MO sin coincidencia)                  → 3.4   por defecto
```

Diferencias respecto a la lista que te pasó Claude, y por qué:
- **Liquidaciones** no van siempre a 3.12 (YV): se usa 3.12 / 3.18 / 3.3 según el centro de costo del movimiento, que es como está armado tu plan de cuentas.
- **Bono 10% no va a una cuenta de nómina.** Mandarlo a 3.4 volvería a registrarlo como gasto y el gasto quedaría duplicado (ya se devengó al importar las ventas). Va a la cuenta de pasivo 13.4, igual que las propinas a 13.1.

### 2. Nueva cuenta 13.4 — Bonos 10% por pagar al personal

Pasivo transitorio, hermana de 13.1. Al importar ventas, cada factura genera:
- Gasto del bono en 3.5 / 3.10 (como hoy).
- Pasivo **13.4 en positivo** por el mismo monto.

Al pagar por banco, el movimiento entra en **13.4 negativo** y descarga la deuda, sin crear gasto nuevo. Lo mismo para propinas en 13.1 (hoy entran en positivo, lo cual es un error).

### 3. Un movimiento = una transacción

No se divide un movimiento bancario en varias sub-cuentas. El desglose fino (3.5, 3.10, 3.14, 3.20) sigue viviendo solo en la nómina registrada manualmente. Si una transferencia mezcla nómina y bono 10% sin distinguirlos, se clasifica por el texto y se puede **corregir la cuenta a mano en la vista previa** antes de registrar.

### 4. Columna "Tipo de registro" en la vista previa

- **Gasto nuevo** — ADM, OC, INVERSION y demás cuentas de gasto.
- **Nómina** — cuentas 3.x.
- **Pago de pasivo** — 13.1, 13.2, 13.4, 14.x. Con la nota: *"Pago de pasivo — no crea gasto nuevo"* (y para bono 10%: *"ya devengado en importación de ventas"*).
- **Sin clasificar** — sin cuenta asignada.

Además, un contador por tipo arriba de la tabla, para que veas de un vistazo cuánto de la carga es gasto nuevo y cuánto es solo salida de caja.

### 5. Control de saldos

En el tab de Propinas se agrega un resumen: devengado, pagado y pendiente por mes y centro, para 13.1 y 13.4. Es la forma de verificar que los pagos bancarios están descargando bien los pasivos.

### 6. Corrección retroactiva

Con respaldo previo y sin tocar meses cerrados (te reporto cuáles quedan pendientes):
- Los 36 pagos bancarios en 13.1 pasan a **negativo**.
- Los pagos bancarios en 3.14 que correspondan a bono 10% se reclasifican a **13.4 negativo**; los que sean "Otros Bonos" reales se quedan en 3.14.
- Se genera la pata 13.4 (+) faltante para los 1.702 devengos de bono ya importados, para que el pasivo histórico exista.
- Se revisan los 743 movimientos BANK activos y se reclasifican los del circuito de personal con las reglas nuevas.

## Detalles técnicos

- Migración: alta de `13.4` en `plan_de_cuentas` (grupo Pasivos transitorios, `afecta_gyp = false`, `afecta_fc = true`).
- Nuevo `src/lib/clasificar-personal.ts`: `clasificarPagoPersonal(concepto, categoria, centro)` → `{ cuenta, tipoRegistro, nota }`, con las reglas de arriba y tests de los casos límite.
- `src/routes/_authenticated/importar-movimientos.tsx`: aplicar el clasificador en el parseo (antes de construir `matches`), signo negativo para cuentas de pasivo, columna "Tipo de registro" + badges de nota, selector de cuenta editable por fila y contadores por tipo.
- `src/routes/_authenticated/importar-ventas.tsx`: añadir la pata 13.4 en el upsert del bono, con la misma idempotencia por `numero_factura` / `numero_orden` que ya usan IVA y propina.
- `src/lib/conciliacion.ts` y `conciliacion-matching.ts`: incluir 13.4 en las cuentas "sin factura" para que no se intente parear contra CxP.
- `src/routes/_authenticated/propinas.tsx`: tarjeta de saldos 13.1 / 13.4.
- Reportes (G&P, flujo de caja, dashboard) no requieren cambios: las cuentas 13.x ya están fuera de G&P.
