-- Agrega 'pendiente_revision' como estado válido de conciliación bancaria.
-- Se usa para sugerencias de posible/parcial pareo que fueron rechazadas
-- (antes caían en 'sin_pareo', mezclándose con movimientos donde el sistema
-- nunca encontró ninguna factura candidata) y para marcar a mano casos
-- dudosos que necesitan revisión posterior.
ALTER TABLE conciliacion_bancaria DROP CONSTRAINT conciliacion_bancaria_estado_check;
ALTER TABLE conciliacion_bancaria ADD CONSTRAINT conciliacion_bancaria_estado_check
  CHECK (estado = ANY (ARRAY[
    'pareado'::text,
    'parcial'::text,
    'rechazado'::text,
    'no_aplica'::text,
    'sin_pareo'::text,
    'gasto_directo'::text,
    'no_contable'::text,
    'pendiente_revision'::text
  ]));
