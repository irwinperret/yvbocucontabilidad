-- 1. Columna centros_permitidos (NULL = todos los centros)
ALTER TABLE public.plan_de_cuentas
  ADD COLUMN IF NOT EXISTS centros_permitidos centro_costo[];

-- 2. Poblar según patrones del nombre
UPDATE public.plan_de_cuentas SET centros_permitidos = NULL;

UPDATE public.plan_de_cuentas
SET centros_permitidos = ARRAY['YV_Market']::centro_costo[]
WHERE nombre ILIKE '%YV Market%';

UPDATE public.plan_de_cuentas
SET centros_permitidos = ARRAY['Bocu']::centro_costo[]
WHERE (nombre ILIKE '%Bocú%' OR nombre ILIKE '%Bocu%')
  AND centros_permitidos IS NULL;

UPDATE public.plan_de_cuentas
SET centros_permitidos = ARRAY['YV']::centro_costo[]
WHERE nombre ILIKE '%YV%'
  AND nombre NOT ILIKE '%YV Market%'
  AND centros_permitidos IS NULL;

-- 3. Renombrar cuentas de "Administración" a "Compartida" (asumimos compartido)
UPDATE public.plan_de_cuentas SET nombre = 'Nómina regular Compartida'              WHERE codigo = '3.1';
UPDATE public.plan_de_cuentas SET nombre = 'Provisión pasivos laborales Compartida' WHERE codigo = '3.2';
UPDATE public.plan_de_cuentas SET nombre = 'Liquidaciones Compartidas'              WHERE codigo = '3.3';