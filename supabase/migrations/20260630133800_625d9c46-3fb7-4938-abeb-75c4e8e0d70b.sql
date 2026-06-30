CREATE OR REPLACE FUNCTION public.enforce_anticipo_proveedor_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tasa_bcv numeric;
  v_tasa_paralela numeric;
BEGIN
  IF NEW.cuenta_codigo IS DISTINCT FROM '14.2' THEN
    RETURN NEW;
  END IF;

  IF NEW.fecha IS NULL THEN
    NEW.fecha := CURRENT_DATE;
  END IF;

  SELECT tasa INTO v_tasa_bcv
  FROM public.tasas_bcv
  WHERE fecha <= NEW.fecha
  ORDER BY fecha DESC
  LIMIT 1;

  SELECT tasa INTO v_tasa_paralela
  FROM public.tasas_paralela
  WHERE fecha <= NEW.fecha
  ORDER BY fecha DESC
  LIMIT 1;

  IF COALESCE(v_tasa_bcv, 0) <= 0 THEN
    v_tasa_bcv := NULLIF(NEW.tasa_bcv, 0);
  END IF;

  IF COALESCE(v_tasa_paralela, 0) <= 0 THEN
    IF COALESCE(NEW.tasa_paralela, 0) > 0
       AND (v_tasa_bcv IS NULL OR abs(NEW.tasa_paralela - v_tasa_bcv) > 0.0001) THEN
      v_tasa_paralela := NEW.tasa_paralela;
    ELSE
      v_tasa_paralela := NULL;
    END IF;
  END IF;

  IF COALESCE(v_tasa_bcv, 0) > 0 THEN
    NEW.tasa_bcv := v_tasa_bcv;
    NEW.anticipo_usd_bcv := round((COALESCE(NEW.monto_bs, 0) / v_tasa_bcv)::numeric, 2);
  END IF;

  IF COALESCE(v_tasa_paralela, 0) > 0 THEN
    NEW.tasa_paralela := v_tasa_paralela;
    NEW.monto_usd := round((COALESCE(NEW.monto_bs, 0) / v_tasa_paralela)::numeric, 2);
  END IF;

  IF NEW.monto_base_bs IS NULL OR (COALESCE(NEW.iva_bs, 0) = 0 AND NEW.monto_base_bs = 0) THEN
    NEW.monto_base_bs := NEW.monto_bs;
  END IF;
  NEW.iva_bs := COALESCE(NEW.iva_bs, 0);
  NEW.iva_aplica := false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_anticipo_proveedor_currency_trg ON public.transacciones;
CREATE TRIGGER enforce_anticipo_proveedor_currency_trg
BEFORE INSERT OR UPDATE OF fecha, cuenta_codigo, monto_bs, tasa_bcv, tasa_paralela, monto_usd, anticipo_usd_bcv
ON public.transacciones
FOR EACH ROW
WHEN (NEW.cuenta_codigo = '14.2')
EXECUTE FUNCTION public.enforce_anticipo_proveedor_currency();