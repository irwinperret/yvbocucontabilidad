
-- Account 13.1: Propinas por pagar al personal (transitory liability)
INSERT INTO public.plan_de_cuentas (codigo, nombre, grupo, afecta_gyp, afecta_fc, orden, activa, centros_permitidos)
VALUES ('13.1', 'Propinas por pagar al personal', 'Pasivos transitorios', false, true, 1310, true, ARRAY['YV','Bocu']::centro_costo[])
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  grupo = EXCLUDED.grupo,
  afecta_gyp = EXCLUDED.afecta_gyp,
  afecta_fc = EXCLUDED.afecta_fc,
  activa = true,
  centros_permitidos = EXCLUDED.centros_permitidos;

-- Propinas: link to entry/exit transactions and distribution metadata
ALTER TABLE public.propinas
  ADD COLUMN IF NOT EXISTS transaccion_entrada_id uuid REFERENCES public.transacciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transaccion_salida_id  uuid REFERENCES public.transacciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fecha_distribucion date,
  ADD COLUMN IF NOT EXISTS monto_distribuido_usd numeric,
  ADD COLUMN IF NOT EXISTS notas_distribucion text;
