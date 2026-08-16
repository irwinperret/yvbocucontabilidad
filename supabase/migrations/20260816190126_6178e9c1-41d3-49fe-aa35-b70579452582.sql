CREATE OR REPLACE FUNCTION public.enforce_anticipo_iva_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  invoice_iva_bs NUMERIC;
  invoice_monto_bs NUMERIC;
  grupo_iva_bs NUMERIC;
  anticipo_applied_bs NUMERIC;
  correct_remanente_bs NUMERIC;
BEGIN
  IF NEW.cuenta_codigo = '13.2' AND NEW.grupo_transaccion_id IS NOT NULL THEN
    -- Solo aplica cuando el grupo tiene un anticipo (14.2 negativo) aplicado.
    SELECT COALESCE(SUM(ABS(monto_bs)), 0) INTO anticipo_applied_bs
    FROM transacciones
    WHERE grupo_transaccion_id = NEW.grupo_transaccion_id
      AND cuenta_codigo = '14.2'
      AND monto_bs < 0
      AND standby IS NOT TRUE;

    IF COALESCE(anticipo_applied_bs, 0) <= 0 THEN
      -- Pago normal: no se toca el monto realmente pagado.
      IF COALESCE(NEW.iva_bs, 0) = 0 THEN
        NEW.iva_bs := 0;
        NEW.monto_base_bs := NEW.monto_bs;
      END IF;
      RETURN NEW;
    END IF;

    SELECT iva_bs, monto_bs INTO invoice_iva_bs, invoice_monto_bs
    FROM transacciones
    WHERE grupo_transaccion_id = NEW.grupo_transaccion_id
      AND cuenta_codigo NOT IN ('12.5', '14.2', '13.2')
      AND standby IS NOT TRUE
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT COALESCE(SUM(monto_bs), 0) INTO grupo_iva_bs
    FROM transacciones
    WHERE grupo_transaccion_id = NEW.grupo_transaccion_id
      AND cuenta_codigo = '12.5'
      AND standby IS NOT TRUE;

    IF invoice_iva_bs IS NOT NULL
       AND COALESCE(invoice_iva_bs, 0) = 0
       AND COALESCE(grupo_iva_bs, 0) = 0 THEN
      correct_remanente_bs := invoice_monto_bs - anticipo_applied_bs;

      NEW.iva_bs := 0;
      NEW.monto_bs := correct_remanente_bs;
      NEW.monto_base_bs := correct_remanente_bs;
      IF COALESCE(NEW.tasa_paralela, 0) > 0 THEN
        NEW.monto_usd := ROUND(correct_remanente_bs / NEW.tasa_paralela, 2);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;