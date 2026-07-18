## Objetivo

Reforzar la invariante **`monto_usd` es autoritativo; `monto_bs` siempre se deriva de `monto_usd × tasa_bcv_promedio_del_periodo`** en todo el flujo de cierre e inventarios, y cerrar el hueco de la cascada al editar el **inicial** (hoy solo hay cascada final→siguiente inicial).

## Bugs encontrados en el código actual

1. **`CierreForm.submit()`** (registrar.tsx 4134-4141): `inventario_inicial_bs: iniUsd * tasaConv` donde `tasaConv = paralelaPromedio || tasaPromedio`. Si hay paralela, el Bs del inventario se guarda a paralela en vez de BCV.
2. **Cascada mes anterior** (registrar.tsx 4252-4280): `newCogsUsdAnt = iniUsdAnt + comprasUsdAnt - newPrevFinalUsd` mezcla USD BCV (snapshots) con USD paralelo (transacciones 2.1); luego `cogs_bs = newCogsUsdAnt * tasaAnt(BCV)` es incoherente.
3. **`recalcCierreForPeriod`** (inventario.functions.ts): suma `monto_bs` directamente desde snapshots y desde tx 2.1 → carga Bs viejos; no consulta `tasas_paralela` para el período; `cogs_usd` termina mezclando unidades.
4. **`editarInventarioSnapshot`**: solo cascada final→siguiente inicial. Falta inicial→mes anterior final. Tampoco crea el snapshot vinculado si no existe.

Fix 4 del Prompt 1 (fetch paralela promedio en `CierreForm`) ya está implementado; se conserva.

## Cambios

### 1. `src/lib/inventario.functions.ts` — reescribir `recalcCierreForPeriod`

Lógica por período afectado:

```text
tasaBcvProm  = cierres_de_mes.tasa_bcv_promedio (fallback: promedio de tasas_bcv del período)
paralelaProm = promedio de tasas_paralela del período (nueva consulta)

iniUsd = snapshot(periodo,'inicial').monto_usd    // autoritativo
finUsd = snapshot(periodo,'final').monto_usd
iniBs  = round(iniUsd * tasaBcvProm, 2)           // derivado
finBs  = round(finUsd * tasaBcvProm, 2)

comprasNetoBs = SUM(COALESCE(monto_base_bs, monto_bs)) FROM transacciones
                WHERE cuenta_codigo='2.1' AND fecha en período
cogsBs  = iniBs + comprasNetoBs - finBs
cogsUsd = paralelaProm > 0 ? cogsBs / paralelaProm : 0
```

Después: **actualizar los `inventario_snapshots.monto_bs`** del período con `iniBs`/`finBs` recomputados (mantiene el Bs almacenado consistente); actualizar `cierres_de_mes` con `inventario_inicial_bs`, `inventario_final_bs`, `compras_mes_bs`, `cogs_bs`, `cogs_usd`; regenerar tx 2.2 con `monto_bs=cogsBs`, `monto_usd=cogsUsd`, `tasa_bcv=tasaBcvProm`, `tasa_paralela=paralelaProm`.

### 2. `src/lib/inventario.functions.ts` — extender `editarInventarioSnapshot`

- Input: agregar `cascade_prev_month: boolean` (por defecto false).
- Al editar `tipo='inicial'` de X con `cascade_prev_month=true`:
  - Buscar snapshot `final` de X-1. Si existe, update `monto_usd=newIniUsd`, `monto_bs=newIniUsd × tasaBcvProm_{X-1}`. Si no existe, crearlo (fecha = último día de X-1) con la tasa BCV promedio de X-1 (consulta a `tasas_bcv` del período, aunque no haya cierre).
  - Luego `recalcCierreForPeriod(X-1)` si existe cierre de X-1; si no existe, se deja el snapshot creado sin recalcular.
- Al editar `tipo='final'` de X con `cascade_next_month=true`:
  - Comportamiento actual + si no existe `inicial` de X+1, crearlo con `monto_usd=newFinUsd`, `monto_bs=newFinUsd × tasaBcvProm_{X+1}` (fecha = primer día de X+1).
- Retornar `{ primary, cascaded_prev, cascaded_next }`.

### 3. `src/routes/_authenticated/registrar.tsx` — `CierreForm`

Reescribir la sección Bs/COGS explícitamente:

```ts
const tasaBcv = tasaPromedio;                            // BCV
const iniBs  = iniUsd * tasaBcv;
const finBs  = finUsd * tasaBcv;
const cogsBs = iniBs + totalComprasNetoBs - finBs;
const cogsUsd = paralelaPromedio > 0 ? cogsBs / paralelaPromedio : 0;
```

- Insert `cierres_de_mes`: `inventario_inicial_bs=iniBs`, `inventario_final_bs=finBs`, `compras_mes_bs=totalComprasNetoBs`, `cogs_bs=cogsBs`, `cogs_usd=cogsUsd`, `tasa_bcv_promedio=tasaBcv`.
- Snapshots del período: `monto_bs = monto_usd × tasaBcv` siempre (nunca paralela).
- Tx 2.2: `monto_bs=cogsBs`, `monto_usd=cogsUsd`, `tasa_bcv=tasaBcv`, `tasa_paralela=paralelaPromedio`.
- Cascada al mes anterior: reemplazar el bloque in-line por una llamada a la lógica compartida — actualizar el snapshot final del mes anterior con `monto_bs = newPrevFinalUsd × tasaBcvProm_{X-1}` y disparar `recalcCierreForPeriod(periodoAnterior)`. Elimina la mezcla de unidades actual.

### 4. `src/routes/_authenticated/inventarios.tsx` — UI cascada + indicador

- `save()` con `tipo='inicial'`: nueva confirmación
  > "Al modificar el inventario inicial de [X], se actualizará automáticamente el inventario final de [X-1] a $[newIniUsd]. ¿Deseas continuar?"

  y pasa `cascade_prev_month: true` a la server fn.
- `save()` con `tipo='final'`: texto equivalente para X+1 (reemplazar el actual).
- Toasts basados en `cascaded_prev` y `cascaded_next`.
- **Chips de vínculo** en la tabla:
  - Junto al monto USD del `final`: chip pequeño con `LinkIcon` + "→ inicial `{mesSiguiente}`" si el snapshot existe. Click → `scrollIntoView` + clase temporal `bg-accent/40` sobre la fila destino durante ~1.5s.
  - Junto al monto USD del `inicial`: chip "← final `{mesAnterior}`" con mismo comportamiento.
  - Si el snapshot vinculado no existe, mostrar chip gris "sin vínculo".

## Fuera de alcance

- No se cambia la importación de compras Xetux ni cómo se guardan `monto_usd`/`monto_bs` de las transacciones 2.1.
- No se recomputan snapshots históricos automáticamente — solo los del período que se edita o cierra.
- No se toca el flujo de borrado ni el de reapertura manual.

## Archivos afectados

- `src/lib/inventario.functions.ts`
- `src/routes/_authenticated/registrar.tsx`
- `src/routes/_authenticated/inventarios.tsx`
