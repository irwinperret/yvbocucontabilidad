CREATE OR REPLACE FUNCTION public.enforce_anticipo_iva_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  invoice_iva_bs NUMERIC;
  invoice_monto_bs NUMERIC;
  grupo_iva_bs NUMERIC;
  anticipo_applied_bs NUMERIC;
  correct_remanente_bs NUMERIC;
BEGIN
  -- La pierna 12.5 (IVA crédito) es válida por sí misma: en el modelo de
  -- registro dividido la factura principal siempre lleva iva_bs = 0 y el IVA
  -- vive en su propia fila. No se bloquea.

  IF NEW.cuenta_codigo = '13.2' AND NEW.grupo_transaccion_id IS NOT NULL THEN
    SELECT iva_bs, monto_bs INTO invoice_iva_bs, invoice_monto_bs
    FROM transacciones
    WHERE grupo_transaccion_id = NEW.grupo_transaccion_id
      AND cuenta_codigo NOT IN ('12.5', '14.2', '13.2')
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT COALESCE(SUM(monto_bs), 0) INTO grupo_iva_bs
    FROM transacciones
    WHERE grupo_transaccion_id = NEW.grupo_transaccion_id
      AND cuenta_codigo = '12.5';

    IF invoice_iva_bs IS NOT NULL
       AND COALESCE(invoice_iva_bs, 0) = 0
       AND COALESCE(grupo_iva_bs, 0) = 0 THEN
      SELECT COALESCE(SUM(ABS(monto_bs)), 0) INTO anticipo_applied_bs
      FROM transacciones
      WHERE grupo_transaccion_id = NEW.grupo_transaccion_id
        AND cuenta_codigo = '14.2'
        AND monto_bs < 0;

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
$$;