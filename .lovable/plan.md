## Diagnóstico

El diseño contable actual es **correcto**: 2.1 (Compras) afecta Flujo de Caja pero no G&P; 2.2 (Ajuste COGS) se crea en el cierre y afecta G&P. Después del fix del turno anterior, **ambos flujos (manual y Xetux)** insertan `inventario_snapshots` + transacción 2.1 + IVA 12.5 idénticamente.

Pero la DB confirma un problema real: solo existe **1 transacción 2.1** en toda la base (la de Xetux, factura 90655 creada hoy 15:38 UTC) y **cero 2.1 de compras manuales**. Eso significa que el `addCompra` de "COGS e Inventario" no está dejando la pierna 2.1 en la tabla `transacciones` aunque el código dice que sí lo hace.

Hipótesis a validar (en orden de probabilidad):

1. La compra manual se registró **antes del fix** y el usuario lo recuerda como "después" — la data vieja solo tiene `inventario_snapshots`.
2. El `insert` de 2.1 está fallando silenciosamente por RLS/policy y solo se ve el toast rojo un instante.
3. El botón que usa el usuario en "COGS e Inventario" no es `addCompra` sino otra ruta (`snapshots` viejos, "Pagar factura", etc.) que nunca creaba 2.1.

## Plan

### Paso 1 — Reproducir en vivo
- Pedir al usuario que registre **una compra manual nueva** ahora (proveedor cualquiera, N° factura de prueba, monto pequeño, on-balance).
- Justo después, consultar `SELECT id, cuenta_codigo, numero_factura, created_at FROM transacciones WHERE numero_factura = '<el nuevo>'` y `SELECT id FROM inventario_snapshots WHERE numero_factura = '<el nuevo>'`.
- Si aparece el snapshot pero NO la 2.1 → hay bug real y vamos al Paso 2. Si aparecen ambos → la percepción venía de data vieja y vamos al Paso 3.

### Paso 2 — Si hay bug real
- Revisar RLS de `transacciones` para INSERT con `cuenta_codigo='2.1'`.
- Revisar el bloque `try/catch` alrededor de `insertCompraTransacciones` en `registrar.tsx` para asegurar que un error de la 2.1 no se está tragando después del snapshot exitoso.
- Corregir y reintentar.

### Paso 3 — Backfill de compras manuales viejas (opcional pero recomendado)
Para que la lista de Transacciones y el reporte de FC reflejen compras manuales previas al fix:

- Escanear `inventario_snapshots` de tipo `compra` que **no** tengan una transacción 2.1 asociada por `grupo_transaccion_id`.
- Mostrar la lista al usuario para decidir: backfill masivo o revisión caso a caso.
- Generar las 2.1 (y 12.5 si tenían IVA) con los mismos montos, tasas y `grupo_transaccion_id` del snapshot.

### Confirmación del diseño (respuesta directa a la pregunta)

**Sí está bien** que la compra aparezca en la lista de Transacciones al instante como 2.1 (es lo que hace Xetux). La compra manual **debe** comportarse igual — si no lo está haciendo, es un bug de datos, no de diseño. El "ajuste de inventario 2.2" que ves en el cierre es una entrada **adicional** al G&P, no un reemplazo: la 2.1 vive en Flujo de Caja/CxP, la 2.2 vive en G&P.

## Fuera de alcance
- Cambiar el esquema contable 2.1 vs 2.2.
- Reescribir el importador Xetux o el formulario manual (ya están alineados).