## Diagnóstico

El problema viene de dos puntos del flujo actual:

1. Al registrar un anticipo, la pantalla todavía usa la tasa paralela como tasa principal y guarda `monto_usd` con esa tasa, aunque el flujo de egresos debe usar BCV.
2. Al aplicar anticipos contra facturas, el descuento se está calculando en USD y luego convirtiendo de forma inconsistente; en la práctica puede no descontar correctamente el saldo Bs que queda pendiente/CxP.

## Plan de corrección

1. **Corregir registro de anticipos a proveedor**
   - Cambiar el formulario de anticipo para autollenar y validar **tasa BCV**.
   - Calcular `monto_usd = monto_bs / tasa_bcv`.
   - Guardar `tasa_bcv` como tasa principal y dejar `tasa_paralela` solo como referencia si existe.
   - Actualizar etiquetas visibles de “Tasa paralela” a “Tasa BCV”.

2. **Aplicar anticipos por monto Bs equivalente a BCV**
   - En Gastos/Facturas y COGS, calcular el monto aplicado en Bs usando `aplicarUsd * tasa_bcv de la factura`.
   - Crear CxP solo por el saldo real después del anticipo.
   - Si el anticipo cubre toda la factura, no crear CxP y marcar la compra/factura como pagada cuando aplique.

3. **Reforzar la función de base de datos**
   - Ajustar `aplicar_anticipo_a_factura` para que cierre/actualice el anticipo correctamente y deje el reverso en `14.2` vinculado al grupo de la factura.
   - Mantener diferencial cambiario en `11.1/11.2` solo cuando supere $0.01.
   - Asegurar permisos de ejecución para usuarios autenticados.

4. **Backfill del histórico roto**
   - Detectar anticipos registrados recientemente con `cuenta_codigo = '14.2'` y `anticipo_estado IS NULL` o montos USD calculados con paralela.
   - Recalcularlos a BCV cuando tengan `tasa_bcv` válida.
   - Normalizar `anticipo_estado = 'abierto'` para anticipos reales positivos sin estado.

5. **Verificación funcional**
   - Revisar una factura de prueba con anticipo abierto: después de guardar, debe verse el reverso en `14.2`, el anticipo debe quedar aplicado/parcial, y la CxP debe existir solo por el remanente.
   - Confirmar que las vistas de Anticipos y CxP reflejen el saldo pendiente correcto.