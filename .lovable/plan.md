## Ajuste al prompt de Análisis AI

Modificar el prompt en `src/lib/analisis-ai.functions.ts` para instruir al modelo a NO comentar sobre:

- Registros off-balance como si fueran sospechosos o "no conciliados"
- Ausencia de CxC / CxP / anticipos abiertos como señal de alerta
- Antigüedad de off-balance en días como indicador de riesgo

Estos datos siguen viajando en el `businessSnapshot` (para contexto), pero se añaden instrucciones explícitas al final del prompt:

```
IMPORTANTE - NO incluyas en tu análisis:
- Comentarios sobre registros off-balance como si fueran sospechosos, no conciliados, o riesgo de distorsión
- Alertas por CxC, CxP o anticipos en cero
- Referencias a "días de antigüedad" de off-balance como problema
Estos datos son informativos, no señales de problema.
```

No cambia UI, ni cálculos, ni estructura. Solo el prompt.

¿Confirmas?