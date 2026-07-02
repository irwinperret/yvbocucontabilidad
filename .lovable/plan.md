## Objetivo
Agregar un botón toggle "USD BCV ↔ USD Paralelo" en las páginas: Dashboard (Inicio), G&P, Flujo de Caja, Impuestos, Propinas, Capex, Aumento de Capital, Liquidaciones, Anticipos.

Al presionarlo, todas las columnas/tarjetas que muestran USD en esa página cambian entre:
- **USD Paralelo** (default, `monto_bs / tasa_paralela`, fallback `monto_usd`)
- **USD BCV** (`monto_bs / tasa_bcv`)

## Diseño

### 1. Contexto global compartido
Nuevo archivo `src/lib/usd-view-context.tsx`:
- `UsdViewProvider` envuelve el layout `_authenticated`
- Hook `useUsdView()` retorna `{ mode: "paralela" | "bcv", toggle, setMode }`
- Persiste selección en `localStorage` (`usd-view-mode`) para que se recuerde entre navegación y reload
- Default: `"paralela"` (respeta la Core memory)

### 2. Componente de UI
Nuevo `src/components/usd-view-toggle.tsx`:
- Botón compacto tipo `ToggleGroup` o `Button` con dos estados
- Muestra "USD Paralelo" / "USD BCV" con badge visual
- Se coloca en el encabezado de cada página listada

### 3. Helper de cálculo compartido
Nuevo `src/lib/usd-visual.ts` (extrae y unifica lo que hoy existe en `transacciones.tsx`):
```ts
usdVisual(t, mode, { paralelaByFecha?, tasaBcvByFecha? })
  // mode="paralela": monto_bs/tasa_paralela → fallback lookup por fecha → fallback monto_usd
  // mode="bcv":      monto_bs/tasa_bcv      → fallback lookup por fecha → null
```
Cada página que hoy calcula USD lo hace vía este helper.

### 4. Integración por página

En cada una de las 9 páginas:
- Agregar `<UsdViewToggle />` en el header
- Cargar `tasas_paralela` y `tasas_bcv` del rango (donde aún no se hace)
- Reemplazar los cálculos actuales de USD por `usdVisual(t, mode, maps)`
- Etiquetas de columnas/tarjetas: "USD" pasa a mostrar sufijo dinámico ("USD Paralelo" o "USD BCV")

Páginas involucradas:
- `src/routes/_authenticated/dashboard.tsx` (tarjetas + tabla últimos movimientos + `DashboardCharts` si aplica)
- `src/routes/_authenticated/gyp.tsx`
- `src/routes/_authenticated/fc.tsx`
- `src/routes/_authenticated/impuestos.tsx`
- `src/routes/_authenticated/propinas.tsx`
- `src/routes/_authenticated/capex.tsx`
- `src/routes/_authenticated/aumento-capital.tsx`
- `src/routes/_authenticated/liquidaciones.tsx`
- `src/routes/_authenticated/anticipos-proveedores.tsx`

### 5. Fuera de alcance
- No se toca la página **Transacciones** (ya tiene su lógica reciente y no fue solicitada).
- No se modifica cómo se guarda `monto_usd` en la BD — solo es visual.
- No se cambia la Core rule: paralela sigue siendo el default y la fuente principal.

## Detalles técnicos
- El contexto vive en `_authenticated.tsx` layout, así todas las rutas hijas comparten estado.
- `localStorage` se lee de forma segura (guard SSR con `typeof window`).
- El helper acepta mapas `Record<fecha, tasa>` para evitar N queries — cada página hace 1 query a `tasas_paralela` y 1 a `tasas_bcv` por rango.
- Cuando `mode="bcv"` y no hay `tasa_bcv` para esa fecha, se muestra "—" (igual que hoy en transacciones).

## Entregables
1. `src/lib/usd-view-context.tsx` (nuevo)
2. `src/lib/usd-visual.ts` (nuevo)
3. `src/components/usd-view-toggle.tsx` (nuevo)
4. Editar `_authenticated.tsx` para envolver con provider
5. Editar las 9 páginas para agregar toggle + usar helper
