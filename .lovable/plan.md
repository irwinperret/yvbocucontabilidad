## Objetivo

Aclarar visualmente que toda la sección Análisis muestra USD a tasa paralela, y eliminar el mal etiquetado de tasas en los formularios de Registro/Financiamiento.

## 1. Badge "USD (tasa paralela)" en todas las pestañas de Análisis

Crear `src/components/usd-rate-badge.tsx` — un badge compacto con tooltip:

> "Montos en USD a tasa paralela. La tasa BCV se conserva como referencia fiscal."

Insertarlo arriba del título en cada página de Análisis:

- `dashboard.tsx`, `gyp.tsx`, `fc.tsx`, `capex.tsx`, `aumento-capital.tsx`, `impuestos.tsx`, `propinas.tsx`, `activos-transitorios.tsx`, `cxc.tsx`, `cxp.tsx`, `saldos-bancarios.tsx`, `off-balance.tsx`, `diferencial-cambiario.tsx`, `liquidaciones.tsx`, `anticipos-proveedores.tsx`, `transacciones.tsx`

Estos archivos ya usan `monto_usd` (ya convertido a paralela en la captura). No se cambia lógica, solo se añade el badge.

## 2. Corregir formularios donde la etiqueta dice "Tasa paralela" pero el valor es BCV

### 2a. `FinanciamientoBaseForm` (registrar.tsx ~líneas 2009-2194) — incluye Aumento de capital

Bug actual: el `useEffect` pre-llena el campo con `tasaSugerida.tasa` (BCV) aunque el label dice "Tasa paralela". El USD se calcula dividiendo por ese mismo valor → `equivalente USD paralelo` y `USD BCV` salen idénticos.

Cambios:
- Pre-llenar `tasa` desde `paralelaSugerida.tasa` (paralela real).
- Calcular `monto_usd` con la tasa paralela (es el USD de sistema).
- En el bloque "Equivalente", mostrar AMBOS:
  - `Equivalente USD paralelo = monto_bs / tasa_paralela`
  - `Equivalente USD BCV = monto_bs / tasa_bcv` (de `tasaSugerida.tasa`)
- Al insertar: `tasa_bcv = tasaSugerida.tasa` (BCV real del día), `tasa_paralela = tasaN` (valor del input), `monto_usd = monto_bs / tasa_paralela`.

### 2b. `LiquidacionesForm` (~línea 2783)

Actual: pre-llena `tasa` desde `bcvRow.tasa_paralela ?? paralelaAlt.tasa` (correcto, es paralela) pero al insertar guarda `tasa_bcv: tasaN, tasa_paralela: tasaN` (idénticos, mal).

Cambio: leer también el BCV (`bcvRow.tasa`) y guardar `tasa_bcv = bcvRow.tasa`, `tasa_paralela = tasaN`, `monto_usd = monto_bs / tasaN` (ya correcto).

### 2c. Formulario "Ops IVA" (~línea 1689)

Mismo bug: label "Tasa paralela", pre-llena BCV. Cambiar pre-llenado a paralela y `monto_usd` con paralela; guardar `tasa_bcv` del BCV sugerido.

### 2d. Verificación rápida del resto

- Nómina (~1344): ya usa `tasaConvN = tasaParN || tasaBcvN` y guarda ambas tasas. OK.
- COGS/Compras (~2232): pre-llena con paralela, etiqueta correcta. El snapshot guarda `tasa_bcv = tasaCompraSug.tasa` (BCV real). OK.
- Línea 2461 (pago remanente compra): cambiar `tasa_bcv: tasaN` por el BCV real del día, y mantener `monto_usd = bs/paralela`.
- Ventas/Gastos principales: ya distinguen ambas tasas correctamente (revisaré durante implementación).

## 3. Auditoría retroactiva

Ya consultado: 0 transacciones con `tasa_bcv = tasa_paralela`, 0 con `tasa_paralela` nula sobre 106 totales. El fix retroactivo previo ya limpió la base. No se requiere migración adicional.

Se incluirá una consulta SQL en `Análisis → Transacciones` (botón opcional) o simplemente se reporta aquí: actualmente no hay transacciones afectadas.

## 4. Fuera de alcance

- No se toca lógica de importación Xetux.
- No se toca `/tasa` ni `/tasa-paralela`.
- No se cambia ningún cálculo en G&P/FC (ya usan `monto_usd` paralela).

## Detalles técnicos

- Nuevo archivo: `src/components/usd-rate-badge.tsx` (badge + tooltip de shadcn).
- Editar: las ~16 páginas de Análisis (1 línea de import + 1 línea de JSX cada una).
- Editar: 3 secciones de `src/routes/_authenticated/registrar.tsx` (FinanciamientoBaseForm, LiquidacionesForm, OpsIvaForm + 1 línea en pago remanente COGS).
