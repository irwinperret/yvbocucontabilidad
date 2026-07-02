
CREATE SEQUENCE IF NOT EXISTS public.transacciones_numero_seq;
ALTER TABLE public.transacciones ADD COLUMN IF NOT EXISTS numero bigint;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.transacciones
  WHERE numero IS NULL
)
UPDATE public.transacciones t
SET numero = o.rn + COALESCE((SELECT MAX(numero) FROM public.transacciones), 0)
FROM ordered o WHERE t.id = o.id;

SELECT setval('public.transacciones_numero_seq', GREATEST(COALESCE((SELECT MAX(numero) FROM public.transacciones), 0), 1));

ALTER TABLE public.transacciones ALTER COLUMN numero SET DEFAULT nextval('public.transacciones_numero_seq');
ALTER TABLE public.transacciones ALTER COLUMN numero SET NOT NULL;
ALTER SEQUENCE public.transacciones_numero_seq OWNED BY public.transacciones.numero;
CREATE UNIQUE INDEX IF NOT EXISTS transacciones_numero_uq ON public.transacciones(numero);
