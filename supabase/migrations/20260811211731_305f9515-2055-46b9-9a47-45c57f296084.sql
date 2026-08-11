-- 1) Dedupe existing rows that would violate the unique index
DELETE FROM public.conciliacion_bancaria a
USING public.conciliacion_bancaria b
WHERE a.ctid > b.ctid
  AND a.transaccion_bancaria_id = b.transaccion_bancaria_id
  AND a.transaccion_factura_id IS NOT DISTINCT FROM b.transaccion_factura_id;

-- 2) Deleting an invoice transaction should remove the reconciliation link,
--    not null it out (which collided under NULLS NOT DISTINCT).
ALTER TABLE public.conciliacion_bancaria
  DROP CONSTRAINT conciliacion_bancaria_transaccion_factura_id_fkey;

ALTER TABLE public.conciliacion_bancaria
  ADD CONSTRAINT conciliacion_bancaria_transaccion_factura_id_fkey
  FOREIGN KEY (transaccion_factura_id) REFERENCES public.transacciones(id) ON DELETE CASCADE;