# Asistente para corregir filas fallidas en las importaciones de Xetux

Hoy, cuando una factura de ventas o compras no se puede registrar (falta la fecha, no hay tasa BCV de ese día, no se pudo crear el proveedor, error al insertar), solo aparece un aviso rojo que desaparece y la fila queda perdida: no se cuenta y no queda rastro. La idea es que ninguna fila se pierda.

## 1. Registrar las fallas en vez de solo avisarlas

Durante la importación, cada fila que falle se guarda en memoria con:

- Los datos leídos del archivo (fecha, proveedor/cliente, N° factura, montos, IVA, tipo).
- El motivo exacto del fallo, en texto claro ("Sin tasa BCV para 2026-07-14", "Falta la fecha", "No se pudo crear el proveedor", o el error devuelto por el sistema).

Las filas duplicadas (omitidas a propósito) no cuentan como fallas.

## 2. Resumen final más honesto

Al terminar, además de "X registradas · Y duplicadas", se muestra un bloque rojo:

"Z filas no se pudieron registrar" con un botón **Corregir filas fallidas**.

Ese bloque permanece en pantalla (no es un aviso que se va) hasta que se resuelvan o se descarten.

## 3. El asistente (wizard) de corrección

Se abre en un panel paso a paso, una fila a la vez, mostrando "Fila 1 de Z":

- Arriba: el motivo del fallo y los datos originales del archivo.
- Abajo: un formulario editable con los campos necesarios según el caso:
  - Fecha del documento.
  - Proveedor / cliente (con buscador de terceros existentes y opción de crear uno nuevo).
  - N° de factura, centro de costo, cuenta contable.
  - Monto neto, IVA y total.
  - Tasa BCV y tasa paralela de esa fecha: se cargan automáticamente; si no existen para ese día, se pueden escribir a mano y se guardan como tasa del día.
- Botones: **Registrar y siguiente**, **Saltar por ahora**, **Descartar esta fila** (con confirmación).

Al pulsar Registrar se ejecuta exactamente la misma lógica de la importación (compras: transacción 2.1 + pierna de IVA 12.5 + cuenta por pagar pendiente; ventas: la misma secuencia de ventas, cobros y propinas), incluida la verificación de duplicados y el control de mes cerrado.

## 4. Quedan dentro de la misma carga

Las filas corregidas con el asistente se etiquetan con la misma importación, así que aparecen en el historial de importaciones y se revierten junto con el resto si se deshace esa carga. Los totales de la carga (registradas / omitidas) se actualizan al cerrar el asistente.

Si se cierra el asistente con filas pendientes, el bloque rojo sigue visible con las que faltan, y se puede reabrir mientras no se recargue la página.

## Detalles técnicos

- `src/routes/_authenticated/importar-compras.tsx` y `src/routes/_authenticated/importar-ventas.tsx`: extraer el cuerpo del bucle de `importar()` a una función `registrarFila(row, ctx)` que devuelva `{ status: 'ok' | 'dup' | 'fail', motivo? }`, para poder reutilizarla desde el wizard sin duplicar la lógica de inserción. Sustituir los `fail++; toast.error(...)` por `fallidas.push({ row, motivo })`.
- Nuevo estado `fallidas: { row: Row; motivo: string }[]` + `wizardOpen`, y el `BatchHandle` de la carga se conserva en estado para que el wizard reutilice el mismo `import_batch_id` y llame de nuevo a `cerrarBatch` con los totales corregidos.
- Nuevo componente compartido `src/components/importacion-fallidas-wizard.tsx`: recibe la lista de fallidas, el callback `onRegistrar(rowEditada)` y renderiza el formulario en un `Dialog` con navegación por índice. Reutiliza `TerceroSelect`, `BankAccountSelect` y `useMesCerradoGuard`.
- Alta de tasa faltante desde el wizard: `insert` en `tasas_bcv` / `tasas_paralela` para esa fecha antes de reintentar; invalidar las queries de tasas.
- Invalidar `transacciones`, `cuentas_por_pagar`, `cuentas_por_cobrar`, `propinas` y saldos al cerrar el wizard.
