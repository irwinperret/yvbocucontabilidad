
CREATE TABLE IF NOT EXISTS public._recalc_bcv_backup_20260618 (
  id uuid PRIMARY KEY,
  cuenta_codigo text,
  fecha date,
  monto_bs numeric,
  monto_usd_anterior numeric,
  tasa_bcv numeric,
  tasa_paralela numeric,
  monto_usd_nuevo numeric,
  anticipo_aplicado_usd_anterior numeric,
  anticipo_aplicado_usd_nuevo numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public._recalc_bcv_backup_20260618
  (id, cuenta_codigo, fecha, monto_bs, monto_usd_anterior, tasa_bcv, tasa_paralela, monto_usd_nuevo, anticipo_aplicado_usd_anterior, anticipo_aplicado_usd_nuevo)
SELECT
  t.id, t.cuenta_codigo, t.fecha, t.monto_bs, t.monto_usd, t.tasa_bcv, t.tasa_paralela,
  CASE WHEN t.tasa_bcv IS NOT NULL AND t.tasa_bcv > 0
       THEN round((t.monto_bs / t.tasa_bcv)::numeric, 2)
       ELSE t.monto_usd END,
  t.anticipo_aplicado_usd,
  CASE
    WHEN t.cuenta_codigo = '14.2'
         AND t.tasa_bcv IS NOT NULL AND t.tasa_bcv > 0
         AND t.monto_usd IS NOT NULL AND t.monto_usd <> 0
         AND COALESCE(t.anticipo_aplicado_usd, 0) > 0
    THEN round(
           (COALESCE(t.anticipo_aplicado_usd, 0)
             * (round((t.monto_bs / t.tasa_bcv)::numeric, 2) / NULLIF(t.monto_usd, 0))
           )::numeric, 2)
    ELSE COALESCE(t.anticipo_aplicado_usd, 0)
  END
FROM public.transacciones t
WHERE t.cuenta_codigo NOT LIKE '1.%'
ON CONFLICT (id) DO NOTHING;

UPDATE public.transacciones t
SET monto_usd = round((t.monto_bs / t.tasa_bcv)::numeric, 2)
WHERE t.cuenta_codigo NOT LIKE '1.%'
  AND t.tasa_bcv IS NOT NULL AND t.tasa_bcv > 0;

UPDATE public.transacciones t
SET anticipo_aplicado_usd = b.anticipo_aplicado_usd_nuevo,
    anticipo_estado = CASE
        WHEN b.anticipo_aplicado_usd_nuevo >= b.monto_usd_nuevo - 0.005 THEN 'aplicado'
        WHEN b.anticipo_aplicado_usd_nuevo > 0.005 THEN 'parcialmente_aplicado'
        ELSE 'abierto'
      END
FROM public._recalc_bcv_backup_20260618 b
WHERE t.id = b.id
  AND t.cuenta_codigo = '14.2'
  AND t.monto_usd > 0
  AND COALESCE(b.anticipo_aplicado_usd_anterior, 0) > 0;

UPDATE public.cuentas_por_pagar c
SET monto_usd = round((c.monto_bs / NULLIF(t.tasa_bcv, 0))::numeric, 2)
FROM public.transacciones t
WHERE c.transaccion_id = t.id
  AND t.tasa_bcv IS NOT NULL AND t.tasa_bcv > 0;

CREATE OR REPLACE FUNCTION public.aplicar_anticipo_a_factura(
  anticipo_id uuid,
  aplicar_usd numeric,
  grupo_id uuid,
  factura_fecha date,
  factura_proveedor text,
  factura_numero text,
  centro centro_costo
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_anticipo public.transacciones%ROWTYPE;
  v_aplicar numeric := round(COALESCE(aplicar_usd, 0)::numeric, 2);
  v_aplicado_actual numeric;
  v_saldo numeric;
  v_nuevo_aplicado numeric;
  v_nuevo_estado text;
  v_tasa_anticipo numeric;
  v_tasa_factura numeric;
  v_reverso_bs numeric;
  v_reverso_id uuid;
  v_diferencial_usd numeric;
  v_diferencial_bs numeric;
  v_diff_cuenta text;
  v_diff_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  IF v_aplicar <= 0 THEN RAISE EXCEPTION 'Monto a aplicar inválido'; END IF;

  SELECT * INTO v_anticipo FROM public.transacciones
   WHERE id = anticipo_id AND cuenta_codigo = '14.2' AND monto_usd > 0
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anticipo no encontrado'; END IF;
  IF COALESCE(v_anticipo.anticipo_estado, 'abierto') = 'aplicado' THEN
    RAISE EXCEPTION 'El anticipo ya está aplicado';
  END IF;

  v_aplicado_actual := COALESCE(v_anticipo.anticipo_aplicado_usd, 0);
  v_saldo := round((COALESCE(v_anticipo.monto_usd, 0) - v_aplicado_actual)::numeric, 2);
  IF v_aplicar > v_saldo + 0.005 THEN
    RAISE EXCEPTION 'El monto aplicado excede el saldo del anticipo';
  END IF;

  v_tasa_anticipo := v_anticipo.tasa_bcv;
  IF v_tasa_anticipo IS NULL OR v_tasa_anticipo <= 0 THEN
    RAISE EXCEPTION 'El anticipo no tiene tasa BCV válida';
  END IF;

  SELECT tasa INTO v_tasa_factura FROM public.tasas_bcv
   WHERE fecha <= factura_fecha ORDER BY fecha DESC LIMIT 1;
  IF v_tasa_factura IS NULL OR v_tasa_factura <= 0 THEN
    v_tasa_factura := v_tasa_anticipo;
  END IF;

  v_reverso_bs := round(v_aplicar * v_tasa_factura, 2);
  v_nuevo_aplicado := round(v_aplicado_actual + v_aplicar, 2);
  v_nuevo_estado := CASE
    WHEN v_nuevo_aplicado >= COALESCE(v_anticipo.monto_usd, 0) - 0.005 THEN 'aplicado'
    WHEN v_nuevo_aplicado > 0.005 THEN 'parcialmente_aplicado'
    ELSE 'abierto'
  END;

  INSERT INTO public.transacciones (
    fecha, cuenta_codigo, centro_costo, monto_bs, monto_base_bs, iva_bs, iva_aplica,
    tasa_bcv, tasa_paralela, monto_usd, metodo_pago, modo,
    tercero_id, cuenta_bancaria_id, notas, grupo_transaccion_id, created_by
  ) VALUES (
    factura_fecha, '14.2', centro,
    -v_reverso_bs, -v_reverso_bs, 0, false,
    v_tasa_factura, NULL, -v_aplicar,
    'transferencia', COALESCE(v_anticipo.modo, 'on_balance'),
    v_anticipo.tercero_id, v_anticipo.cuenta_bancaria_id,
    trim('Aplicación de anticipo a factura ' || COALESCE(factura_numero, '') || ' — ' || COALESCE(factura_proveedor, 'Proveedor')),
    grupo_id, auth.uid()
  ) RETURNING id INTO v_reverso_id;

  UPDATE public.transacciones
  SET anticipo_aplicado_usd = v_nuevo_aplicado,
      anticipo_estado = v_nuevo_estado
  WHERE id = v_anticipo.id;

  v_diferencial_bs := round(v_aplicar * (v_tasa_factura - v_tasa_anticipo), 2);
  v_diferencial_usd := round((v_diferencial_bs / NULLIF(v_tasa_factura, 0))::numeric, 2);

  IF abs(COALESCE(v_diferencial_usd, 0)) > 0.01 THEN
    v_diff_cuenta := CASE WHEN v_diferencial_usd > 0 THEN '11.1' ELSE '11.2' END;
    INSERT INTO public.transacciones (
      fecha, cuenta_codigo, centro_costo, monto_bs, monto_base_bs, iva_bs, iva_aplica,
      tasa_bcv, tasa_paralela, monto_usd, metodo_pago, modo,
      tercero_id, notas, grupo_transaccion_id, created_by
    ) VALUES (
      factura_fecha, v_diff_cuenta, centro,
      abs(v_diferencial_bs), abs(v_diferencial_bs), 0, false,
      v_tasa_factura, NULL, abs(v_diferencial_usd),
      'transferencia', COALESCE(v_anticipo.modo, 'on_balance'),
      v_anticipo.tercero_id,
      'Diferencial cambiario por aplicación de anticipo (' ||
        CASE WHEN v_diferencial_usd > 0 THEN 'ganancia' ELSE 'pérdida' END ||
        ') — factura ' || COALESCE(factura_numero, ''),
      grupo_id, auth.uid()
    ) RETURNING id INTO v_diff_id;
  END IF;

  RETURN jsonb_build_object(
    'reverso_id', v_reverso_id,
    'nuevo_aplicado_usd', v_nuevo_aplicado,
    'nuevo_estado', v_nuevo_estado,
    'diferencial_usd', COALESCE(v_diferencial_usd, 0),
    'diferencial_id', v_diff_id
  );
END;
$function$;
