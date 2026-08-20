DELETE FROM public.transacciones
WHERE numero IN (92080,92081,92082,92083,92084,92085,92086);

UPDATE public.transacciones
SET referencia = split_part(referencia,'|',1)||'|'||split_part(referencia,'|',2)||'|'||regexp_replace(upper(split_part(referencia,'|',3)),'^0+','')||'|'||split_part(referencia,'|',4)
WHERE referencia LIKE 'BANK:%'
  AND split_part(referencia,'|',3) ~ '^0+[0-9A-Za-z]';