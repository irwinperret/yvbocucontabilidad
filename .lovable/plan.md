# Verificación de COGS/Compras, auditoría histórica y pago de CxP inline

## Objetivo
Cerrar los pendientes implícitos del último ciclo: confirmar que el cambio BCV/Paralela + split de IVA quedó correctamente aplicado en COGS, auditar registros históricos por si quedaron mal, y validar que `pagar-cxp-inline.tsx` reutiliza la misma lógica que `pagar-cxp.tsx`.

## Pasos

### 1. Verificación en vivo de COGS/Compras (Playwright)
- Levantar `localhost:8080`, restaurar sesión Supabase desde env.
- Navegar a `/registrar`, ir al tab **COGS/Compras**.
- Capturar screenshot inicial.
- Llenar formulario: proveedor, monto neto, IVA 16%, fecha hoy.
- Verificar visualmente:
  - "Tasa BCV del día" es el input principal y tiene un valor distinto a "Tasa paralela (referencia)".
  - Panel de equivalencia muestra **USD BCV** y **USD paralelo (ref)** como valores distintos.
  - Campos `montoNeto` e `IVA` son inputs separados.
- Submit y leer transacción recién creada en DB:
  - Confirmar `monto_base_bs` + `iva_bs` separados.
  - Confirmar `monto_usd = monto_bs / tasa_bcv` (no paralela).
  - Confirmar leg IVA (cuenta 12.5) creado con su propio `grupo_transaccion_id`.

### 2. Misma verificación en Gastos/Facturas
- Repetir paso 1 en el tab Gastos/Facturas (cuentas 3.x / 5.x).
- Confirmar tasas distintas, split IVA, divisor BCV.

### 3. Auditoría histórica
- Query a `transacciones` para COGS y Gastos en los últimos 60 días:
  - Buscar filas donde `tasa_bcv = tasa_paralela` con ambos no nulos → sospecha de bug previo.
  - Buscar filas con IVA aplicado sin leg 12.5 hermano por `grupo_transaccion_id`.
  - Buscar CxP donde `tasa_bcv_factura = tasa_paralela_factura` (snapshots iguales).
- Producir lista de IDs afectados; si hay >0, preparar migración de corrección retroactiva (recalcular `monto_usd` con BCV correcta del día, snapshots de CxP).

### 4. Pago de CxP inline desde Registrar
- `src/components/pagar-cxp-inline.tsx` ya delega en `PagoModal` (de `pagar-cxp.tsx`) → hereda automáticamente la lógica BCV→Paralela. **Sólo verificar**, no reescribir.
- Test en vivo: desde `/registrar`, elegir flujo "Pagar factura pendiente (CxP)" en COGS y en Gastos. Seleccionar una CxP abierta, abrir modal, confirmar:
  - Muestra `usd_bcv_factura` como deuda.
  - Calcula `monto_bs_a_pagar = usd_bcv_pendiente × tasa_bcv_hoy`.
  - `monto_usd` de la transacción de pago usa paralela.
  - No genera transacción separada 11.1/11.2 (diferencial implícito).
- Confirmar también que el tab muestra correctamente el badge "Pago CxP" en `/transacciones`.

### 5. Reporte
- Resumir: qué pasó la verificación, cuántos registros históricos quedaron afectados, qué migración correctiva se aplicó (si aplica).
- Si todo OK, cerrar pendientes.

## Detalles técnicos
- Verificación en vivo: Playwright headless en `/tmp/browser/cogs-audit/`, viewport 1280×1800.
- Auditoría: queries de solo lectura primero; cualquier UPDATE va por migración con justificación por fila.
- No tocar lógica del `PagoModal` salvo que la verificación demuestre un bug.
- No modificar `aplicar_anticipo_a_factura` (fuera de scope).

## Fuera de scope
- Cambios de UI/UX más allá de etiquetas si la verificación los descubre.
- Refactor de `pagar-cxp.tsx`.
- Anticipos a proveedores (ya cerrado en ciclos anteriores).
