## Cambios al modelo

### 1. Plan de cuentas
Crear cuenta **13.1 — Propinas por pagar al personal** (grupo `Pasivos transitorios`):
- `afecta_gyp = false`, `afecta_fc = true`
- `centros_permitidos = {YV, Bocu}`

> Nota técnica: el sistema actual no tiene una columna `es_ingreso` en `transacciones`. El signo (entrada vs salida) lo determina el código de cuenta. Para 13.1 introduciremos una convención local: en `transacciones.notas` el prefijo indica el sentido; además guardaremos `grupo_transaccion_id` que apareja las dos transacciones para que sumadas den cero. En el reporte FC clasificaremos 13.1 como movimiento "transitorio" cuyo neto siempre es 0 en el período una vez distribuido.

### 2. Tabla `propinas`
Añadir columnas:
- `transaccion_entrada_id uuid` (reemplaza el actual `transaccion_id`, migrado)
- `transaccion_salida_id uuid` (null = pendiente de distribuir)
- `fecha_distribucion date`
- `monto_distribuido_usd numeric`
- `notas_distribucion text`

Un registro de propina queda **"Pendiente"** si `transaccion_salida_id IS NULL`, **"Distribuida"** si está poblado.

### 3. Doble transacción
Al registrar una propina:
- **Entrada**: `cuenta_codigo='13.1'`, `monto_usd=+X`, `notas="Propina recibida — fecha — centro"`, `grupo_transaccion_id=G`, `modo='on_balance'`.
- **Salida** (cuando se distribuye): mismo cuenta, mismo `grupo_transaccion_id=G`, `notas="Propina distribuida al personal — fecha — centro"`, importe negativo conceptualmente pero almacenado como positivo con marca de salida (usaremos la notación en `notas` + el segundo registro en tabla `propinas`).

Para que el FC trate la salida como negativa en 13.1, agregaremos en el cliente una regla: filas con `cuenta_codigo='13.1'` cuyo `notas` empieza con `"Propina distribuida"` se restan en lugar de sumar. Alternativamente, podemos almacenar la salida con `monto_usd` negativo (PostgreSQL lo permite; revisaremos constraints).

> Si prefieres una solución más limpia, podemos añadir una columna `es_ingreso boolean` real a `transacciones`. Indícamelo y la incluyo en la migración.

Al eliminar cualquiera de las dos transacciones del mismo `grupo_transaccion_id`, el cliente avisa y borra ambas (más el registro `propinas`).

### 4. Página Propinas
- Disclaimer reemplazado por el texto que diste (en negrita, ámbar).
- Formulario en dos pasos / dos secciones:
  - **Recibida**: fecha, centro de costo, monto USD, método de pago, notas → crea entrada.
  - **Distribuida**: fecha de distribución, monto USD (default = recibido), notas → crea salida y vincula.
- Cada fila de la tabla muestra badge:
  - 🟧 `Pendiente de distribuir` (sólo entrada)
  - 🟩 `Distribuida` (ambas)
  - Botón "Marcar como distribuida" en filas pendientes.
- KPI extra: **Propinas pendientes de distribuir** = suma de recibidas sin salida. En naranja si > 0.

### 5. Flujo de Caja
- Cuenta 13.1 aparece en el comparativo (ya lista todas las `afecta_fc=true`).
- En `ReporteFC` añadimos una sección **"Movimientos transitorios"** que muestra entradas y salidas de 13.1 por separado y neto = 0 (o saldo pendiente del período).
- Exportación FC incluye la sección.

### 6. Saldos bancarios
- Las transacciones 13.1 ya aparecerán al filtrar por cuenta bancaria (porque tienen `cuenta_bancaria_id`).
- Cada fila con `cuenta_codigo='13.1'` se renderiza con un badge **`Propina`** y un color distinto (lila/morado) para distinguirla de operativas.

## Archivos a tocar

```text
supabase/migrations/<ts>_propinas_doble_tx.sql     (nuevo)
src/routes/_authenticated/propinas.tsx              (form 2 pasos, KPI pendiente, disclaimer, badges)
src/routes/_authenticated/fc.tsx                    (sección transitorios)
src/routes/_authenticated/saldos-bancarios.tsx      (badge "Propina")
src/lib/excel-export.ts                             (incluir transitorios en FC export)
```

## Preguntas antes de empezar

1. **Signo en `transacciones`** para distinguir entrada vs salida de 13.1: ¿prefieres (a) almacenar la salida con `monto_usd` negativo, (b) añadir una columna `es_ingreso boolean`, o (c) inferirlo del texto en `notas`? Recomiendo **(b)** por claridad y consistencia futura.
2. **Migración de datos existentes** en `propinas`: los registros actuales no tienen transacción de entrada en 13.1 (la cuenta no existía). ¿Genero la transacción de entrada retroactivamente para cada propina existente, marcándolas todas como "Pendientes de distribuir"? ¿O los dejo en estado legacy sin transacciones vinculadas?
