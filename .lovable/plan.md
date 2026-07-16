Pivotar la tabla de snapshots de inventarios para mostrar **una fila por período** con columnas separadas de inicial/final, y mover la edición a un panel modal (Sheet).

## Cambios

**src/routes/_authenticated/inventarios.tsx**

1. **Agrupar snapshots por período**: reemplazar el map actual por una estructura `{ periodo, inicial, final }` donde cada lado contiene el snapshot completo (id, monto_usd, monto_bs, tasa_bcv, notas, fecha) o `null`.

2. **Nueva estructura de tabla** (una fila por mes):
   ```
   Período | Inicial USD | Inicial Bs | Tasa BCV | Final USD | Final Bs | Tasa BCV | Acciones
   ```
   - Mostrar la tasa BCV de cada snapshot (inicial y final por separado, como pidió el usuario).
   - Si no existe un snapshot para ese lado, mostrar "—".
   - Botones de acción por lado: "Editar inicial" / "Editar final" (deshabilitado si no existe).

3. **Panel de edición (Sheet lateral)**:
   - Reemplazar la edición inline por un `<Sheet>` de shadcn.
   - Al abrir, cargar el snapshot seleccionado (período + tipo) en el formulario.
   - Campos: Monto USD, Tasa BCV, Monto Bs, Notas.
   - Header del panel: "Editar inventario {inicial|final} — {mes año}".
   - Mostrar el mismo aviso de cascada (reabre cierre, recalcula COGS, sincroniza mes siguiente si es final) dentro del panel.
   - Botones Guardar / Cancelar; misma lógica actual (`editar` server fn, toasts, invalidaciones).

4. **Mantener sin cambios**: gráfica de evolución, tarjeta de advertencia inferior, lógica del server function `editarInventarioSnapshot`.

## Detalles técnicos

- Usar `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter` de `@/components/ui/sheet`.
- State: `editing: { snapshot, tipo } | null` en vez de `editId`.
- Confirmación (`confirm(...)`) se conserva antes de guardar.
- Orden de filas: períodos descendentes (más reciente primero), igual que hoy.
