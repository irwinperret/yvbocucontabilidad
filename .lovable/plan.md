
## Alcance

Solo **Fase 1** — flujos de registro nuevo. No hay backfill ni cambios de borrado/edición todavía; esos vienen después.

## Estado actual (auditado)

La columna `grupo_transaccion_id` existe hace tiempo y **muchos** flujos ya la usan bien: IVA vía `iva-helpers.ts`, `pagar-cxp.tsx`, `propinas.tsx` (par entrada/salida), nómina en `registrar.tsx`, gastos con CxP, importar-compras, aumento capital, préstamos.

Los **huecos reales** están concentrados en el flujo manual de ventas y en algunos derivados sueltos. Los 116 registros actuales en BD son todos flujos de una sola línea (CapEx, aumento capital, financiamiento), por eso `grupo_transaccion_id` está 100% NULL — no es un bug de escritura, es que no hay data multi-línea todavía.

## Huecos a corregir

### 1. Venta manual (registrar.tsx, líneas ~483–625)

Un solo `grupoId` generado al inicio debe enlazar **todo**:

- Venta principal (1.x): siempre `grupo_transaccion_id = grupoId` (hoy: solo si hay IVA).
- IVA débito fiscal (12.4): ya lo hace vía `insertIvaLeg`. Confirmar.
- Bono servicio 10% (3.5/3.10/3.14): añadir `grupo_transaccion_id: grupoId`.
- Propina — la transacción 13.1 hoy usa `grupoPropina` distinto. Reusar `grupoId` en su lugar, y guardar `grupo_transaccion_id = grupoId` también en la fila de `propinas` para poder rastrearla. La salida (13.1 pago a mesero) sigue generando su propio grupo cuando se pague, pero mantiene una referencia a la entrada.
- Cobro CxC — si existe venta a crédito original con grupo, el cobro (1.5) hereda ese grupo. Ajuste FX (11.1/11.2) del cobro también.

### 2. Venta off-balance (registrar.tsx, líneas ~385–457)

- `grupoId = crypto.randomUUID()` compartido entre venta off-balance (1.x) y bono off-balance. Se mantiene `pareja_off_balance_id` como antes; el grupo es un enlace adicional para permitir borrado en cascada.

### 3. CxC — cobro estándar (cxc.tsx línea ~205)

Al insertar la transacción de cobro (1.5), leer el `grupo_transaccion_id` de la venta original (via `cxc.transaccion_id → transacciones.grupo_transaccion_id`) y reutilizarlo; si la venta no tenía grupo, generar uno nuevo y **actualizar la venta original** para que ambos queden enlazados (mismo patrón que ya usa `pagar-cxp.tsx` línea 253).

### 4. Xetux Ventas (importar-ventas.tsx)

- Venta 1.x (línea 535): ya usa `grupoId`. Confirmar.
- Bono automatico (línea 267 `bonoPayload`): añadir `grupo_transaccion_id: grupoId` al payload.
- Propina (línea 313 `propTxPayload`): añadir `grupo_transaccion_id: grupoId`.
- Deduplicación (línea 511): ya toma `grupoExistente` de la fila dup o crea uno; asegurar que el bono/propina de esa venta duplicada también lo reciba.

### 5. Xetux Compras (importar-compras.tsx línea ~245)

Compra 2.1 + IVA 12.5 ya comparten `grupoId` (línea 265, 286). Confirmar que sigue así después del cambio.

### 6. Ajuste FX en cobro CxC (registrar.tsx línea 558)

Añadir `grupo_transaccion_id: grupoIdCobro` (heredado de la venta o generado en el cobro).

### 7. Otros inserts sueltos revisados

- `registrar.tsx` 1941 (cuenta 1.8), 2085, 2824 (2.2 cierre), 3548: son flujos de una sola línea o cierres automáticos — dejar sin grupo, no aplica.
- `activos-transitorios.tsx`, `anticipos-proveedores.tsx`: ya usan grupo o son ediciones de estado. Confirmar en la lectura final.

## Regla general para el código

Cada handler que cree ≥2 transacciones relacionadas debe empezar con:

```ts
const grupoId = crypto.randomUUID();
// ...luego, en cada insert relacionado:
grupo_transaccion_id: grupoId,
```

Nunca `grupo_transaccion_id: cond ? grupoId : null` cuando la relación existe — si el flujo insertó más de una fila, todas comparten grupo, punto.

## Archivos a tocar

- `src/routes/_authenticated/registrar.tsx` — flujo venta manual (contado/crédito/cobro), venta off-balance, ajuste FX.
- `src/routes/_authenticated/cxc.tsx` — cobro.
- `src/routes/_authenticated/importar-ventas.tsx` — bono y propina Xetux.
- (verificación, probable no-op) `src/routes/_authenticated/importar-compras.tsx`, `src/routes/_authenticated/propinas.tsx`, `src/lib/iva-helpers.ts`.

## Fuera de alcance (fases siguientes)

- Cascada de borrado por grupo (Fase 2).
- Edición con propagación via checkbox (Fase 2).
- Backfill retroactivo de registros existentes (Fase 3) — el auto-apply de casos seguros lo haré por migración cuando llegue el turno.
