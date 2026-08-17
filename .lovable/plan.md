# Líneas en blanco en COGS y cuenta 98 en conciliación

## 1. Qué son las "líneas en blanco" de COGS

Verificado en la base: en julio hay 192 compras (cuenta 2.1) y 28 de ellas tienen proveedor y N° de factura vacíos, por eso se ven como filas en blanco con "—". No vienen del Excel de compras de Xetux: vienen del **importador de movimientos bancarios**. Son pagos categorizados como inventario que no encontraron factura, y se registran con detalle tipo "SIN FACTURA XETUX · COCA COLA FEMSA FACT 30FP0868545" pero sin proveedor ni número de factura en los campos de la transacción.

Son gastos reales (sí deben contar en el COGS del mes), el problema es cómo se crean y cómo se muestran.

### Qué se hará

- Al importar movimientos bancarios sin factura hacia 2.1: extraer del concepto el nombre del proveedor y, cuando el memo contenga "FACT xxxx", el número de factura, y guardarlos en la transacción (enlazando al tercero existente si ya está registrado por nombre similar).
- En la tabla de compras del mes (COGS/Inventarios): si no hay proveedor, mostrar el concepto del movimiento en vez de "—", y marcar la fila con una etiqueta "Banco s/factura" para distinguirla de las compras importadas de Xetux.
- Añadir un filtro/checkbox "Solo compras con factura" en esa tabla, para poder revisar el mes sin esas filas (los totales del mes siguen incluyendo todo).
- Backfill: rellenar proveedor/concepto en las filas ya existentes (las 28 de julio y equivalentes de otros meses) a partir de su campo detalle, sin tocar montos ni fechas.

## 2. Movimientos de cuenta 98 → "No aplica (no contable)" por defecto

Verificado: `cuentaRequiereFactura()` en `src/lib/conciliacion-matching.ts` no contempla las cuentas 98 ni 99, así que un movimiento de operaciones de cambio entra al motor de pareo y termina como "Sin pareo". La pantalla de movimientos bancarios ya sabe pintar 98/99 como "no contable", pero solo cuando el estado ya es "no aplica".

### Qué se hará

- Agregar "98" y "99" a la lista de cuentas que no requieren factura, para que el pareo automático las devuelva directamente como "No aplica".
- Que el importador de movimientos bancarios y el botón "Recalcular pareos" guarden ese estado con la clase "no contable" (no afecta G&P ni Flujo de caja).
- Recalcular el estado de los movimientos de cuenta 98 ya existentes para que queden en "No aplica (no contable)".
- Sigue siendo posible cambiarlo a mano desde el panel de conciliación.

## Detalles técnicos

- `src/lib/conciliacion-matching.ts`: `CUENTAS_SIN_FACTURA` += "98", "99".
- `src/routes/_authenticated/importar-movimientos.tsx`: derivar `tercero_id`/`numero_factura` del concepto para filas sin factura de 2.1; persistir estado `no_aplica` + clase `no_contable` para cuenta 98.
- `src/routes/_authenticated/registrar.tsx` (tabla "Compras del mes"): fallback de proveedor al detalle, badge de origen y filtro "Solo con factura".
- `src/routes/_authenticated/movimientos-bancarios.tsx`: recálculo de pareos respeta la nueva regla de 98/99.
- Actualización de datos existentes (proveedor/factura en 2.1 sin proveedor; estado de conciliación de movimientos 98) mediante una operación de datos, sin cambios de montos.
