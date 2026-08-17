# Ver y editar todas las facturas pareadas en el portal del proveedor

- Cada movimiento huérfano muestra su monto en **USD BCV** (además del Bs) para identificar rápidamente coincidencias con facturas.

## Cambios

1. **Mostrar todo por defecto**: el filtro arranca en **Todas**, de modo que al entrar se ven las facturas con pareo y las huérfanas juntas.
2. **Filtros más útiles**: opciones `Todas` / `Con pareo` / `Sin pareo` / `Abiertas` / `Pagadas`, cada una con su conteo al lado.
3. **Resumen arriba**: tarjetas con total de facturas, cuántas tienen pareo, cuántas huérfanas y cuántos movimientos huérfanos del proveedor.
4. **Editar el pareo sin arrastrar**: cada movimiento ya pareado tendrá, además del botón de liberar, un selector **"Mover a factura…"** para reasignarlo directamente a otra factura del proveedor (útil en pantallas chicas o con listas largas).
5. **Arrastre entre facturas**: se mantiene tal cual — soltar sobre otra factura reasigna (revierte el pago anterior y aplica el nuevo), soltar en huérfanos libera.
6. **Orden**: las facturas se listan por fecha de vencimiento, con las que tienen pareo claramente marcadas ("Con pareo" / "Pagada" / "Huérfana").

## Detalles técnicos

- Solo cambia `src/routes/_authenticated/proveedores/$id.tsx`: estado inicial `filtroEstado = "todas"`, nuevas ramas del filtro basadas en `movsPorFactura`, tarjetas de resumen y un `Select` de reasignación por movimiento que llama al mismo `asignar(movId, cxpId)` ya existente.
- No cambia la lógica contable: sigue usando `aplicarPareoCxp` / `quitarPareoCxp` de `src/lib/pareo-cxp.ts`.
