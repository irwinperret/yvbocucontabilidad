# Plan: Análisis AI

Nueva pestaña bajo **Análisis** en el sidebar que genera un análisis financiero con IA a partir de un snapshot del período seleccionado.

## Nota sobre el proveedor de IA

En lugar de llamar directo a la API de Anthropic (requiere secret, expone key, cuesta aparte), uso **Lovable AI Gateway** — ya está configurado (`LOVABLE_API_KEY` existe en secrets), es server-side, y soporta modelos equivalentes. Uso `openai/gpt-5.5` como default (más capaz para análisis financiero en español). Mismo prompt, mismo resultado esperado, sin configuración adicional. Si prefieres Claude específicamente, dilo y ajusto el plan para pedir tu `ANTHROPIC_API_KEY`.

## Archivos nuevos

**`src/routes/_authenticated/analisis-ai.tsx`** — página con:
- Selector de período (mes/año, default = mes actual)
- Botón "Actualizar análisis"
- Estados: idle / loading ("Analizando datos financieros...") / results / error / empty
- Card destacada con diagnóstico
- Cards por recomendación con badge de prioridad (ALTA rojo, MEDIA amarillo, BAJA verde)
- Timestamp "Análisis generado el ..."
- Botón "Copiar análisis"
- **Nunca cachea**: cada cambio de período o click del botón re-ejecuta

**`src/lib/analisis-ai.functions.ts`** — server function `generarAnalisisAI({ periodo })` con `requireSupabaseAuth`:
1. Calcula rango de fechas del período + mes anterior + hace 2 meses
2. Consulta `transacciones` agrupando por prefijo de `cuenta_codigo` (1.%, 2.%, …, 9.%) y por `centro_costo` (YV, Bocú, YV Market)
3. Consulta `cuentas_por_cobrar`, `cuentas_por_pagar`, anticipos (14.2), off_balance
4. Consulta última tasa BCV y paralela
5. Construye `businessSnapshot` exactamente con los campos pedidos
6. Si `ingresos_usd == 0` y todos los gastos == 0 → retorna `{ empty: true }`
7. Llama a Lovable AI Gateway (`ai.gateway.lovable.dev/v1`, modelo `openai/gpt-5.5`) con el prompt tal cual fue especificado
8. Retorna `{ snapshot, texto, generadoEn }`

## Parseo de la respuesta

El modelo devuelve markdown estructurado. El componente:
- Divide por líneas
- Toma el primer párrafo (antes de la primera recomendación numerada) como diagnóstico
- Detecta cada recomendación por regex `/^\d+\./`
- Extrae título en `**negrita**`, cuerpo, y prioridad (`ALTA|MEDIA|BAJA`) por regex
- Fallback: si el parseo falla, muestra el texto crudo en un `<pre>` con formato preservado

## Sidebar

En `src/components/app-sidebar.tsx`, agrego a `analisisPrincipales`:
```
{ title: "Análisis AI", url: "/analisis-ai", icon: Sparkles }
```
(icono `Sparkles` de lucide-react, ya disponible)

## Cálculo del snapshot (SQL en el server function)

- Suma por prefijo: uso `.like('cuenta_codigo', '1.%')` filtrando por rango `fecha` del período. `modo='on_balance'` solo para ingresos (según spec).
- `utilidad_neta_usd` = ingresos − (cogs + nomina + admin + operativos + mercadeo + generales)
- `margen_neto_pct` = utilidad / ingresos (null-safe si ingresos = 0)
- `cxp_total_usd`: la spec dice `sum monto_pendiente_bs` — lo interpreto como bug del spec y uso `monto_pendiente_usd` para consistencia. Si prefieres Bs, lo cambio.
- Fecha del período: primer y último día del mes YYYY-MM seleccionado.

## Manejo de errores

- Error de red / gateway 5xx → toast + estado de error con mensaje "Error al conectar con el servicio de análisis. Intenta de nuevo."
- 429 → "Límite de uso alcanzado, intenta más tarde."
- 402 → "Créditos agotados en Lovable AI, agrega créditos en Workspace Settings."
- Datos vacíos → "No hay suficientes datos para este período"

## Fuera de alcance

- No agrego caché en DB (spec exige rerun siempre)
- No agrego historial de análisis previos (se puede añadir después si lo pides)
- No modifico la lógica de otras vistas

¿Confirmas usar Lovable AI Gateway, o quieres que use Anthropic directo con tu propia key?
