# Quitar el diferencial cambiario al pagar cuentas por pagar

## Situación

Al pagar una factura (desde la importación de movimientos bancarios o desde el pareo manual), el sistema compara la tasa BCV del día del pago con la tasa BCV de la factura y crea una transacción extra:

- **7.2 — Diferencial cambiario** (pérdida) si la tasa subió
- **11.1 — Ganancia cambiaria por cobros** si bajó

Verificado en la base: hoy no existe ninguna transacción en 7.2 ni en 11.1, así que no hay nada que limpiar hacia atrás.

## Qué se hace

Dejar de crear ese asiento por completo, en los dos flujos:

1. **Importación de movimientos bancarios** — al aplicar el pago a cada factura ya no se genera la transacción 7.2/11.1.
2. **Pareo manual** de un movimiento contra facturas — igual, sin asiento de diferencial.

Todo lo demás se mantiene tal cual:

- La deuda sigue fijada en **USD BCV** y se revalúa a la tasa BCV del día del pago.
- La factura se marca **pagada** o **parcial** con la misma lógica y la misma tolerancia (0,5 % o Bs 500).
- El movimiento bancario sigue registrando el **monto realmente pagado** en bolívares.
- Las cuentas 7.2 y 11.1 se quedan en el plan de cuentas para registros manuales; solo deja de usarlas el pago automático de facturas.

## Consecuencia contable (para que quede claro)

La diferencia por variación de tasa deja de aparecer como una línea propia en G&P y Flujo de caja; queda absorbida dentro del monto pagado de la factura. Es lo que pediste; si algún mes quieres verla, se puede reactivar con un interruptor.

## Detalles técnicos

- `src/routes/_authenticated/importar-movimientos.tsx`: eliminar el bloque que llama a `diferencialCambiario` / `registrarDiferencialCambiario` tras actualizar cada CxP (y su import dinámico).
- `src/components/pareo-manual-dialog.tsx`: eliminar la misma llamada y el id del asiento creado.
- `src/lib/cxp-saldo.ts`: conservar `diferencialCambiario` como cálculo informativo y retirar el uso de `registrarDiferencialCambiario` (queda sin llamadas; se elimina para no dejar código muerto).
- Sin cambios de base de datos ni de esquema.
