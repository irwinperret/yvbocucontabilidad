## Objetivo

Cuando el usuario intenta registrar una transacción (nómina, gasto, compra, propina, etc.) con fecha dentro de un mes ya cerrado, mostrar una advertencia clara con opción de **reabrir el mes** directamente, en lugar de dejar que se registre silenciosamente sin poder editarla después.

## Comportamiento propuesto

1. **Antes de guardar cualquier transacción** en los formularios de `registrar.tsx` (Nómina regular, Nómina Chef, Compras/COGS manual, Gastos, Propinas, Movimientos varios, etc.), verificar si la fecha seleccionada cae dentro de un período con registro en `cierres_de_mes`.

2. **Si el mes está cerrado**, mostrar un `AlertDialog` con:
   - Título: *"El mes {YYYY-MM} está cerrado"*
   - Texto: *"Puedes registrar esta transacción, pero no podrás editarla ni borrarla mientras el mes siga cerrado. Si necesitas hacer cambios posteriormente, deberás reabrir el mes."*
   - Dos botones:
     - **Cancelar** — cierra el diálogo, no guarda.
     - **Continuar y registrar** — procede con el insert normal.
     - **Reabrir mes** (solo admin) — navega a `/transacciones?reabrir={periodo}` o abre directamente el flujo de reapertura.

3. **En `transacciones.tsx`**, aceptar un query param `?reabrir=YYYY-MM` que al montar la página abra automáticamente el diálogo de confirmación de reapertura del mes indicado (reusando la lógica de borrado existente en `cierres_de_mes` del formulario de cierre).

## Alcance

Aplicar el check en todos los `submit` de formularios en `src/routes/_authenticated/registrar.tsx`:
- `NominaForm` (regular y Chef Ejecutivo)
- Compras manuales / COGS
- Gastos administrativos
- Propinas
- Movimientos bancarios varios
- Anticipos / préstamos / CxP / CxC

Se centraliza con un helper `confirmarMesCerrado(fecha): Promise<'continuar'|'cancelar'|'reabrir'>` que renderiza el diálogo y devuelve la acción.

## Fuera de alcance

- No cambia la lógica de edición/borrado ya existente (que sigue bloqueada por mes cerrado con RLS/validación).
- No modifica reglas de quién puede reabrir (sigue siendo admin).
- No agrega undo ni cambios en snapshots de inventario.

## Detalles técnicos

- Nuevo componente `src/components/mes-cerrado-dialog.tsx` con `AlertDialog` controlado por promesa.
- Nuevo hook `useMesCerradoGuard()` que consulta `cierres_de_mes` por `periodo` derivado de la fecha (formato `YYYY-MM`) y dispara el diálogo.
- En `transacciones.tsx`: leer `useSearch()` (TanStack Router) para detectar `?reabrir=` y disparar el mismo diálogo/handler de reapertura existente en el `CierreForm`. Si el flujo de reapertura vive solo dentro de `CierreForm`, extraer la mutación (`supabase.from('cierres_de_mes').delete().eq('periodo', ...)`) a `src/lib/cierres.functions.ts` y reutilizarla.
- El botón "Reabrir mes" en el diálogo solo se muestra si el usuario es admin (`irwinperret@hotmail.com` / `irwinperret@gmail.com` / `castillo_iris@yahoo.com`), consistente con el gating actual.