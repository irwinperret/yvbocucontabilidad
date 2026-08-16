CREATE OR REPLACE FUNCTION public.purgar_filas_importacion(p_batch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx uuid[];
  v_grupos uuid[];
  n_tx int := 0; n_cxp int := 0; n_cxc int := 0; n_prop int := 0; n_conc int := 0; n_rest int := 0; n_dif int := 0;
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_tx
  FROM public.transacciones WHERE import_batch_id = p_batch;

  SELECT COALESCE(array_agg(DISTINCT grupo_transaccion_id), '{}') INTO v_grupos
  FROM public.transacciones
  WHERE import_batch_id = p_batch AND grupo_transaccion_id IS NOT NULL;

  -- 0) Diferenciales cambiarios (7.2 / 11.1) generados por este lote:
  --    tanto los marcados con el lote como los que comparten grupo con él.
  WITH d AS (
    DELETE FROM public.transacciones t
    WHERE t.cuenta_codigo IN ('7.2', '11.1')
      AND (
        t.import_batch_id = p_batch
        OR (t.grupo_transaccion_id IS NOT NULL AND t.grupo_transaccion_id = ANY(v_grupos))
      )
    RETURNING 1
  ) SELECT count(*) INTO n_dif FROM d;

  -- refrescar la lista de transacciones del lote tras el paso anterior
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

  RETURN jsonb_build_object('transacciones', n_tx + n_dif, 'diferenciales', n_dif, 'cxp', n_cxp, 'cxc', n_cxc,
                            'propinas', n_prop, 'conciliaciones', n_conc, 'cxp_restauradas', n_rest);
END;
$function$;

CREATE OR REPLACE FUNCTION public.purgar_todo_importado()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx int; v_cxp int; v_cxc int; v_prop int; v_conc int; v_imp int; v_dif int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  CREATE TEMP TABLE _purge_tx ON COMMIT DROP AS
  SELECT id, grupo_transaccion_id FROM public.transacciones
  WHERE import_batch_id IS NOT NULL
     OR referencia ILIKE 'BANK:%'
     OR referencia ILIKE 'PAREO:%'
     OR lower(coalesce(referencia,'')) = 'xetux';

  DELETE FROM public.conciliacion_bancaria WHERE true;
  GET DIAGNOSTICS v_conc = ROW_COUNT;

  -- Diferenciales cambiarios ligados a los grupos importados
  DELETE FROM public.transacciones t
  WHERE t.cuenta_codigo IN ('7.2', '11.1')
    AND (
      t.import_batch_id IS NOT NULL
      OR (t.grupo_transaccion_id IS NOT NULL
          AND t.grupo_transaccion_id IN (SELECT grupo_transaccion_id FROM _purge_tx WHERE grupo_transaccion_id IS NOT NULL))
    );
  GET DIAGNOSTICS v_dif = ROW_COUNT;

  DELETE FROM public.propinas p
  WHERE p.import_batch_id IS NOT NULL
     OR p.transaccion_id IN (SELECT id FROM _purge_tx)
     OR p.transaccion_entrada_id IN (SELECT id FROM _purge_tx)
     OR p.transaccion_salida_id IN (SELECT id FROM _purge_tx);
  GET DIAGNOSTICS v_prop = ROW_COUNT;

  DELETE FROM public.cuentas_por_cobrar c
  WHERE c.import_batch_id IS NOT NULL
     OR c.transaccion_id IN (SELECT id FROM _purge_tx)
     OR c.transaccion_cobro_id IN (SELECT id FROM _purge_tx);
  GET DIAGNOSTICS v_cxc = ROW_COUNT;

  DELETE FROM public.cuentas_por_pagar c
  WHERE c.import_batch_id IS NOT NULL
     OR c.revert_batch_id IS NOT NULL
     OR c.transaccion_id IN (SELECT id FROM _purge_tx);
  GET DIAGNOSTICS v_cxp = ROW_COUNT;

  UPDATE public.transacciones
  SET pareja_off_balance_id = NULL
  WHERE pareja_off_balance_id IN (SELECT id FROM _purge_tx);

  DELETE FROM public.transacciones t WHERE t.id IN (SELECT id FROM _purge_tx);
  GET DIAGNOSTICS v_tx = ROW_COUNT;

  DELETE FROM public.importaciones WHERE true;
  GET DIAGNOSTICS v_imp = ROW_COUNT;

  RETURN jsonb_build_object(
    'transacciones', v_tx + v_dif,
    'diferenciales', v_dif,
    'cuentas_por_pagar', v_cxp,
    'cuentas_por_cobrar', v_cxc,
    'propinas', v_prop,
    'conciliaciones', v_conc,
    'importaciones', v_imp
  );
END;
$function$;