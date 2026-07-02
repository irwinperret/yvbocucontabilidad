## Bugs

**Bug 1** — In `src/routes/_authenticated/registrar.tsx` (cierre de mes / COGS):
- `totalComprasUsdBcv` (used in "Compras del mes (auto)" and in `cogsUsd = iniUsd + totalComprasUsdBcv - finUsd`) is recomputed as `sum(monto_base_bs / tasa_bcv)`. That's why a compra with stored `monto_usd = $428.22` shows up as ~$496.64 in the total.

**Bug 2** — Net USD (sin IVA) is never shown as its own column:
- Cierre de mes compras table has "USD base" but it's actually `monto_base_usd ?? monto_usd`, ambiguous; there is no dedicated IVA USD / Total USD split.
- Main Transacciones table shows only a single "USD" (= `monto_usd`, total incl. IVA).
- G&P view `v_transacciones_mensual.base_usd` is recomputed as `sum(monto_base_bs / tasa_paralela)` — same "redivide by a rate" pattern, drifts from the stored per-row `monto_usd`.

## Fix

### 1. Cierre de mes (`src/routes/_authenticated/registrar.tsx`)

Replace the recomputation with sums of the already-stored per-row values from `inventario_snapshots`:

```ts
// Net USD (sin IVA) — feeds COGS
const totalComprasNetoUsd = compras
  .filter(c => c.modo !== "off_balance")
  .reduce((s, c) => s + (Number(c.monto_base_usd) ?? Number(c.monto_usd) ?? 0), 0);

// IVA USD
const totalComprasIvaUsd = compras
  .filter(c => c.modo !== "off_balance")
  .reduce((s, c) => s + (Number(c.iva_usd) || 0), 0);

// Total USD (neto + IVA)
const totalComprasUsd = totalComprasNetoUsd + totalComprasIvaUsd;
```

- `cogsUsd = iniUsd + totalComprasNetoUsd - finUsd` (net, no IVA — as today conceptually but sourced from stored USD).
- "Compras del mes (auto)" tile now shows `fmtBs(totalCompras)` · `fmtUsd(totalComprasNetoUsd)` and adds a sub-line "IVA: $X · Total con IVA: $Y" when IVA > 0.
- Remove the `bcvByFecha` / `tasa_bcv` re-division block for these totals.
- `cogs` (Bs) keeps using `tasaPromedio` for the DB record (`cogs_bs`), that's a Bs valuation not the bug.

### 2. Compras table inside cierre de mes

Replace the current "Monto Bs / USD base" columns with three explicit USD columns:

| Fecha | Proveedor | N° fact. | Monto neto Bs | IVA Bs | Total Bs | **Monto neto USD (sin IVA)** | **IVA USD** | **Total USD (neto + IVA)** | Estado |

- Per row: `monto_base_bs`, `iva_bs`, `monto_bs`, `monto_base_usd ?? monto_usd`, `iva_usd`, `monto_usd`.
- `tfoot` totals for each of the three USD columns.
- When `iva_bs === 0` the row still fills IVA USD = $0.00 and Net USD = Total USD, removing the ambiguity called out in the bug report.

### 3. Main Transacciones table (`src/routes/_authenticated/transacciones.tsx`)

Currently one "USD" column (total) plus reference "USD (BCV)". Add net split so cuenta 2.1 rows show the net figure that actually feeds COGS. To keep the layout digestible, render the USD column the same way the Bs column already renders when IVA > 0:

- If `iva_bs > 0`: show `Monto neto USD` on top and `+ IVA USD` in the small line under it (same visual pattern as the Bs column at line 559-564). Net USD = `monto_usd − iva_bs / tasa_paralela` (fallback to `tasa_bcv`), or `monto_base_bs / monto_bs * monto_usd` (equivalent, avoids re-division by rate); we'll use the ratio form so it's derived from the stored USD, not a re-conversion.
- If `iva_bs === 0`: show `monto_usd` alone (unchanged).
- Column header changes to "USD (neto)" with tooltip "Neto sin IVA · el `+ IVA` aparece debajo cuando aplica".
- "USD (BCV)" reference column is unchanged.

This applies to every row (not just 2.1) so numbers stay consistent everywhere; 2.1 rows are the ones the bug report cares about but the treatment is universal and there is no regression for rows without IVA.

### 4. G&P report — `v_transacciones_mensual.base_usd`

New migration replaces the `base_usd` expression so it is derived from the already-stored per-row `monto_usd` (which was written at import/registration time at the correct rate) instead of re-dividing `monto_base_bs / tasa_paralela`:

```sql
CREATE OR REPLACE VIEW public.v_transacciones_mensual AS
SELECT
  ...
  sum(
    CASE
      WHEN cuenta_codigo = '13.2' OR notas ILIKE 'Pago CxP%' THEN 0::numeric
      WHEN COALESCE(monto_bs,0) = 0 THEN 0::numeric
      ELSE monto_usd * (monto_base_bs / monto_bs)          -- net share of the stored USD
    END
  ) AS base_usd,
  sum(
    CASE
      WHEN metodo_pago = 'pendiente' THEN 0::numeric
      ELSE monto_usd                                       -- stored total USD, no re-division
    END
  ) AS total_usd,
  ...
```

Effect on the G&P COGS section: cuenta 2.1 aggregates now equal `sum(monto_usd_net_per_row)`, matching what the transacciones and cierre views show. Rows with `iva_bs = 0` collapse to `monto_usd` directly.

## Out of scope

- No schema change to `transacciones` (we derive net USD from stored fields per row).
- No change to how `monto_usd` is written at insert time (already correct per project memory: paralela with BCV fallback).
- No retroactive rewriting of old rows.

## Files touched

- `src/routes/_authenticated/registrar.tsx` — cierre totals + compras table columns.
- `src/routes/_authenticated/transacciones.tsx` — USD column split when IVA > 0.
- `supabase/migrations/<new>.sql` — replace `v_transacciones_mensual` definition.
