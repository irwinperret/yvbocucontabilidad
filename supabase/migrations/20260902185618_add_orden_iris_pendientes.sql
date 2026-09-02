ALTER TABLE public.iris_pendientes
  ADD COLUMN IF NOT EXISTS orden integer;

-- Backfill: reproduce el orden actual (más reciente primero) como punto de partida.
WITH numerado AS (
  SELECT id, row_number() OVER (ORDER BY created_at DESC) AS rn
  FROM public.iris_pendientes
  WHERE orden IS NULL
)
UPDATE public.iris_pendientes p
SET orden = numerado.rn
FROM numerado
WHERE p.id = numerado.id;
