# Plan: Alternar fondo de filas en desglose COGS

## Objetivo
En la tabla de desglose de compras del formulario **Registrar Movimiento > COGS**, aplicar un fondo alternado sutil en cada fila para facilitar el seguimiento horizontal de las columnas de la derecha.

## Alcance
- Solo afecta la tabla/lista de compras dentro de la pestaña **COGS e Inventario** de `src/routes/_authenticated/registrar.tsx`.
- No cambia la lógica de cálculo ni la estructura de datos.

## Implementación
1. Localizar el componente/tabla que renderiza cada compra del desglose (fila con datos de proveedor, factura, neto, IVA, USD, etc.).
2. Aplicar clases condicionales según el índice de la fila:
   - Fila par: fondo blanco/base.
   - Fila impar: fondo sutil (`bg-gray-50` / `bg-purple-50` u otro token semántico muy claro).
3. Asegurar que el color sea compatible con el tema oscuro/claro usando tokens de Tailwind v4 o clases estándar (ej. `even:bg-gray-50/50`).
4. Verificar visualmente en el preview que el desglose sea más legible.

## No incluye
- Cambios en cálculos de COGS, tasas, importaciones o base de datos.
- Modificaciones en otras pestañas o tablas.
