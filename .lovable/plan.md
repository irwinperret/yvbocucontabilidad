Plan de corrección:

1. **Corregir el flujo en adelante**
   - En `Pagar CxP` y en `Pagar factura pendiente (CxP)` dentro de Registro, el pago ya no insertará una transacción con la misma cuenta de gasto/COGS original.
   - Mantendré el vínculo con la factura original por `grupo_transaccion_id` y/o `transaccion_id`, pero el pago quedará identificado como `Pago CxP` y no debe afectar G&P.
   - El pago seguirá afectando Flujo de Caja con el `monto_bs` efectivamente pagado y `monto_usd` calculado a tasa paralela.

2. **Evitar duplicación en reportes**
   - Ajustar la lógica de reportes/vista mensual para que cualquier transacción marcada como `Pago CxP` tenga `base_usd = 0` en G&P, aunque conserve `total_usd` para Flujo de Caja.
   - Así la factura pendiente cuenta una sola vez en G&P al registrarse, y el pago solo aparece como salida de caja.

3. **Corregir retroactivamente las últimas transacciones afectadas**
   - Revisé las últimas 3 transacciones: la factura `1234` generó:
     - gasto original `7261fc4b…` cuenta `5.5`, pendiente, correcto para G&P;
     - IVA `43cba386…`, correcto como IVA crédito;
     - pago `c5e67d61…` cuenta `5.5`, que está duplicando el gasto.
   - Corregiré esa fila de pago para que no afecte G&P y quede como pago de CxP vinculado al grupo original.
   - Haré una auditoría de otros pagos `Pago CxP` históricos que estén usando cuentas de gasto/COGS y aplicaré la misma corrección.

4. **Verificación**
   - Confirmar que la CxP queda pagada (`monto_pendiente_bs = 0`, estado `pagada`).
   - Confirmar que G&P solo muestra el gasto original una vez.
   - Confirmar que Flujo de Caja sí muestra el pago realizado.
   - Confirmar que Transacciones sigue mostrando el pago con badge `Pago CxP` y vinculado a la factura original.