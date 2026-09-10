BEGIN;

-- 1) Marca de tipo en la tabla unificada
ALTER TABLE public.bono10_propina ADD COLUMN tipo text NOT NULL DEFAULT 'bono';
UPDATE public.bono10_propina SET tipo = 'propina' WHERE concepto ILIKE '%propina%' OR notas ILIKE '%propina%';
ALTER TABLE public.bono10_propina ADD CONSTRAINT bono10_propina_tipo_chk CHECK (tipo IN ('bono','propina'));

-- 2) Reescribir las funciones internas que nombraban las tablas viejas
DO $do$
DECLARE f RECORD; def text;
BEGIN
  FOR f IN
    SELECT proname, pg_get_functiondef(oid) AS d
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('purgar_filas_importacion','purgar_importaciones_revertidas','purgar_todo_importado','purgar_transacciones_huerfanas','revertir_importacion')
  LOOP
    def := regexp_replace(f.d, '\mpropinas\M', 'bono10_propina', 'g');
    def := regexp_replace(def, '\mbonos_10\M', 'bono10_propina', 'g');
    EXECUTE def;
  END LOOP;
END $do$;

COMMIT;