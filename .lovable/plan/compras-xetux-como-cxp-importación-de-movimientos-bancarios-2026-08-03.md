# Compras Xetux como CxP + Importación de movimientos bancarios

## Parte 1 — Importar compras (Xetux) genera Cuentas por Pagar

En la página de importación de compras, cada factura pasa a registrarse como **CxP pendiente** en lugar de compra ya pagada:

- La transacción 2.1 se guarda con método de pago "pendiente" y sin cuenta bancaria.
- Tras insertar la 2.1 y su pierna de IVA (12.5), se crea el registro en cuentas por pagar con proveedor, N° factura, centro de costo, monto en Bs, USD BCV y USD paralelo, las tasas de la fecha de la factura, estado "pendiente" y origen "xetux".
- Deduplicación: si ya existe la transacción 2.1, se verifica también la CxP (mismo proveedor + N° factura). Si existe y está pendiente, se omite; si no existe, se crea.
- Texto informativo actualizado: "Todas las compras importadas se registran como Cuentas por Pagar pendientes. El pago se registrará cuando importes los movimientos bancarios y los cruces contra estas facturas."

## Parte 2 — Nueva página "Importar movimientos bancarios"

Nueva ruta `/importar-movimientos` con ítem en el menú lateral (modo Registro), justo debajo de "Importar compras (Xetux)".

**Paso 1 — Subir y cruzar**
Se lee el Excel por nombre de columna (Mes, Banco, Fecha, N° Referencia, Concepto/Descripción, Monto Bs, Monto USD, Categoría, Cuenta Plan de Cuentas, N° Factura extraído, Estado, Cuenta Sugerida), tolerante a variaciones y al orden real del archivo.

Cruce automático contra CxP pendientes:
- Primario: N° factura extraído (comparando solo dígitos).
- Secundario: números detectados en el concepto (FACT 1234, F12345, NE 123, REC123) → sugerencia.
- Sin coincidencia: "Sin cruzar".

**Paso 2 — Vista previa**
Tabla con badge por fila: Cruzado (verde, muestra proveedor/factura/monto de la CxP), Sugerencia (amarillo, con Aceptar/Rechazar), Sin cruzar (rojo, con selector de cuenta del plan precargado desde las columnas de cuenta sugerida y campo de notas), Ignorar (gris). Acciones masivas: "Aceptar todos los cruzados" e "Ignorar traspasos" (Categoría AHORRO/TRASPASO o concepto con TRASPASO).

**Paso 3 — Confirmar importación**
- Filas cruzadas: se toman las tasas BCV y paralela de la fecha del movimiento; se crea la transacción 13.2 (pago de CxP) con monto en Bs, USD a paralela, referencia y concepto del archivo, ligada al grupo de la factura; se marca la CxP como pagada con pendiente en 0; y si el USD BCV pagado difiere del USD BCV de la factura, se registra el diferencial cambiario en 11.1 (ganancia) o 11.2 (pérdida).
- Filas sin cruzar con cuenta asignada: transacción on-balance en esa cuenta con las tasas de la fecha.
- Filas sin cruzar sin cuenta: se registran off-balance con referencia "BANCO-SIN-CRUZAR" para revisión posterior.
- Banco → cuenta bancaria: BVC (y el typo "BCV") → BVC, MERC → MERCANTIL, BA → BANCAMIGA, BOFA → BOFA; CASH y CXP quedan sin cuenta bancaria. Se avisa en pantalla cuando aparece "BCV" para que sepas que se interpretó como BVC.
- Filas en USD sin Monto Bs (BOFA/CASH): el USD del archivo se toma como USD paralelo real y el monto en Bs se calcula con la tasa paralela de esa fecha.
- Resumen final: "X pagos cruzados contra CxP · Y gastos registrados directamente · Z off-balance pendientes · W ignorados."

## Parte 3 — Filtro de origen en Cuentas por Pagar

- Migración: agregar la columna `origen` (texto, por defecto "manual") a cuentas por pagar y marcar como "xetux" las que provengan de transacciones importadas de Xetux.
- En la vista de CxP: filtro "Origen" (Todos / Xetux / Manual) y una columna con badge Xetux o Manual.

## Detalles técnicos

- Archivos: `src/routes/_authenticated/importar-compras.tsx`, nuevo `src/routes/_authenticated/importar-movimientos.tsx`, `src/components/app-sidebar.tsx`, `src/routes/_authenticated/cxp.tsx`; parseo con los helpers existentes de `src/lib/xetux-parse.ts`.
- Migración SQL: `ALTER TABLE public.cuentas_por_pagar ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'manual';` + update de las CxP ligadas a transacciones con `referencia = 'xetux'`.
- Se respeta el guard de mes cerrado al insertar transacciones y se invalidan las queries de CxP, transacciones y saldos al terminar.
