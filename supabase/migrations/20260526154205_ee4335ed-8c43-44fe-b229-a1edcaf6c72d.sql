
-- Limpiar registros existentes (preservar plan_de_cuentas, profiles, user_roles)
DELETE FROM public.cuentas_por_cobrar;
DELETE FROM public.cuentas_por_pagar;
DELETE FROM public.prestamos;
DELETE FROM public.transacciones;
DELETE FROM public.inventario_snapshots;
DELETE FROM public.cierres_de_mes;
DELETE FROM public.tasas_bcv;
DELETE FROM public.terceros;
DELETE FROM public.auditoria;

-- Campos IVA en transacciones
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS iva_aplica boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monto_base_bs numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_bs numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tipo_iva text CHECK (tipo_iva IN ('debito_fiscal','credito_fiscal')),
  ADD COLUMN IF NOT EXISTS numero_factura text;

-- Backfill: si no aplica IVA, base = monto_bs
UPDATE public.transacciones SET monto_base_bs = monto_bs WHERE monto_base_bs = 0;

-- Estado del cierre de mes para regla de inmutabilidad
ALTER TABLE public.cierres_de_mes
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'cerrado';

-- CxP: campos extras necesarios
ALTER TABLE public.cuentas_por_pagar
  ADD COLUMN IF NOT EXISTS proveedor text,
  ADD COLUMN IF NOT EXISTS numero_factura text,
  ADD COLUMN IF NOT EXISTS monto_pendiente_bs numeric,
  ADD COLUMN IF NOT EXISTS centro_costo centro_costo;

-- Auditoría: datos_antes / datos_despues
ALTER TABLE public.auditoria
  ADD COLUMN IF NOT EXISTS datos_antes jsonb,
  ADD COLUMN IF NOT EXISTS datos_despues jsonb;

-- Vista IVA mensual
CREATE OR REPLACE VIEW public.v_iva_mensual
WITH (security_invoker = true) AS
SELECT
  to_char(fecha, 'YYYY-MM') AS periodo,
  tipo_iva,
  SUM(iva_bs) AS iva_bs,
  SUM(iva_bs / NULLIF(tasa_bcv,0)) AS iva_usd,
  COUNT(*) AS movimientos
FROM public.transacciones
WHERE iva_aplica = true AND modo = 'on_balance'
GROUP BY 1, 2;

-- Vista resumen mensual por cuenta (para reportes multi-período)
CREATE OR REPLACE VIEW public.v_transacciones_mensual
WITH (security_invoker = true) AS
SELECT
  to_char(t.fecha, 'YYYY-MM') AS periodo,
  EXTRACT(YEAR FROM t.fecha)::int AS anio,
  EXTRACT(MONTH FROM t.fecha)::int AS mes,
  t.cuenta_codigo,
  t.centro_costo,
  t.modo,
  SUM(t.monto_base_bs) AS base_bs,
  SUM(t.iva_bs) AS iva_bs,
  SUM(t.monto_bs) AS total_bs,
  SUM(t.monto_base_bs / NULLIF(t.tasa_bcv,0)) AS base_usd,
  SUM(t.monto_bs / NULLIF(t.tasa_bcv,0)) AS total_usd,
  COUNT(*) AS movimientos
FROM public.transacciones t
GROUP BY 1,2,3,4,5,6;

-- Función de auditoría genérica
CREATE OR REPLACE FUNCTION public.registrar_auditoria(
  _tabla text, _accion text, _registro_id uuid, _antes jsonb, _despues jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.auditoria (tabla, accion, registro_id, user_id, datos_antes, datos_despues, datos)
  VALUES (_tabla, _accion, _registro_id, auth.uid(), _antes, _despues, COALESCE(_despues, _antes));
END;
$$;

-- Función para verificar si un período está cerrado
CREATE OR REPLACE FUNCTION public.periodo_cerrado(_fecha date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.cierres_de_mes
    WHERE periodo = to_char(_fecha, 'YYYY-MM') AND estado = 'cerrado'
  );
$$;

GRANT EXECUTE ON FUNCTION public.registrar_auditoria(text,text,uuid,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.periodo_cerrado(date) TO authenticated;
GRANT SELECT ON public.v_iva_mensual TO authenticated;
GRANT SELECT ON public.v_transacciones_mensual TO authenticated;
