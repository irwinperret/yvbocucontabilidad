## Cambios en Análisis AI

### 1. Toggle USD paralelo / USD BCV
- En `src/routes/_authenticated/analisis-ai.tsx`, agregar `<UsdViewToggle />` en el header (junto al selector de período), siguiendo el mismo patrón que Dashboard/G&P/FC.
- Leer `mode` desde `useUsdView()` y pasarlo al server function `generarAnalisisAI` como parámetro adicional (`vista: "paralela" | "bcv"`).
- Incluir `mode` en el `queryKey` para que el snapshot y el análisis se regeneren al cambiar de vista.
- Actualizar los KPI cards para reflejar la etiqueta activa ("USD paralelo" / "USD BCV").

### 2. Snapshot según vista en el backend
- En `src/lib/analisis-ai.functions.ts`:
  - Extender `InputSchema` con `vista`.
  - Cuando `vista === "bcv"`, obtener los agregados desde la vista/rpc equivalente en BCV. Opciones:
    - Añadir parámetro a `get_analisis_snapshot` para elegir tasa, **o**
    - Crear `get_analisis_snapshot_bcv` con la misma forma pero usando `v_transacciones_mensual_bcv` / tasa BCV.
  - Etiquetar el snapshot con la vista usada y pasarla al prompt para que el AI mencione la tasa correcta.

### 3. Evitar recomendaciones que comparen YV vs Bocú
- En el prompt de `generarAnalisisAI`, añadir a la sección "IMPORTANTE — NO incluyas":
  - No hacer recomendaciones ni comentarios basados en la diferencia de tamaño/ingresos entre YV y Bocú (son unidades de negocio de escalas distintas por diseño).
  - No sugerir "equilibrar", "cerrar la brecha" ni comparar performance relativo entre ambas marcas.
- Mantener los valores `ingresos_yv` / `ingresos_bocu` en el snapshot solo como contexto informativo; el prompt debe tratarlos como datos independientes.

### Archivos afectados
- `src/routes/_authenticated/analisis-ai.tsx`
- `src/lib/analisis-ai.functions.ts`
- Posible nueva migración SQL si se opta por `get_analisis_snapshot_bcv`.
