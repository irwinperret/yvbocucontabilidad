# Reducir el consumo del AI Gateway

Sí, se puede bajar muchísimo. Hoy cada análisis usa `openai/gpt-5.5` y cuesta ~0.14–0.23 créditos por corrida (19 llamadas registradas, todas exitosas). El costo se puede reducir aproximadamente un orden de magnitud sin cambiar el contenido del análisis.

## Cambios propuestos

1. **Modelo más barato por defecto** (`src/lib/analisis-ai.functions.ts`)
   - Usar `google/gemini-3-flash` como modelo por defecto para el análisis mensual.
   - Dejar `openai/gpt-5.5` disponible solo como opción "Análisis profundo" cuando el usuario lo pida explícitamente.

2. **Limitar el tamaño de la respuesta**
   - Fijar un tope de tokens de salida (la salida es lo que domina el costo: ~1.000–1.800 tokens por corrida hoy).
   - Ajustar el prompt para pedir 3 recomendaciones (no 5) y explicaciones de máximo 2 oraciones, que ya es la estructura esperada en pantalla.

3. **Evitar corridas repetidas del mismo período** (`src/routes/_authenticated/analisis-ai.tsx`)
   - Guardar el último análisis por (período, vista) en el navegador y mostrarlo al volver a entrar, en vez de regenerar.
   - "Regenerar" sigue disponible como acción explícita.

4. **Selector de costo en la UI**
   - Botón con dos modos: "Rápido (bajo costo)" — por defecto — y "Profundo (mayor costo)".
   - El diálogo de confirmación indica el modo elegido antes de gastar créditos.

5. **Manejo correcto del error 402**
   - Cuando la pasarela responda sin créditos, mostrar una tarjeta clara con la causa y la fecha de renovación, sin reintentos automáticos.

## Detalle técnico

- Solo se tocan `src/lib/analisis-ai.functions.ts` (modelo, tope de salida, prompt) y `src/routes/_authenticated/analisis-ai.tsx` (selector, caché local, estado de error). El snapshot financiero y el RPC `get_analisis_snapshot` no cambian.
- Adicionalmente, se puede configurar una alerta/bloqueo de créditos por consumo del AI Gateway a nivel de workspace si ya existe una regla; eso se revisa aparte de este cambio de código.
