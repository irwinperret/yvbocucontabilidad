# Visualización de USD a tasa paralela en Análisis

## Contexto

Por regla del proyecto, `monto_usd` ya se almacena en todas las tablas convertido a **tasa paralela**. Lo que falta es:

1. Mostrar claramente en cada pestaña de Análisis qué tipo de dólar se está visualizando.
2. Confirmar que ningún total/gráfico se esté calculando con `tasa_bcv` por error.

## Cambios por pestaña

### Pestañas principales (`analisisPrincipales`)

| Pestaña | Ruta | Etiqueta a mostrar bajo el título |
|---|---|---|
| Dashboard | `/dashboard` | "Montos USD a tasa paralela · BCV solo como referencia fiscal" |
| G&P | `/gyp` | "Todos los montos en USD a **tasa paralela** · base sin IVA" (actualizar la línea existente) |
| Flujo de caja | `/fc` | "Movimientos efectivos en USD a **tasa paralela**" (actualizar la línea existente) |
| Impuestos | `/impuestos` | "IVA débito/crédito en USD a **tasa paralela**. La columna *Tasa BCV* y el monto en Bs se conservan como referencia fiscal." |
| Propinas | `/propinas` | "Propinas en USD a **tasa paralela**" |

### Pestañas de detalle (`analisisDetalles`) que muestran USD

Agregar el mismo subtítulo "USD a **tasa paralela**" en:

- `/capex` — CapEx
- `/aumento-capital` — Aumento de capital
- `/liquidaciones` — Liquidaciones
- `/anticipos-proveedores`
- `/activos-transitorios`
- `/saldos-bancarios`
- `/cxc` y `/cxp`
- `/off-balance`
- `/diferencial-cambiario` (aclarar que muestra **diferencia entre BCV y Paralela**)

### Componente reutilizable

Crear `src/components/usd-rate-badge.tsx`: un badge compacto con tooltip que diga
"USD calculado a tasa paralela del día de la transacción. BCV se mantiene solo como referencia fiscal."
Colocarlo junto al título de cada página de Análisis, para no repetir texto largo.

Variante `variant="bcv"` para `/tasa` (Tasa BCV) y casos donde se muestra explícitamente BCV.

## Validación de cálculos

Auditar (solo lectura, sin cambios si ya es correcto) que estas páginas sumen `monto_usd` y no recalculen vía `monto_bs / tasa_bcv`:

- `capex.tsx` ✅ usa `t.monto_usd`
- `fc.tsx` ✅ usa `t.monto_usd`
- `impuestos.tsx` ✅ usa `r.monto_usd`
- `dashboard.tsx` ✅ usa `t.monto_usd`
- `propinas.tsx` ✅ usa `p.monto_usd`
- `gyp.tsx` — verificar la query interna
- `liquidaciones.tsx`, `aumento-capital.tsx`, `anticipos-proveedores.tsx`, `activos-transitorios.tsx`, `off-balance.tsx`, `saldos-bancarios.tsx`, `cxc.tsx`, `cxp.tsx` — verificar y, si alguno divide entre `tasa_bcv`, corregir a usar `monto_usd` directamente.

## Excluido

- No se tocan importaciones, lógica de conversión ni datos en BD: las tasas y los montos ya fueron corregidos retroactivamente en turnos anteriores.
- No se modifica `/tasa` ni `/tasa-paralela` (esas páginas son específicamente sobre cada tasa).
