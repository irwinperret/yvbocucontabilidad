-- "Solventado manualmente": para facturas y movimientos bancarios viejos
-- donde se sabe que ya se resolvieron (total o parcialmente) pero nunca va
-- a aparecer el cruce normal -- la factura se pagó sin dejar movimiento, o
-- el movimiento pagó una factura que nunca se cargó al sistema.
--
-- A diferencia de cierre_manual (que cierra una factura POR COMPLETO y la
-- saca de las listas activas), este monto se resta siempre del saldo
-- pendiente sin sacar la factura/movimiento de circulación: si solo se
-- solventa una parte, el resto sigue viéndose como pendiente de verdad.

ALTER TABLE public.cuentas_por_pagar
  ADD COLUMN IF NOT EXISTS monto_solventado_manual_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS solventado_manual_nota text,
  ADD COLUMN IF NOT EXISTS solventado_manual_fecha date,
  ADD COLUMN IF NOT EXISTS solventado_manual_por uuid,
  ADD COLUMN IF NOT EXISTS solventado_manual_at timestamptz;

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS solventado_manual_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS solventado_manual_nota text,
  ADD COLUMN IF NOT EXISTS solventado_manual_fecha date,
  ADD COLUMN IF NOT EXISTS solventado_manual_por uuid,
  ADD COLUMN IF NOT EXISTS solventado_manual_at timestamptz;
