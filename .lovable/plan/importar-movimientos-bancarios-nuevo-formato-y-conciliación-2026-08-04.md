# Importar movimientos bancarios — nuevo formato y conciliación mejorada

El archivo de ejemplo (929 filas) trae ahora la columna **K — "N° Factura o N° Orden de Entrega"** con códigos como `88059`, `12, F4, F2`, `NE: 21, 28, 4`, `PED: 130526`. La página se adapta a ese formato y a la lógica de moneda por banco.

## 1. Lectura de la columna K

- Se lee la columna "N° Factura o N° Orden…" y se separa por comas.
- Cada token se limpia de prefijos `NE:`, `PED:`, `FACT`, `F`, guiones, espacios y ceros a la izquierda.
- El tipo se conserva para mostrarlo: factura, orden de entrega (NE) o pedido (PED).
- Estos códigos pasan a ser la **fuente principal** de emparejamiento; el concepto y la referencia bancaria quedan como respaldo secundario.

## 2. Conciliación más tolerante

- Comparación por código **normalizado** (sin guiones, sin ceros iniciales, sin letras separadoras), de modo que `F-101218`, `F101218` y `101218` se consideren el mismo documento.
- Si un token coincide con varias facturas pendientes, se ofrecen todas como candidatas en vez de descartar el emparejamiento.
- Si una fila tiene varios códigos, se emparejan **todas** las facturas encontradas en el mismo movimiento (ya soportado por el reparto de pago existente).
- Coincidencia por sufijo cuando el código del banco es más corto que el número de factura de Xetux (caso frecuente con ceros de control).

> Nota: hoy las CxP de Xetux solo guardan `numero_factura`; no hay número de orden de entrega almacenado. Los códigos `NE:` y `PED:` se cruzarán contra ese mismo campo con la comparación tolerante, y cuando no exista equivalencia la fila se registra igual (sección 4).

## 3. Moneda según el banco (columna C)

- **BA, BCV, BM, BVC, MERC, CxP** → la variable independiente es el **monto en Bs**. El USD paralelo y el USD BCV se derivan de ese Bs con las tasas del día del movimiento.
- **CASH y BOFA** → la variable independiente es el **monto en USD**. Los Bs se calculan con la **tasa paralela** del día y, a partir de esos Bs, se obtiene el equivalente en USD BCV.
- La tabla mostrará ambas equivalencias (USD paralelo y USD BCV) y marcará cuál es el monto original del banco.

## 4. Movimientos que nunca tendrán factura

Se define una lista de cuentas "sin factura por naturaleza":

- Nómina y compensaciones: todas las 3.x
- Activos transitorios: 14.1, 14.3
- Pasivos transitorios: 13.1
- Financiamiento: 10.1, 10.2, 10.4, 10.5
- Impuestos: 12.1, 12.2, 12.3, 12.4, 12.5
- Financieros: 7.1, 7.2, 10.7
- Otros: 11.1, 11.2, 13.2

Comportamiento:

- Estas filas **no se intentan emparejar** ni se muestran como "sin cuenta" ni en rojo. Quedan listas para registrar con su cuenta contable.
- En lugar del chip naranja "Sin factura", llevan un chip neutro **"No aplica factura"**.
- No se les antepone `SIN FACTURA XETUX` en el detalle; el detalle usa el concepto del banco tal cual.
- **Servicios públicos (9.3, 9.4, 9.7)**: caso intermedio. Se marcan como **"Cruce por referencia bancaria"** — se registran directamente contra su cuenta y el número de referencia bancaria queda guardado en el campo de referencia/notas.
- El resto (proveedores comerciales sin factura encontrada) mantiene la marca `SIN FACTURA XETUX` actual, para poder reclasificarlo después.

Los contadores de arriba pasan a ser: `con factura · no aplica factura · sin factura pendiente de revisión · ya importadas`.

## 5. Combobox con búsqueda

El selector de CxP (y el de "agregar otra factura") deja de ser un dropdown plano: se convierte en un **combobox con autocompletado**, que busca por proveedor y por número de factura sobre todas las CxP pendientes (hoy está limitado a las primeras 200 opciones). El selector de cuenta contable recibe el mismo tratamiento.

## Detalles técnicos

- `src/routes/_authenticated/importar-movimientos.tsx`
  - Nuevo parseo de la columna K → `codigos: { tipo: 'FACT'|'NE'|'PED'; raw: string; norm: string }[]`.
  - `normalizarCodigo(s)`: mayúsculas, quita `NE:`/`PED:`/`FACT`/`F` inicial, quita `-`, `/`, espacios y ceros a la izquierda.
  - Índice de CxP por código normalizado **y** por sufijos, para emparejar en O(1) sin degradar el rendimiento (se mantiene la virtualización de 150 filas).
  - `monedaBase(banco)`: `BA|BCV|BM|BVC|MERC|CXP → 'Bs'`; `CASH|BOFA → 'USD'`. Sustituye la heurística actual que decide por qué celda viene llena.
  - Al confirmar: si `monedaBase === 'USD'`, `monto_bs = usd * tasa_paralela(fecha)` y `monto_usd = usd` (original); si es `Bs`, `monto_usd = bs / tasa_paralela(fecha)`. En ambos casos el USD BCV se calcula solo para mostrar.
  - Constante `CUENTAS_SIN_FACTURA` (lista de la sección 4) y `CUENTAS_SERVICIOS = ['9.3','9.4','9.7']`; controlan chips, prefijo de detalle y si la fila entra al motor de emparejamiento.
  - Combobox con `Command` + `Popover` de shadcn (ya presentes en el proyecto).
- Sin cambios de base de datos.
