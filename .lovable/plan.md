# Movimientos bancarios: filtros por categoría y paginación

Alinear el tab de Movimientos bancarios con el comportamiento de Transacciones.

## 1. Filtro por categorías (cuenta contable)
- Agregar un filtro multi-selección de cuentas, agrupado por grupo del plan de cuentas (igual que en Transacciones).
- Agregar también filtro multi-selección por centro de costo.
- Los filtros se combinan con los existentes (banco, estado, fechas, texto).
- Los KPIs de resumen y la exportación a Excel respetan los filtros aplicados.

## 2. Paginación configurable
- Selector "Mostrar": 50 / 100 / 250 / 500 / Todas (por defecto 50).
- Controles Anterior / Siguiente con indicador "Página X de Y" y total de movimientos.
- Elimina el corte fijo actual de 500 filas y su aviso.
- Al cambiar cualquier filtro, la vista vuelve a la primera página.
- La exportación a Excel sigue incluyendo todos los movimientos filtrados, no solo la página visible.

## Detalles técnicos
- Archivo: `src/routes/_authenticated/movimientos-bancarios.tsx`.
- Reutilizar el patrón `MultiSelectFilter` de `src/routes/_authenticated/transacciones.tsx`; se extrae a un componente compartido (`src/components/multi-select-filter.tsx`) e importa en ambas páginas para no duplicar código.
- La consulta de cuentas ya existe en la página (`plan-cuentas-min`); se amplía a `codigo,nombre,grupo,orden` para poder agrupar.
- Paginación en cliente sobre `filtradas` con `useMemo`, sin cambios en la carga de datos ni en la lógica de pareo.
