## Objetivo

Agregar la posibilidad de **borrar snapshots de inventario** desde la pestaña de Inventarios, para casos como julio donde hay snapshot pero el mes aún no está cerrado.

## Alcance

En `src/routes/_authenticated/inventarios.tsx`, agregar un botón de eliminar (ícono `Trash2`) en cada celda de "Acciones" (inicial y final) al lado del botón de editar.

### Reglas de borrado

1. **Solo se permite borrar si el período NO tiene cierre `cerrado`.**
   - Si existe fila en `cierres_de_mes` para ese período con `estado = 'cerrado'`, deshabilitar el botón y mostrar tooltip: "No se puede borrar: el mes está cerrado. Reabre el cierre primero."
   - Si no hay cierre o está `abierto`, permitir borrar.

2. **Cascada al borrar un inventario final:**
   - Si borras el final del mes N y existe el inicial del mes N+1, preguntar si también quiere borrarse (por defecto sí), porque están sincronizados.
   - No recalcular COGS automáticamente porque el mes no está cerrado (si lo estuviera, el borrado estaría bloqueado).

3. **Confirmación explícita** con `confirm()` antes de borrar, mostrando período, tipo y monto USD.

## Implementación

### 1. Nueva server function `borrarInventarioSnapshot`

Archivo nuevo: `src/lib/inventario-delete.functions.ts` (o agregar al existente `inventario.functions.ts`).

- Input: `{ snapshot_id: uuid, cascade_next_month_inicial?: boolean }`
- Middleware: `requireSupabaseAuth`
- Lógica:
  1. Lee snapshot (`id, periodo, tipo`).
  2. Verifica que el cierre del período NO esté `cerrado` — si lo está, lanza error.
  3. Si `tipo = 'final'` y `cascade_next_month_inicial = true`: verifica cierre del mes N+1 tampoco esté cerrado, y borra el inicial del mes N+1 si existe.
  4. Borra el snapshot principal.
  5. Retorna `{ deleted_periodo, cascaded_periodo | null }`.

### 2. UI en `inventarios.tsx`

- Agregar botón `<Trash2>` en cada celda de acciones al lado del `Pencil`.
- Consultar `cierres_de_mes` (id, periodo, estado) junto con snapshots para saber qué filas se pueden borrar.
- Handler `handleDelete(snap)`:
  - Verifica que el período no esté cerrado.
  - Si es final, pregunta si también borrar el inicial del siguiente mes.
  - `confirm(...)` con detalle.
  - Llama la server fn, invalida queries, `toast.success`.

### 3. Comportamiento visual

- Botón habilitado solo si `cierre?.estado !== 'cerrado'`.
- Estilo `variant="ghost"` con ícono rojo (`text-destructive`).
- Mismo tamaño que el botón de editar.

## Archivos afectados

- `src/lib/inventario.functions.ts` — agregar `borrarInventarioSnapshot` (o archivo nuevo).
- `src/routes/_authenticated/inventarios.tsx` — botón, query de cierres, handler.

## Fuera de alcance

- Recalcular COGS al borrar (no aplica porque solo se permite si el mes no está cerrado).
- Borrar cierres de mes.
- Borrado masivo por período.
