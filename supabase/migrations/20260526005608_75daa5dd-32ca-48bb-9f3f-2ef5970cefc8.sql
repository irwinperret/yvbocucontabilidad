
-- ============================================
-- ENUMS
-- ============================================
CREATE TYPE public.app_role AS ENUM ('admin', 'contador', 'usuario');
CREATE TYPE public.centro_costo AS ENUM ('YV', 'Bocu', 'YV_Market', 'Administracion', 'Compartido');
CREATE TYPE public.modo_transaccion AS ENUM ('on_balance', 'off_balance');
CREATE TYPE public.tipo_rif AS ENUM ('J', 'V', 'E', 'G');
CREATE TYPE public.tipo_tercero AS ENUM ('cliente', 'proveedor', 'ambos');
CREATE TYPE public.metodo_pago AS ENUM ('tarjeta', 'transferencia', 'pago_movil', 'zelle', 'efectivo_usd', 'efectivo_bs', 'pendiente');

-- ============================================
-- PROFILES
-- ============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfiles_select_propio" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "perfiles_update_propio" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "perfiles_insert_propio" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============================================
-- USER ROLES
-- ============================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "user_roles_select_propio" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_manage" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- HANDLE NEW USER TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nombre)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nombre', NEW.email));
  -- primer usuario es admin, resto son usuarios
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'usuario');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- TASAS BCV
-- ============================================
CREATE TABLE public.tasas_bcv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL UNIQUE,
  tasa NUMERIC(18,6) NOT NULL CHECK (tasa > 0),
  registrado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasas_bcv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasas_bcv_select" ON public.tasas_bcv FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasas_bcv_insert" ON public.tasas_bcv FOR INSERT TO authenticated WITH CHECK (auth.uid() = registrado_por);
CREATE POLICY "tasas_bcv_update_admin" ON public.tasas_bcv FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- TERCEROS
-- ============================================
CREATE TABLE public.terceros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_rif tipo_rif NOT NULL,
  rif TEXT NOT NULL,
  razon_social TEXT NOT NULL,
  nombre_comercial TEXT,
  direccion_fiscal TEXT,
  telefono TEXT,
  email TEXT,
  tipo tipo_tercero NOT NULL DEFAULT 'proveedor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo_rif, rif)
);
ALTER TABLE public.terceros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "terceros_all_authenticated" ON public.terceros FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- PLAN DE CUENTAS
-- ============================================
CREATE TABLE public.plan_de_cuentas (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  grupo TEXT NOT NULL,
  afecta_gyp BOOLEAN NOT NULL DEFAULT false,
  afecta_fc BOOLEAN NOT NULL DEFAULT false,
  orden INTEGER NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.plan_de_cuentas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_cuentas_select" ON public.plan_de_cuentas FOR SELECT TO authenticated USING (true);
CREATE POLICY "plan_cuentas_admin_manage" ON public.plan_de_cuentas FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed plan de cuentas
INSERT INTO public.plan_de_cuentas (codigo, nombre, grupo, afecta_gyp, afecta_fc, orden) VALUES
-- 1.x Ingresos
('1.1', 'Ventas contado YV', 'Ingresos', true, true, 11),
('1.2', 'Ventas contado Bocú', 'Ingresos', true, true, 12),
('1.3', 'Ventas contado YV Market', 'Ingresos', true, true, 13),
('1.4', 'Ventas a crédito', 'Ingresos', true, false, 14),
('1.5', 'Cobro de créditos anteriores', 'Ingresos', false, true, 15),
-- 2.x COGS
('2.1', 'Compras de mercancía', 'COGS', false, true, 21),
('2.2', 'Ajuste COGS por inventario', 'COGS', true, false, 22),
-- 3.x Nómina
('3.1', 'Nómina regular Administración', 'Nomina', true, true, 31),
('3.2', 'Provisión pasivos laborales Administración', 'Nomina', true, false, 32),
('3.3', 'Liquidaciones Administración', 'Nomina', false, true, 33),
('3.4', 'Nómina regular Bocú', 'Nomina', true, true, 34),
('3.5', 'Bonos Bocú', 'Nomina', true, true, 35),
('3.6', 'Provisión pasivos laborales Bocú', 'Nomina', true, false, 36),
('3.7', 'Liquidaciones Bocú', 'Nomina', false, true, 37),
('3.9', 'Nómina regular YV', 'Nomina', true, true, 39),
('3.10', 'Bonos YV', 'Nomina', true, true, 310),
('3.11', 'Provisión pasivos laborales YV', 'Nomina', true, false, 311),
('3.12', 'Liquidaciones YV', 'Nomina', false, true, 312),
('3.14', 'Otros bonos', 'Nomina', true, true, 314),
('3.15', 'Parafiscales', 'Nomina', true, true, 315),
-- 4.x Administrativos
('4.1', 'Servicios profesionales', 'Administrativos', true, true, 41),
('4.2', 'Honorarios legales', 'Administrativos', true, true, 42),
('4.3', 'Gastos de oficina', 'Administrativos', true, true, 43),
-- 5.x Operativos
('5.1', 'Servicios públicos', 'Operativos', true, true, 51),
('5.2', 'Alquileres', 'Operativos', true, true, 52),
('5.3', 'Mantenimiento', 'Operativos', true, true, 53),
('5.4', 'Suministros operativos', 'Operativos', true, true, 54),
-- 6.x Mercadeo
('6.1', 'Publicidad digital', 'Mercadeo', true, true, 61),
('6.2', 'Eventos y promociones', 'Mercadeo', true, true, 62),
-- 7.x Financieros
('7.1', 'Comisiones bancarias', 'Financieros', true, true, 71),
('7.2', 'Diferencial cambiario', 'Financieros', true, false, 72),
-- 8.x Investigación
('8.1', 'Investigación y desarrollo', 'Investigacion', true, true, 81),
-- 9.x Generales
('9.1', 'Gastos generales', 'Generales', true, true, 91),
('9.2', 'Imprevistos', 'Generales', true, true, 92),
-- 10.x Financiamiento
('10.1', 'Préstamo recibido', 'Financiamiento', false, true, 101),
('10.2', 'Pago capital préstamo', 'Financiamiento', false, true, 102),
('10.3', 'Intereses sobre préstamos', 'Financiamiento', true, false, 103),
('10.4', 'Pago de dividendos', 'Financiamiento', false, true, 104),
('10.5', 'Aumento capital social', 'Financiamiento', false, true, 105),
('10.6', 'Compra activo fijo (CapEx)', 'Financiamiento', false, true, 106),
('10.7', 'Depreciación', 'Financiamiento', true, false, 107);

-- ============================================
-- TRANSACCIONES
-- ============================================
CREATE TABLE public.transacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  centro_costo centro_costo NOT NULL,
  cuenta_codigo TEXT NOT NULL REFERENCES public.plan_de_cuentas(codigo),
  modo modo_transaccion NOT NULL DEFAULT 'on_balance',
  monto_bs NUMERIC(18,2) NOT NULL,
  tasa_bcv NUMERIC(18,6) NOT NULL,
  monto_usd NUMERIC(18,2) NOT NULL,
  metodo_pago metodo_pago,
  referencia TEXT,
  tercero_id UUID REFERENCES public.terceros(id),
  notas TEXT,
  marcada_error BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transacciones_fecha ON public.transacciones(fecha DESC);
CREATE INDEX idx_transacciones_cuenta ON public.transacciones(cuenta_codigo);
CREATE INDEX idx_transacciones_cc ON public.transacciones(centro_costo);
CREATE INDEX idx_transacciones_modo ON public.transacciones(modo);

ALTER TABLE public.transacciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trans_select_all" ON public.transacciones FOR SELECT TO authenticated USING (true);
CREATE POLICY "trans_insert_own" ON public.transacciones FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "trans_update_admin_or_note" ON public.transacciones FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR modo = 'off_balance');
CREATE POLICY "trans_delete_admin" ON public.transacciones FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- CXC
-- ============================================
CREATE TABLE public.cuentas_por_cobrar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID REFERENCES public.transacciones(id) ON DELETE CASCADE,
  cliente TEXT NOT NULL,
  centro_costo centro_costo NOT NULL,
  monto_bs NUMERIC(18,2) NOT NULL,
  monto_usd NUMERIC(18,2) NOT NULL,
  fecha_vencimiento DATE,
  estado TEXT NOT NULL DEFAULT 'vigente',
  transaccion_cobro_id UUID REFERENCES public.transacciones(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cobrada_at TIMESTAMPTZ
);
ALTER TABLE public.cuentas_por_cobrar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cxc_all" ON public.cuentas_por_cobrar FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- CXP
-- ============================================
CREATE TABLE public.cuentas_por_pagar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID REFERENCES public.transacciones(id) ON DELETE CASCADE,
  tercero_id UUID REFERENCES public.terceros(id),
  monto_bs NUMERIC(18,2) NOT NULL,
  monto_usd NUMERIC(18,2) NOT NULL,
  fecha_vencimiento DATE,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pagada_at TIMESTAMPTZ
);
ALTER TABLE public.cuentas_por_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cxp_all" ON public.cuentas_por_pagar FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- PRESTAMOS
-- ============================================
CREATE TABLE public.prestamos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID REFERENCES public.transacciones(id),
  prestamista TEXT NOT NULL,
  monto_bs NUMERIC(18,2) NOT NULL,
  monto_usd NUMERIC(18,2) NOT NULL,
  plazo_meses INTEGER NOT NULL,
  saldo_bs NUMERIC(18,2) NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.prestamos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prestamos_all" ON public.prestamos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- INVENTARIO SNAPSHOTS
-- ============================================
CREATE TABLE public.inventario_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  monto_bs NUMERIC(18,2) NOT NULL,
  registrado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventario_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_all" ON public.inventario_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- CIERRES DE MES
-- ============================================
CREATE TABLE public.cierres_de_mes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo TEXT NOT NULL UNIQUE,
  inventario_inicial_bs NUMERIC(18,2) NOT NULL,
  inventario_final_bs NUMERIC(18,2) NOT NULL,
  compras_mes_bs NUMERIC(18,2) NOT NULL,
  cogs_bs NUMERIC(18,2) NOT NULL,
  cogs_usd NUMERIC(18,2) NOT NULL,
  pasivos_laborales_bs NUMERIC(18,2) NOT NULL DEFAULT 0,
  depreciacion_bs NUMERIC(18,2) NOT NULL DEFAULT 0,
  tasa_bcv_promedio NUMERIC(18,6) NOT NULL,
  notas TEXT,
  registrado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cierres_de_mes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cierres_select" ON public.cierres_de_mes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cierres_insert" ON public.cierres_de_mes FOR INSERT TO authenticated WITH CHECK (auth.uid() = registrado_por);

-- ============================================
-- AUDITORIA
-- ============================================
CREATE TABLE public.auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla TEXT NOT NULL,
  registro_id UUID,
  accion TEXT NOT NULL,
  datos JSONB,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select_admin" ON public.auditoria FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "audit_insert" ON public.auditoria FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ============================================
-- VISTAS
-- ============================================

-- G&P del mes actual
CREATE OR REPLACE VIEW public.v_gyp_mes_actual AS
SELECT
  pc.codigo,
  pc.nombre,
  pc.grupo,
  t.centro_costo,
  SUM(t.monto_bs) AS total_bs,
  SUM(t.monto_usd) AS total_usd,
  COUNT(*) AS num_movimientos
FROM public.transacciones t
JOIN public.plan_de_cuentas pc ON pc.codigo = t.cuenta_codigo
WHERE pc.afecta_gyp = true
  AND t.modo = 'on_balance'
  AND t.marcada_error = false
  AND date_trunc('month', t.fecha) = date_trunc('month', CURRENT_DATE)
GROUP BY pc.codigo, pc.nombre, pc.grupo, t.centro_costo
ORDER BY pc.orden;

-- Flujo de Caja del mes actual
CREATE OR REPLACE VIEW public.v_fc_mes_actual AS
SELECT
  pc.codigo,
  pc.nombre,
  pc.grupo,
  t.centro_costo,
  SUM(t.monto_bs) AS total_bs,
  SUM(t.monto_usd) AS total_usd
FROM public.transacciones t
JOIN public.plan_de_cuentas pc ON pc.codigo = t.cuenta_codigo
WHERE pc.afecta_fc = true
  AND t.modo = 'on_balance'
  AND t.marcada_error = false
  AND date_trunc('month', t.fecha) = date_trunc('month', CURRENT_DATE)
GROUP BY pc.codigo, pc.nombre, pc.grupo, t.centro_costo
ORDER BY pc.orden;

-- CXC activas
CREATE OR REPLACE VIEW public.v_cxc_activas AS
SELECT
  c.id,
  c.cliente,
  c.centro_costo,
  c.monto_bs,
  c.monto_usd,
  c.fecha_vencimiento,
  c.estado,
  c.created_at,
  CASE
    WHEN c.fecha_vencimiento < CURRENT_DATE THEN 'vencida'
    WHEN c.fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days' THEN 'por_vencer'
    ELSE 'vigente'
  END AS urgencia
FROM public.cuentas_por_cobrar c
WHERE c.estado = 'vigente'
ORDER BY c.fecha_vencimiento ASC NULLS LAST;

-- Off balance pendientes
CREATE OR REPLACE VIEW public.v_off_balance_pendientes AS
SELECT
  t.id,
  t.fecha,
  t.cuenta_codigo,
  pc.nombre AS cuenta_nombre,
  t.centro_costo,
  t.monto_bs,
  t.monto_usd,
  (CURRENT_DATE - t.fecha) AS dias_pendientes,
  CASE
    WHEN (CURRENT_DATE - t.fecha) > 15 THEN 'critico'
    WHEN (CURRENT_DATE - t.fecha) > 7 THEN 'advertencia'
    ELSE 'reciente'
  END AS urgencia
FROM public.transacciones t
JOIN public.plan_de_cuentas pc ON pc.codigo = t.cuenta_codigo
WHERE t.modo = 'off_balance'
  AND t.marcada_error = false
ORDER BY t.fecha ASC;

-- ============================================
-- TRIGGER UPDATED_AT
-- ============================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER terceros_updated_at BEFORE UPDATE ON public.terceros
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
