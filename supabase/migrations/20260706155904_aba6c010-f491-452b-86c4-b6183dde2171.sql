CREATE OR REPLACE FUNCTION public.aplicar_anticipo_a_factura(anticipo_id uuid, aplicar_usd_bcv numeric, grupo_id uuid, factura_fecha date, factura_proveedor text, factura_numero text, centro centro_costo)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anticipo public.transacciones%ROWTYPE;
  v_aplicar_bcv numeric := round(COALESCE(aplicar_usd_bcv, 0)::numeric, 2);
  v_aplicado_bcv_actual numeric;
  v_saldo_bcv numeric;
  v_nuevo_aplicado_bcv numeric;
  v_total_bcv numeric;
  v_nuevo_estado text;
  v_tasa_factura_bcv numeric;
  v_tasa_factura_par numeric;
  v_reverso_bs numeric;
  v_reverso_usd_bcv numeric;
  v_reverso_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  IF v_aplicar_bcv <= 0 THEN RAISE EXCEPTION 'Monto a aplicar inválido'; END IF;

  SELECT * INTO v_anticipo FROM public.transacciones
   WHERE id = anticipo_id AND cuenta_codigo = '14.2'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anticipo no encontrado'; END IF;
  IF COALESCE(v_anticipo.anticipo_estado, 'abierto') = 'aplicado' THEN
    RAISE EXCEPTION 'El anticipo ya está aplicado';
  END IF;

  v_total_bcv := COALESCE(v_anticipo.anticipo_usd_bcv,
    CASE WHEN COALESCE(v_anticipo.tasa_bcv,0) > 0 THEN round((v_anticipo.monto_bs / v_anticipo.tasa_bcv)::numeric, 2) ELSE v_anticipo.monto_usd END);
  v_aplicado_bcv_actual := COALESCE(v_anticipo.anticipo_aplicado_usd_bcv, 0);
  v_saldo_bcv := round((v_total_bcv - v_aplicado_bcv_actual)::numeric, 2);

  IF v_aplicar_bcv > v_saldo_bcv + 0.005 THEN
    RAISE EXCEPTION 'El monto aplicado excede el saldo del anticipo (USD BCV)';
  END IF;

  SELECT tasa INTO v_tasa_factura_bcv FROM public.tasas_bcv
   WHERE fecha <= factura_fecha ORDER BY fecha DESC LIMIT 1;
  IF v_tasa_factura_bcv IS NULL OR v_tasa_factura_bcv <= 0 THEN
    v_tasa_factura_bcv := v_anticipo.tasa_bcv;
  END IF;

  SELECT tasa INTO v_tasa_factura_par FROM public.tasas_paralela
   WHERE fecha <= factura_fecha ORDER BY fecha DESC LIMIT 1;

  v_reverso_bs := round(v_aplicar_bcv * v_tasa_factura_bcv, 2);
  -- FIX Bug 3: el reverso representa la cancelación de deuda en USD BCV,
  -- por lo tanto monto_usd = monto_bs / tasa_bcv (no tasa_paralela).
  v_reverso_usd_bcv := v_aplicar_bcv;

  v_nuevo_aplicado_bcv := round(v_aplicado_bcv_actual + v_aplicar_bcv, 2);
  v_nuevo_estado := CASE
    WHEN v_nuevo_aplicado_bcv >= v_total_bcv - 0.005 THEN 'aplicado'
    WHEN v_nuevo_aplicado_bcv > 0.005 THEN 'parcialmente_aplicado'
    ELSE 'abierto'
  END;

  INSERT INTO public.transacciones (
    fecha, cuenta_codigo, centro_costo, monto_bs, monto_base_bs, iva_bs, iva_aplica,
    tasa_bcv, tasa_paralela, monto_usd, metodo_pago, modo,
    tercero_id, cuenta_bancaria_id, notas, grupo_transaccion_id, created_by
  ) VALUES (
    factura_fecha, '14.2', centro,
    -v_reverso_bs, -v_reverso_bs, 0, false,
    v_tasa_factura_bcv, v_tasa_factura_par, -v_reverso_usd_bcv,
    'transferencia', COALESCE(v_anticipo.modo, 'on_balance'),
    v_anticipo.tercero_id, v_anticipo.cuenta_bancaria_id,
    trim('Aplicación de anticipo a factura ' || COALESCE(factura_numero, '') || ' — ' || COALESCE(factura_proveedor, 'Proveedor')),
    grupo_id, auth.uid()
  ) RETURNING id INTO v_reverso_id;

  -- FIX Bug 1: vincular el anticipo al grupo de la factura si aún no lo estaba.
  UPDATE public.transacciones
  SET anticipo_aplicado_usd_bcv = v_nuevo_aplicado_bcv,
      anticipo_aplicado_usd = v_nuevo_aplicado_bcv,
      anticipo_estado = v_nuevo_estado,
      grupo_transaccion_id = COALESCE(grupo_transaccion_id, grupo_id)
  WHERE id = v_anticipo.id;

  RETURN jsonb_build_object(
    'reverso_id', v_reverso_id,
    'reverso_bs', v_reverso_bs,
    'reverso_usd_bcv', v_reverso_usd_bcv,
    'aplicado_usd_bcv', v_nuevo_aplicado_bcv,
    'nuevo_estado', v_nuevo_estado
  );
END;
$function$;