-- Borrado atómico de todo lo derivado de un lote de importación
CREATE OR REPLACE FUNCTION public.purgar_filas_importacion(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx uuid[];
  n_tx int := 0; n_cxp int := 0; n_cxc int := 0; n_prop int := 0; n_conc int := 0; n_rest int := 0;
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_tx
  FROM public.transacciones WHERE import_batch_id = p_batch;

  -- 1) Restaurar CxP que este lote marcó como pagadas/parciales
  WITH r AS (
    UPDATE public.cuentas_por_pagar c
    SET estado = COALESCE(c.revert_estado_anterior, 'pendiente'),
        monto_pendiente_bs = COALESCE(c.revert_pendiente_bs_anterior, c.monto_bs),
        monto_pendiente_usd_bcv = COALESCE(c.revert_pendiente_usd_bcv_anterior, c.usd_bcv_factura),
        pagada_at = c.revert_pagada_at_anterior,
        revert_batch_id = NULL,
        revert_estado_anterior = NULL,
        revert_pendiente_bs_anterior = NULL,
        revert_pendiente_usd_bcv_anterior = NULL,
        revert_pagada_at_anterior = NULL
    WHERE c.revert_batch_id = p_batch
      AND (c.import_batch_id IS DISTINCT FROM p_batch)
    RETURNING 1
  ) SELECT count(*) INTO n_rest FROM r;

  -- 2) Revertir aplicaciones de anticipo hechas por este lote
  UPDATE public.transacciones a
  SET anticipo_aplicado_usd_bcv = GREATEST(0, ROUND((COALESCE(a.anticipo_aplicado_usd_bcv,0) - x.usd)::numeric, 2)),
      anticipo_aplicado_usd = GREATEST(0, ROUND((COALESCE(a.anticipo_aplicado_usd,0) - x.usd)::numeric, 2)),
      anticipo_estado = CASE
        WHEN COALESCE(a.anticipo_usd_bcv,0) > 0
             AND GREATEST(0, COALESCE(a.anticipo_aplicado_usd_bcv,0) - x.usd) >= COALESCE(a.anticipo_usd_bcv,0) - 0.005 THEN 'aplicado'
        WHEN GREATEST(0, COALESCE(a.anticipo_aplicado_usd_bcv,0) - x.usd) > 0.005 THEN 'parcialmente_aplicado'
        ELSE 'abierto' END
  FROM (
    SELECT r.grupo_transaccion_id AS grupo,
           SUM(ABS(CASE WHEN COALESCE(r.tasa_bcv,0) > 0 THEN r.monto_bs / r.tasa_bcv ELSE r.monto_usd END)) AS usd
    FROM public.transacciones r
    WHERE r.import_batch_id = p_batch
      AND r.cuenta_codigo = '14.2' AND r.monto_bs < 0
      AND r.grupo_transaccion_id IS NOT NULL
    GROUP BY r.grupo_transaccion_id
  ) x
  WHERE a.cuenta_codigo = '14.2'
    AND a.monto_bs > 0
    AND a.grupo_transaccion_id = x.grupo
    AND (a.import_batch_id IS DISTINCT FROM p_batch);

  -- 3) Conciliaciones que apuntan a transacciones del lote
  WITH d AS (
    DELETE FROM public.conciliacion_bancaria cb
    WHERE cb.transaccion_bancaria_id = ANY(v_tx) OR cb.transaccion_factura_id = ANY(v_tx)
    RETURNING 1
  ) SELECT count(*) INTO n_conc FROM d;

  -- 4) Desligar referencias externas hacia estas transacciones
  UPDATE public.transacciones SET pareja_off_balance_id = NULL WHERE pareja_off_balance_id = ANY(v_tx);
  UPDATE public.cuentas_por_cobrar SET transaccion_cobro_id = NULL WHERE transaccion_cobro_id = ANY(v_tx);
  UPDATE public.cuentas_por_cobrar SET transaccion_id = NULL WHERE transaccion_id = ANY(v_tx);
  UPDATE public.cuentas_por_pagar SET transaccion_id = NULL WHERE transaccion_id = ANY(v_tx);
  UPDATE public.propinas SET transaccion_id = NULL WHERE transaccion_id = ANY(v_tx);
  UPDATE public.propinas SET transaccion_entrada_id = NULL WHERE transaccion_entrada_id = ANY(v_tx);
  UPDATE public.propinas SET transaccion_salida_id = NULL WHERE transaccion_salida_id = ANY(v_tx);
  UPDATE public.prestamos SET transaccion_id = NULL WHERE transaccion_id = ANY(v_tx);

  -- 5) Borrar filas derivadas
  WITH d AS (DELETE FROM public.cuentas_por_cobrar WHERE import_batch_id = p_batch RETURNING 1)
  SELECT count(*) INTO n_cxc FROM d;
  WITH d AS (DELETE FROM public.propinas WHERE import_batch_id = p_batch RETURNING 1)
  SELECT count(*) INTO n_prop FROM d;
  WITH d AS (DELETE FROM public.cuentas_por_pagar WHERE import_batch_id = p_batch RETURNING 1)
  SELECT count(*) INTO n_cxp FROM d;
  WITH d AS (DELETE FROM public.transacciones WHERE import_batch_id = p_batch RETURNING 1)
  SELECT count(*) INTO n_tx FROM d;

  RETURN jsonb_build_object('transacciones', n_tx, 'cxp', n_cxp, 'cxc', n_cxc,
                            'propinas', n_prop, 'conciliaciones', n_conc, 'cxp_restauradas', n_rest);
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_filas_importacion(uuid) FROM PUBLIC, anon, authenticated;

-- Reversión completa de una carga (atómica)
CREATE OR REPLACE FUNCTION public.revertir_importacion(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_estado text;
  v_res jsonb;
  v_restos int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede revertir importaciones';
  END IF;

  SELECT estado INTO v_estado FROM public.importaciones WHERE id = p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Carga no encontrada'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.transacciones t
    WHERE t.import_batch_id = p_batch AND public.periodo_cerrado(t.fecha)
  ) THEN
    RAISE EXCEPTION 'Hay transacciones en un mes cerrado. Reabre el mes primero.';
  END IF;

  v_res := public.purgar_filas_importacion(p_batch);

  SELECT (SELECT count(*) FROM public.transacciones WHERE import_batch_id = p_batch)
       + (SELECT count(*) FROM public.cuentas_por_pagar WHERE import_batch_id = p_batch)
       + (SELECT count(*) FROM public.cuentas_por_cobrar WHERE import_batch_id = p_batch)
       + (SELECT count(*) FROM public.propinas WHERE import_batch_id = p_batch)
  INTO v_restos;

  IF v_restos > 0 THEN
    RAISE EXCEPTION 'Quedaron % filas sin borrar; se cancela la reversión', v_restos;
  END IF;

  UPDATE public.importaciones
  SET estado = 'revertida', reverted_at = now(), reverted_by = auth.uid()
  WHERE id = p_batch;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.revertir_importacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_importacion(uuid) TO authenticated;

-- Borrado definitivo de las cargas ya revertidas
CREATE OR REPLACE FUNCTION public.purgar_importaciones_revertidas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  b record;
  v_res jsonb;
  n_batches int := 0; n_tx int := 0; n_cxp int := 0; n_cxc int := 0; n_prop int := 0; n_conc int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar cargas revertidas';
  END IF;

  FOR b IN SELECT id FROM public.importaciones WHERE estado = 'revertida' LOOP
    v_res := public.purgar_filas_importacion(b.id);
    n_tx := n_tx + (v_res->>'transacciones')::int;
    n_cxp := n_cxp + (v_res->>'cxp')::int;
    n_cxc := n_cxc + (v_res->>'cxc')::int;
    n_prop := n_prop + (v_res->>'propinas')::int;
    n_conc := n_conc + (v_res->>'conciliaciones')::int;
    DELETE FROM public.importaciones WHERE id = b.id;
    n_batches := n_batches + 1;
  END LOOP;

  RETURN jsonb_build_object('cargas', n_batches, 'transacciones', n_tx, 'cxp', n_cxp,
                            'cxc', n_cxc, 'propinas', n_prop, 'conciliaciones', n_conc);
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_importaciones_revertidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purgar_importaciones_revertidas() TO authenticated;