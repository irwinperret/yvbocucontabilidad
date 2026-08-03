# Importar movimientos bancarios sin factura

Hoy la página de importación de movimientos bancarios solo registra las filas que logran emparejarse con una cuenta por pagar. Todo lo demás se descarta. El cambio permite registrar también esos movimientos, clasificados por su categoría, marcados claramente como "sin factura" y protegidos contra duplicados.

## 1. Registrar también lo no emparejado

La tabla de conciliación pasa a tener dos secciones:

- **Emparejadas con CxP** — igual que hoy: se registra el pago (cuenta 13.2) y se actualiza la cuenta por pagar.
- **Sin factura** — se registra el gasto directamente contra la cuenta del plan que corresponda.

Para las filas sin factura:

- La cuenta contable se propone automáticamente desde la columna **"Cuenta Sugerida (Plan de Cuentas)"** del archivo; si viene vacía, se deduce de la columna **"Categoría"** con este mapa:
  - INV → 2.1 Compras de mercancía
  - ADM → 4.8 Otros Administrativos
  - MO → 3.16 Nómina Administración
  - OC → 5.6 Suministros Comedor y Cocina
  - MERCADEO → 6.2 Mercadeo
  - INVERSION → 10.6 Compra activo fijo (CapEx)
  - CAJA / AHORRO / TRASPASO → sin cuenta (requiere elección manual)
- Cada fila tiene un selector para cambiar la cuenta antes de confirmar.
- Las filas sin cuenta asignada no se pueden seleccionar y se muestran resaltadas.
- Centro de costo: **Compartido** para todas.
- Método de pago: transferencia; se descuenta de la cuenta bancaria elegida.
- Las tasas BCV y paralela se toman de la fecha del movimiento (como ya se hace hoy). Si la fila viene solo en USD (BOFA, Cash), los Bs se calculan con la tasa paralela de esa fecha.

## 2. Marca de "sin factura"

Cada transacción creada por esta vía queda marcada de tres formas para poder identificarla y auditarla después:

- El campo **Detalle** arranca con `SIN FACTURA XETUX`.
- Las notas incluyen el concepto original del banco y la referencia.
- En la vista de **Transacciones** aparece un chip naranja **"Sin factura"** en las filas marcadas, y un filtro para ver solo esas.

Así queda claro que el movimiento se registró desde el banco sin respaldo de factura en Xetux, y se puede corregir/reclasificar más adelante desde el mismo tab de Transacciones.

## 3. Esquema anti-duplicados

Se define una **huella** por movimiento: `banco + fecha + referencia + monto` (normalizados: banco en mayúsculas sin espacios, monto redondeado a 2 decimales).

- La huella se guarda en el campo `referencia` de la transacción con un formato fijo y buscable: `BANK:<BANCO>|<FECHA>|<REF>|<MONTO>`.
- Antes de confirmar la importación, la página consulta las transacciones existentes con esas huellas y marca las filas repetidas como **"Ya importado"**, deseleccionadas y con badge gris.
- El chequeo aplica tanto a las filas emparejadas con CxP como a las sin factura.
- Dentro del mismo archivo también se detectan huellas repetidas entre sí.
- Un contador arriba muestra: `X nuevas · Y ya importadas · Z sin cuenta`.

## Detalles técnicos

- Archivo principal: `src/routes/_authenticated/importar-movimientos.tsx`.
  - Nuevo parseo de las columnas `Categoría` y `Cuenta Sugerida (Plan de Cuentas)`.
  - `huella(bankRow)` y consulta previa `transacciones.select('referencia').in('referencia', huellas)` en lotes.
  - Rama de inserción para no emparejadas: `cuenta_codigo` elegido, `centro_costo: 'Compartido'`, `modo: 'on_balance'`, `metodo_pago: 'transferencia'`, `detalle` con el prefijo de marca, sin IVA (`iva_bs: 0`).
  - Se mantiene el guard de mes cerrado y `logAudit` por inserción.
- `src/routes/_authenticated/transacciones.tsx`: chip "Sin factura" y filtro basado en el prefijo de `detalle`.
- No requiere cambios de base de datos: la marca y la huella usan campos de texto ya existentes (`detalle`, `referencia`).
