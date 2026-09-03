-- Regla permanente: cualquier transacción cuyo detalle, notas o referencia
-- mencione "Terrasouls" (o variantes como "Terra Souls", "Terrasoul") se
-- asigna automáticamente al proveedor EMPRENDIMIENTO ALEXANDRA RAMAK,
-- siempre que la transacción no tenga ya un proveedor asignado.
CREATE OR REPLACE FUNCTION public.auto_asignar_proveedor_por_memo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tercero_id uuid;
BEGIN
  IF NEW.tercero_id IS NULL AND (
    NEW.detalle ~* 'terra\s*soul'
    OR NEW.notas ~* 'terra\s*soul'
    OR NEW.referencia ~* 'terra\s*soul'
  ) THEN
    SELECT id INTO v_tercero_id
    FROM public.terceros
    WHERE razon_social ILIKE '%ALEXANDRA RAMAK%'
    LIMIT 1;

    IF v_tercero_id IS NOT NULL THEN
      NEW.tercero_id := v_tercero_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_asignar_proveedor_por_memo ON public.transacciones;
CREATE TRIGGER trg_auto_asignar_proveedor_por_memo
  BEFORE INSERT OR UPDATE ON public.transacciones
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_asignar_proveedor_por_memo();
