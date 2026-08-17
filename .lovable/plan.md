# Movimientos "No aplica": gasto directo, sin CxP artificial

## Diagnóstico (verificado en el código)

Hoy el importador de movimientos bancarios **ya registra la transacción contable** cuando no hay factura que emparejar: en `importar-movimientos.tsx`, si el movimiento no tiene CxP y su cuenta es "sin factura" o de servicio, se inserta directamente en `transacciones` con la cuenta del plan (4.8, 3.16, 5.6, 6.2, 10.6, servicios, etc.).

Es decir: **esos movimientos sí afectan G&P y Flujo de Caja hoy**. No se pierden. Lo que falta no es el asiento, es claridad y control.

## Recomendación: opción B (saltarse la CxP)

Crear una cuenta por pagar y pagarla en el mismo instante no aporta información contable — la deuda nunca existió. Solo agregaría filas fantasma a CxP, ruido en los reportes de antigüedad de deuda y más superficie para errores de revaluación BCV/paralelo (que ya nos ha costado varios ciclos de corrección).

El criterio correcto es:

- **Compra a crédito** (llega la factura Xetux antes del pago) → CxP → el movimiento bancario la paga. Ya funciona así.
- **Pago inmediato / gasto directo** (servicios, nómina, comisiones, gastos menores) → asiento de gasto directo contra banco. Sin CxP.

## Lo que sí hay que corregir

1. **Renombrar el concepto en la UI.** "No aplica" suena a "no cuenta". Cambiar la etiqueta a **"Gasto directo (sin factura)"** en la columna Conciliación, en los filtros y en la exportación, dejando "No aplica" solo para movimientos verdaderamente no contables (traspasos internos, operaciones de cambio).

2. **Aviso explícito en la vista previa de importación.** Para cada fila marcada como gasto directo, mostrar la cuenta contable resultante y una nota "afecta G&P y FC". Así el usuario ve el impacto antes de confirmar.

3. **Bloqueo de la cuenta 99 — POR DETERMINAR.** Hoy se puede asignar 99 en masa y ese gasto entra a los reportes sin clasificar. Propuesta: marcar 99 como cuenta que **no** afecta G&P/FC y agregar un indicador en Movimientos Bancarios con el conteo de filas en 99 pendientes de reclasificar, para que nunca se queden ahí en silencio.

4. **Panel de control mensual.** En Movimientos Bancarios, tarjetas con: total pagado contra CxP, total gasto directo, total en 99 sin clasificar, y total marcado como no contable. Cuadra contra el flujo de caja del mes.

## Detalles técnicos

- `src/lib/conciliacion.ts`: separar el estado actual `no_aplica` en dos — `gasto_directo` (afecta reportes) y `no_contable` (traspasos/cambio). Migrar los registros existentes de `conciliacion_bancaria` según la cuenta de la transacción.
- `src/routes/_authenticated/importar-movimientos.tsx`: etiquetas y nota de impacto en la vista previa; sin cambio en la lógica de inserción.
- `src/routes/_authenticated/movimientos-bancarios.tsx`: nuevas etiquetas en el selector, filtros y exportación; tarjetas de resumen.
- `plan_de_cuentas`: poner `afecta_gyp = false` y `afecta_fc = false` en la cuenta 99 (migración).

## Alcance

No se toca la lógica de pago de CxP, ni la revaluación BCV, ni las importaciones de Xetux.
