## Objetivo
Eliminar el banner "Montos en USD (tasa paralela)" (`<UsdRateBadge />`) de todas las páginas que ya tienen el botón de toggle USD BCV ↔ USD Paralelo, ya que el toggle ahora indica claramente qué tasa se está usando.

## Cambios

En cada una de las 9 páginas con `UsdViewToggle`, quitar:
- El import de `UsdRateBadge` (`import { UsdRateBadge } from "@/components/usd-rate-badge"`)
- La instancia `<UsdRateBadge />` en el JSX (típicamente en un `<div className="mt-1">` bajo el título)

Páginas afectadas:
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/gyp.tsx`
- `src/routes/_authenticated/fc.tsx`
- `src/routes/_authenticated/impuestos.tsx`
- `src/routes/_authenticated/propinas.tsx`
- `src/routes/_authenticated/capex.tsx`
- `src/routes/_authenticated/aumento-capital.tsx`
- `src/routes/_authenticated/liquidaciones.tsx`
- `src/routes/_authenticated/anticipos-proveedores.tsx`

## Fuera de alcance
- No se elimina el archivo `src/components/usd-rate-badge.tsx` (por si se reutiliza más adelante en páginas sin toggle).
- No se cambia lógica, cálculos, ni el `UsdViewToggle`.
