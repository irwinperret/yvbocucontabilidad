CREATE OR REPLACE FUNCTION public.aplicar_anticipo_a_factura(
  anticipo_id uuid,
  aplicar_usd numeric,
  grupo_id uuid,
  factura_fecha date,
  factura_proveedor text,
  factura_numero text,
  centro centro_costo
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anticipo public.transacciones%ROWTYPE;
  v_aplicar numeric := round(COALESCE(aplicar_usd, 0)::numeric, 2);
  v_aplicado_actual numeric;
  v_saldo numeric;
  v_nuevo_aplicado numeric;
  v_nuevo_estado text;
  v_tasa numeric;
  v_reverso_bs numeric;
  v_reverso_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_aplicar <= 0 THEN
    RAISE EXCEPTION 'Monto a aplicar inválido';
  END IF;

  SELECT * INTO v_anticipo
  FROM public.transacciones
  WHERE id = anticipo_id
    AND cuenta_codigo = '14.2'
    AND monto_usd > 0
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anticipo no encontrado';
  END IF;

  IF COALESCE(v_anticipo.anticipo_estado, 'abierto') = 'aplicado' THEN
    RAISE EXCEPTION 'El anticipo ya está aplicado';
  END IF;

  v_aplicado_actual := COALESCE(v_anticipo.anticipo_aplicado_usd, 0);
  v_saldo := round((COALESCE(v_anticipo.monto_usd, 0) - v_aplicado_actual)::numeric, 2);

  IF v_aplicar > v_saldo + 0.005 THEN
    RAISE EXCEPTION 'El monto aplicado excede el saldo del anticipo';
  END IF;

  v_tasa := COALESCE(v_anticipo.tasa_paralela, v_anticipo.tasa_bcv);
  IF v_tasa IS NULL OR v_tasa <= 0 THEN
    RAISE EXCEPTION 'El anticipo no tiene tasa válida';
  END IF;

  v_reverso_bs := round(v_aplicar * v_tasa, 2);
  v_nuevo_aplicado := round(v_aplicado_actual + v_aplicar, 2);
  v_nuevo_estado := CASE
    WHEN v_nuevo_aplicado >= COALESCE(v_anticipo.monto_usd, 0) - 0.005 THEN 'aplicado'
    WHEN v_nuevo_aplicado > 0.005 THEN 'parcialmente_aplicado'
    ELSE 'abierto'
  END;

  INSERT INTO public.transacciones (
    fecha,
    cuenta_codigo,
    centro_costo,
    monto_bs,
    monto_base_bs,
    iva_bs,
    iva_aplica,
    tasa_bcv,
    tasa_paralela,
    monto_usd,
    metodo_pago,
    modo,
    tercero_id,
    cuenta_bancaria_id,
    notas,
    grupo_transaccion_id,
    created_by
  ) VALUES (
    factura_fecha,
    '14.2',
    centro,
    -v_reverso_bs,
    -v_reverso_bs,
    0,
    false,
    v_anticipo.tasa_bcv,
    v_anticipo.tasa_paralela,
    -v_aplicar,
    'transferencia',
    COALESCE(v_anticipo.modo, 'on_balance'),
    v_anticipo.tercero_id,
    v_anticipo.cuenta_bancaria_id,
    trim('Aplicación de anticipo a factura ' || COALESCE(factura_numero, '') || ' — ' || COALESCE(factura_proveedor, 'Proveedor')),
    grupo_id,
    auth.uid()
  ) RETURNING id INTO v_reverso_id;

  UPDATE public.transacciones
  SET anticipo_aplicado_usd = v_nuevo_aplicado,
      anticipo_estado = v_nuevo_estado::anticipo_estado
  WHERE id = v_anticipo.id;

  RETURN jsonb_build_object(
    'reverso_id', v_reverso_id,
    'nuevo_aplicado_usd', v_nuevo_aplicado,
    'nuevo_estado', v_nuevo_estado
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_anticipo_a_factura(uuid, numeric, uuid, date, text, text, centro_costo) TO authenticated;