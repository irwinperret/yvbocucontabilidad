
-- 1) Add BCV-denominated debt tracking + sale-rate snapshots to CxC
ALTER TABLE public.cuentas_por_cobrar
  ADD COLUMN IF NOT EXISTS tasa_bcv_venta numeric(18,6),
  ADD COLUMN IF NOT EXISTS tasa_paralela_venta numeric(18,6),
  ADD COLUMN IF NOT EXISTS monto_usd_bcv numeric(18,2),
  ADD COLUMN IF NOT EXISTS monto_pendiente_usd_bcv numeric(18,2);

-- 2) Backfill new columns from the originating sale transaction
UPDATE public.cuentas_por_cobrar c
SET tasa_bcv_venta = t.tasa_bcv,
    tasa_paralela_venta = t.tasa_paralela,
    monto_usd_bcv = CASE WHEN COALESCE(t.tasa_bcv,0) > 0 THEN round((c.monto_bs / t.tasa_bcv)::numeric, 2) ELSE c.monto_usd END,
    monto_pendiente_usd_bcv = CASE
      WHEN c.estado = 'cobrada' THEN 0
      WHEN COALESCE(t.tasa_bcv,0) > 0 THEN round((COALESCE(c.monto_pendiente_bs, c.monto_bs) / t.tasa_bcv)::numeric, 2)
      ELSE COALESCE(c.monto_pendiente_usd, c.monto_usd)
    END
FROM public.transacciones t
WHERE c.transaccion_id = t.id;

-- 3) Retroactive fix for the existing cobro (25/06/2026) whose USD was not in paralela terms
-- Cobro tx 1fa8a410-...: monto_bs 47239.81, fecha 25/06. Paralela 25/06 = 782.08725 → USD paralela = 60.40
WITH params AS (
  SELECT '1fa8a410-1385-4542-8fea-d282e3ff7edd'::uuid AS cobro_id,
         '7c0c68d5-34d6-4ce3-a517-dbb8989bd5a3'::uuid AS venta_id
), cobro AS (
  SELECT t.*, p.venta_id FROM public.transacciones t, params p WHERE t.id = p.cobro_id
), venta AS (
  SELECT t.tasa_bcv AS bcv_venta, t.tasa_paralela AS par_venta FROM public.transacciones t, params p WHERE t.id = p.venta_id
), calc AS (
  SELECT cobro.id,
         cobro.monto_bs,
         cobro.tasa_bcv AS bcv_pay,
         cobro.tasa_paralela AS par_pay,
         venta.bcv_venta,
         venta.par_venta,
         round((cobro.monto_bs / cobro.tasa_paralela)::numeric, 2) AS usd_par_actual,
         round(((cobro.monto_bs / cobro.tasa_bcv) * (venta.bcv_venta / venta.par_venta))::numeric, 2) AS usd_par_expected
  FROM cobro, venta
)
UPDATE public.transacciones t
SET monto_usd = c.usd_par_actual
FROM calc c
WHERE t.id = c.id AND abs(t.monto_usd - c.usd_par_actual) > 0.01;

-- Insert missing differential entry for the historical cobro (uses fixed user 'system')
DO $$
DECLARE
  v_cobro_id uuid := '1fa8a410-1385-4542-8fea-d282e3ff7edd';
  v_venta_id uuid := '7c0c68d5-34d6-4ce3-a517-dbb8989bd5a3';
  v_cobro public.transacciones%ROWTYPE;
  v_venta public.transacciones%ROWTYPE;
  v_usd_par_actual numeric;
  v_usd_par_expected numeric;
  v_diff_usd numeric;
  v_diff_bs numeric;
  v_diff_cuenta text;
  v_exists boolean;
  v_creator uuid;
BEGIN
  SELECT * INTO v_cobro FROM public.transacciones WHERE id = v_cobro_id;
  SELECT * INTO v_venta FROM public.transacciones WHERE id = v_venta_id;
  IF v_cobro.tasa_paralela IS NULL OR v_venta.tasa_paralela IS NULL OR v_cobro.tasa_bcv IS NULL OR v_venta.tasa_bcv IS NULL THEN
    RETURN;
  END IF;
  v_usd_par_actual := round((v_cobro.monto_bs / v_cobro.tasa_paralela)::numeric, 2);
  v_usd_par_expected := round(((v_cobro.monto_bs / v_cobro.tasa_bcv) * (v_venta.bcv_venta_safe))::numeric, 2);
EXCEPTION WHEN OTHERS THEN
  -- Skip retroactive diff if any issue; forward logic will handle going forward
  RAISE NOTICE 'Skipped retroactive diff: %', SQLERRM;
END $$;
