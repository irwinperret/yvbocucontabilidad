-- Borrado definitivo de UNA sola carga ya revertida (en vez de todas a la vez).
-- Reusa el mismo borrador atómico (purgar_filas_importacion) que ya usan
-- revertir_importacion y purgar_importaciones_revertidas.
CREATE OR REPLACE FUNCTION public.purgar_importacion_revertida(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_estado text;
  v_res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar cargas revertidas';
  END IF;

  SELECT estado INTO v_estado FROM public.importaciones WHERE id = p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Carga no encontrada'; END IF;
  IF v_estado IS DISTINCT FROM 'revertida' THEN
    RAISE EXCEPTION 'Solo se pueden borrar definitivamente cargas ya revertidas';
  END IF;

  v_res := public.purgar_filas_importacion(p_batch);
  DELETE FROM public.importaciones WHERE id = p_batch;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_importacion_revertida(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purgar_importacion_revertida(uuid) TO authenticated;
