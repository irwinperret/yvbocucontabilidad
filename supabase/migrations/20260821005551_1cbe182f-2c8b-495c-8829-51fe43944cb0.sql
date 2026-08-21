CREATE OR REPLACE FUNCTION public.purgar_transacciones_huerfanas(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx uuid[];
  v_grupos uuid[];
  n_tx int := 0; n_conc int := 0; n_rest int := 0; n_cxp int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar residuos de importaciones';
  END IF;

  -- Solo transacciones sin lote, de origen importado y fuera de meses cerrados
  SELECT COALESCE(array_agg(t.id), '{}') INTO v_tx
  FROM public.transacciones t
  WHERE t.id = ANY(p_ids)
    AND t.import_batch_id IS NULL
    AND COALESCE(t.standby, false) = false
    AND (t.referencia LIKE 'BANK:%' OR t.referencia LIKE 'PAREO:%' OR t.referencia = 'xetux')
    AND NOT public.periodo_cerrado(t.fecha);

  IF array_length(v_tx, 1) IS NULL THEN
    RETURN jsonb_build_object('transacciones', 0, 'conciliaciones', 0, 'cxp_restauradas', 0, 'cxp', 0);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT grupo_transaccion_id), '{}') INTO v_grupos
  FROM public.transacciones
  WHERE id = ANY(v_tx) AND grupo_transaccion_id IS NOT NULL;

  -- Diferenciales cambiarios del mismo grupo
  DELETE FROM public.transacciones t
  WHERE t.cuenta_codigo IN ('7.2', '11.1')
    AND t.grupo_transaccion_id IS NOT NULL
    AND t.grupo_transaccion_id = ANY(v_grupos)
    AND NOT (t.id = ANY(v_tx));

  -- Conciliaciones que apuntan a estas transacciones
  WITH d AS (
    DELETE FROM public.conciliacion_bancaria cb
    WHERE cb.transaccion_bancaria_id = ANY(v_tx)
       OR cb.transaccion_factura_id = ANY(v_tx)
    RETURNING 1
  ) SELECT count(*) INTO n_conc FROM d;

  -- Restaurar CxP pagadas por estas transacciones (mismo grupo)
  WITH r AS (
    UPDATE public.cuentas_por_pagar c
    SET estado = 'pendiente',
        monto_pendiente_bs = c.monto_bs,
        monto_pendiente_usd_bcv = c.usd_bcv_factura,
        pagada_at = NULL
    WHERE c.transaccion_id IS NOT NULL
      AND c.import_batch_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.conciliacion_bancaria cb
        WHERE cb.transaccion_bancaria_id = ANY(v_tx)
          AND cb.transaccion_factura_id = c.transaccion_id
      )
    RETURNING 1
  ) SELECT count(*) INTO n_rest FROM r;

  -- CxP creadas por estas transacciones
  WITH d AS (
    DELETE FROM public.cuentas_por_pagar c
    WHERE c.transaccion_id = ANY(v_tx)
    RETURNING 1
  ) SELECT count(*) INTO n_cxp FROM d;

  DELETE FROM public.cuentas_por_cobrar WHERE transaccion_id = ANY(v_tx) OR transaccion_cobro_id = ANY(v_tx);
  DELETE FROM public.propinas WHERE transaccion_id = ANY(v_tx) OR transaccion_entrada_id = ANY(v_tx) OR transaccion_salida_id = ANY(v_tx);

  WITH d AS (
    DELETE FROM public.transacciones WHERE id = ANY(v_tx) RETURNING 1
  ) SELECT count(*) INTO n_tx FROM d;

  RETURN jsonb_build_object('transacciones', n_tx, 'conciliaciones', n_conc, 'cxp_restauradas', n_rest, 'cxp', n_cxp);
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_transacciones_huerfanas(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purgar_transacciones_huerfanas(uuid[]) TO authenticated;