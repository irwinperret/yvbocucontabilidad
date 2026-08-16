CREATE OR REPLACE FUNCTION public.purgar_todo_importado()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx int; v_cxp int; v_cxc int; v_prop int; v_conc int; v_imp int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  CREATE TEMP TABLE _purge_tx ON COMMIT DROP AS
  SELECT id FROM public.transacciones
  WHERE import_batch_id IS NOT NULL
     OR referencia ILIKE 'BANK:%'
     OR referencia ILIKE 'PAREO:%'
     OR lower(coalesce(referencia,'')) = 'xetux';

  DELETE FROM public.conciliacion_bancaria;
  GET DIAGNOSTICS v_conc = ROW_COUNT;

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

  DELETE FROM public.importaciones;
  GET DIAGNOSTICS v_imp = ROW_COUNT;

  RETURN jsonb_build_object(
    'transacciones', v_tx,
    'cuentas_por_pagar', v_cxp,
    'cuentas_por_cobrar', v_cxc,
    'propinas', v_prop,
    'conciliaciones', v_conc,
    'importaciones', v_imp
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_todo_importado() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.purgar_todo_importado() TO authenticated;