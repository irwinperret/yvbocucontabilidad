
INSERT INTO public.plan_de_cuentas (codigo, nombre, grupo, afecta_gyp, afecta_fc, activa, orden)
VALUES ('3.8', 'Bonos Trabajos Extra YV', 'Nomina', true, true, true, 38)
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, grupo = EXCLUDED.grupo, afecta_gyp = EXCLUDED.afecta_gyp, afecta_fc = EXCLUDED.afecta_fc, activa = EXCLUDED.activa, orden = EXCLUDED.orden;

UPDATE public.plan_de_cuentas SET afecta_fc = true WHERE codigo = '7.2';

UPDATE public.plan_de_cuentas SET activa = true, grupo = 'Otros' WHERE codigo = '11.2';
