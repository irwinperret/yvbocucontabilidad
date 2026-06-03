INSERT INTO public.plan_de_cuentas (codigo, nombre, grupo, centros_permitidos, afecta_gyp, afecta_fc, activa, orden)
VALUES
  ('1.6', 'Descuentos sobre ventas', 'Ingresos', ARRAY['YV','Bocu']::centro_costo[], true, true, true, 16),
  ('1.7', 'Devoluciones / Notas de crédito', 'Ingresos', ARRAY['YV','Bocu']::centro_costo[], true, true, true, 17)
ON CONFLICT (codigo) DO NOTHING;