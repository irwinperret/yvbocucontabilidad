## Bug

Al registrar un anticipo en Bs (cuenta 14.2), las dos columnas USD (paralelo y BCV ref.) terminan iguales. Causas posibles que voy a cubrir:

1. La tasa paralela del día no está disponible al momento del submit → el form cae al fallback `montoUsdPar = montoUsdBcv`, así que `monto_usd` queda igual a `monto_bs / tasa_bcv` y `tasa_paralela` se guarda como `null`. En la tabla de transacciones, la columna USD paralelo (monto_usd) coincide con USD BCV (monto_bs / tasa_bcv).
2. Registros antiguos (creados antes del split BCV/paralelo) con `tasa_paralela` nula o igual a `tasa_bcv`.

## Plan

**1. `src/routes/_authenticated/registrar.tsx` — `AnticipoProveedorRegisterForm`**

- Mostrar campo visible **"Tasa paralela"** (editable, pre-poblado con `paralelaSug?.tasa`), igual al patrón de los demás forms.
- Validar antes del submit: si no hay tasa paralela > 0, bloquear con toast "Falta tasa paralela del día".
- Quitar el fallback silencioso `montoUsdPar = montoUsdBcv`: si no hay paralela, `montoUsdPar` queda en 0 y el submit se rechaza.
- Guardar `tasa_paralela` con el valor del campo (no `paralelaSug?.tasa ?? null`).
- Recuadro resumen: mostrar explícitamente ambas tasas y ambos USD, con etiquetas claras.

**2. Backfill retroactivo (migration/insert)**

Para filas existentes de `transacciones` con `cuenta_codigo = '14.2'` donde `tasa_paralela IS NULL` o `tasa_paralela = tasa_bcv`:

- Buscar la `tasa` correspondiente en `tasas_paralela` para `fecha <= transaccion.fecha` (la más reciente).
- Actualizar `tasa_paralela` y recalcular `monto_usd = round(monto_bs / tasa_paralela, 2)`.
- Mantener `anticipo_usd_bcv` intacto (es la deuda congelada en USD BCV).
- Solo aplica donde `monto_bs > 0` (los reversos negativos se reposan a la tasa que corresponde a su grupo y se dejan iguales — sin tocar para no romper la conciliación; lo revisaré antes de ejecutar y, si hay reversos con el mismo problema, los recalcularé en el mismo update).

**3. Verificación**

- Registrar un anticipo de prueba (fecha = hoy) y confirmar en la tabla Transacciones que las columnas USD y USD (BCV) muestran valores **distintos**.
- `SELECT` sobre 14.2 para confirmar que ningún registro queda con `tasa_paralela = tasa_bcv` (excepto reversos legítimos donde aplique).

No se toca la lógica de aplicación de anticipos (RPC `aplicar_anticipo_a_factura`) — esa ya opera en USD BCV y está correcta.