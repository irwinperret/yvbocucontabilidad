## Problema

En el dashboard, `DashboardCharts` siempre consulta la vista `v_transacciones_mensual` (USD paralelo). El botón "Paralelo / BCV" cambia el contexto `useUsdView`, pero los gráficos ignoran ese modo — por eso no cambian los valores al alternar.

Ya existe el helper `mensualView(mode)` en `src/lib/usd-view-context.tsx` que devuelve la vista correcta:
- `paralela` → `v_transacciones_mensual`
- `bcv` → `v_transacciones_mensual_bcv`

## Cambio

Archivo: `src/components/dashboard-charts.tsx`

1. Importar `useUsdView` y `mensualView` de `@/lib/usd-view-context`.
2. Leer `const { mode } = useUsdView();` dentro del componente.
3. En el `useQuery` de `dash-rows`:
   - Incluir `mode` en el `queryKey` para que refresque al alternar.
   - Usar `supabase.from(mensualView(mode))` en vez de la vista fija.

No se toca lógica de negocio ni cálculos; solo la fuente de datos según el toggle ya existente. Los cuatro gráficos (G&P, FC, CapEx vs Utilidad, Gastos por grupo) se recalculan automáticamente porque derivan de `rows`.

## Verificación

- Alternar el toggle Paralelo/BCV en el dashboard debe recargar los gráficos con valores distintos (BCV suele dar montos USD mayores por tasa más baja).
