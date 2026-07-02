
-- 1) Migrar los 2 snapshots huérfanos (tipo='compra' sin transacción 2.1 gemela) a transacciones
INSERT INTO public.transacciones (
  fecha, cuenta_codigo, centro_costo, modo,
  monto_bs, monto_base_bs, iva_bs, iva_aplica,
  monto_usd, tasa_bcv, tasa_paralela,
  metodo_pago, cuenta_bancaria_id, tercero_id, numero_factura,
  notas, created_by, grupo_transaccion_id
)
SELECT
  s.fecha,
  '2.1',
  'Compartido'::centro_costo,
  COALESCE(s.modo, 'on_balance'),
  COALESCE(s.monto_base_bs, s.monto_bs),
  COALESCE(s.monto_base_bs, s.monto_bs),
  0,
  false,
  s.monto_usd,
  s.tasa_bcv,
  s.tasa_paralela,
  'transferencia',
  s.cuenta_bancaria_id,
  s.tercero_id,
  s.numero_factura,
  s.notas,
  s.registrado_por,
  s.grupo_transaccion_id
FROM public.inventario_snapshots s
WHERE s.tipo = 'compra'
  AND (
    s.grupo_transaccion_id IS NULL
    OR s.grupo_transaccion_id NOT IN (
      SELECT grupo_transaccion_id FROM public.transacciones
      WHERE cuenta_codigo = '2.1' AND grupo_transaccion_id IS NOT NULL
    )
  );

-- 2) Borrar todos los tipo='compra' de inventario_snapshots (ya viven en transacciones 2.1)
DELETE FROM public.inventario_snapshots WHERE tipo = 'compra';

-- 3) Restringir tipo a inicial/final y garantizar 1 por (periodo, tipo)
ALTER TABLE public.inventario_snapshots
  DROP CONSTRAINT IF EXISTS inventario_snapshots_tipo_check;
ALTER TABLE public.inventario_snapshots
  ADD CONSTRAINT inventario_snapshots_tipo_check
  CHECK (tipo IN ('inicial', 'final'));

CREATE UNIQUE INDEX IF NOT EXISTS inventario_snapshots_periodo_tipo_uidx
  ON public.inventario_snapshots (periodo, tipo);
