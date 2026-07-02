## Objetivo
Hacer el botón de toggle **USD BCV ↔ USD Paralelo** más visible en las 9 páginas donde ya está instalado, manteniendo su ubicación actual junto al título principal.

## Cambios propuestos

### 1. Rediseñar `src/components/usd-view-toggle.tsx`
Transformar el botón actual (outline pequeño) en un **chip/badge colorido**:
- Fondo primario (`bg-primary`) con texto blanco (`text-primary-foreground`) cuando está activo.
- Borde o fondo sutil en modo secundario para que se lea como un filtro de visualización.
- Tamaño más grande (`h-9` / `h-10`), texto con peso semibold e icono de moneda destacado.
- Etiqueta clara: "USD Paralelo" / "USD BCV".
- Preservar el `title` y el `onClick` para alternar el modo.

### 2. Páginas a actualizar
Aplicar el nuevo componente en el mismo lugar que hoy (junto al título, a la derecha), sin moverlo de ubicación. No es necesario editar lógica de datos, solo reemplazar la importación/instancia si ya usa `UsdViewToggle`:
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/gyp.tsx`
- `src/routes/_authenticated/fc.tsx`
- `src/routes/_authenticated/impuestos.tsx`
- `src/routes/_authenticated/propinas.tsx`
- `src/routes/_authenticated/capex.tsx`
- `src/routes/_authenticated/aumento-capital.tsx`
- `src/routes/_authenticated/liquidaciones.tsx`
- `src/routes/_authenticated/anticipos-proveedores.tsx`

### 3. Verificación
- Revisar que el componente se renderice consistente en todas las páginas.
- Confirmar que el toggle sigue funcionando y persistiendo en `localStorage`.

## Fuera de alcance
- No se modifica el contexto `useUsdView` ni el helper `usdVisual`.
- No se cambian las tablas, gráficos ni cálculos de USD; solo el botón visual.
- No se reubica el botón a otra posición de la página.
