## 1) Nómina en Bolívares + tab "Chef Ejecutivo (USD)"
Refactor de `NominaForm` en `src/routes/_authenticated/registrar.tsx`:
- Tabs internos: **"Nómina regular (Bs)"** y **"Chef Ejecutivo (USD)"**
- Pestaña regular: mismos campos (BYV / BOCU / BYV-BOCU compartido 33/67) pero los inputs ahora son en **Bs**. `monto_bs` es la fuente; `monto_usd = monto_bs / tasa_paralela`.
- Pestaña Chef: banner "Solo para Chef Ejecutivo en principio. Acuerdos futuros pueden cambiarlo." Un solo bloque (salario / alimentación / compensatorio / parafiscales) en **USD**, con selector de centro (YV / Bocu / Compartido 33-67). `monto_usd` es la fuente; `monto_bs = usd * tasa_paralela`.
- Mismos campos comunes: quincena, mes, año, método, cuenta bancaria, notas.

## 2) Fix de cursor en Nómina
Causa: el subcomponente `Seccion` está **definido dentro** de `NominaForm`. Cada keystroke crea una identidad nueva → React desmonta y vuelve a montar el `<Input>` → pierde foco.
Fix: extraer `Seccion` fuera del componente padre (o renderizar inline). Aplica a regular y chef.

## 3) Recálculo automático cuando cambia la tasa paralela
Nueva server fn `recalcParalelaPorFecha(fecha)` en `src/lib/recalc-paralela.functions.ts`:
- Lee la nueva tasa paralela vigente para `fecha`.
- Para cada `transaccion` con esa `fecha`: actualiza `tasa_paralela` y recalcula `monto_usd = monto_bs / tasa_nueva` (redondeado 2 dec).
- Devuelve `{ actualizadas, fecha, tasa }`.
- No toca IVA (que es derivado de monto_bs base).

Se invoca desde:
- Registro manual en `tasa-paralela.tsx` (después de insert exitoso).
- `syncTasaParalela` (auto-sync) tras insertar.
- `backfillTasaParalela` (por cada fecha insertada).

Nota: este recálculo asume Bs como fuente. Las transacciones "USD source" (Chef USD, zelle, efectivo_usd) sí cambian su `monto_usd` al cambiar la tasa — comportamiento esperado según pedido ("recálculo completo").

## 4) Tasas BCV y Paralela sin límite
- `src/routes/_authenticated/tasa.tsx`: quitar `.limit(30)`, título → "Todas las tasas registradas", contenedor `max-h-[600px] overflow-auto` para scroll.
- `src/routes/_authenticated/tasa-paralela.tsx`: igual para `tasas_paralela` y `tasas_bcv` comparativo.

## Archivos afectados
- `src/routes/_authenticated/registrar.tsx` (refactor NominaForm + fix cursor)
- `src/routes/_authenticated/tasa.tsx` (sin límite)
- `src/routes/_authenticated/tasa-paralela.tsx` (sin límite + invocar recalc)
- `src/lib/recalc-paralela.functions.ts` (nuevo)
- `src/lib/paralela-sync.functions.ts` (invocar recalc tras insertar)
- `src/lib/paralela-backfill.functions.ts` (invocar recalc por fecha insertada)
