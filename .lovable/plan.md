# Análisis AI: por qué dice "sin créditos"

## Qué está pasando (verificado)

El balance del workspace hoy es:

- Plan Pro, período 28 jul – 28 ago.
- Créditos mensuales: **0 de 100** restantes.
- Rollover: **0 de 100**. Top-up: **0 de 450**. Bonus: **0 de 10**.
- Solo quedan **4 créditos diarios** (se renuevan cada día).

Los créditos que ves disponibles son los **diarios**, que sirven para mensajes de build/plan, no para cubrir el consumo del AI Gateway una vez agotada la asignación de IA del período. Por eso la pasarela responde 402 y la pantalla muestra "Créditos agotados en Lovable AI".

Las 19 llamadas del historial (todas exitosas, modelo `openai/gpt-5.5`, ~0.15–0.23 créditos cada una) confirman que la integración funciona: no es un bug de código, es saldo.

## Soluciones reales

1. **Comprar créditos** en Settings → Plans & credits (o esperar la renovación del 28 de agosto).
2. **Bajar el costo por análisis** cambiando el modelo por defecto de `openai/gpt-5.5` a uno mucho más barato (`google/gemini-3-flash`), reservando gpt-5.5 como opción "análisis profundo". Esto reduce el gasto por corrida en torno a un orden de magnitud.

## Cambios propuestos en la app

1. `src/lib/analisis-ai.functions.ts`
   - Aceptar un parámetro opcional `modelo` ("rapido" | "profundo"), con `google/gemini-3-flash` por defecto y `openai/gpt-5.5` para profundo.
   - Devolver un error tipado en 402/429 (código + mensaje del gateway) en lugar de un `Error` genérico.

2. `src/routes/_authenticated/analisis-ai.tsx`
   - Selector "Rápido (bajo costo)" / "Profundo" junto al botón de desplegar.
   - Cuando la respuesta sea 402, mostrar una tarjeta clara: "Los créditos de IA del workspace se agotaron; se renuevan el 28 de agosto o puedes recargar en Settings → Plans & credits", en vez del toast genérico. Sin reintentos automáticos.
   - Mencionar en el diálogo de confirmación el costo aproximado según el modelo elegido.

No se toca la lógica financiera ni el snapshot: solo el modelo usado, el manejo del error y el texto en pantalla.
