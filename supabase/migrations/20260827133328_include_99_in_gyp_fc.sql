UPDATE public.plan_de_cuentas
SET afecta_gyp = true,
    afecta_fc = true
WHERE codigo = '99';
