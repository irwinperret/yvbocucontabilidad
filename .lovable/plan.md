# Alinear la aplicación con el nuevo plan de cuentas

## Qué está pasando (verificado en la base de datos)

Las 273 filas de compras fallan todas con "12.5 …: no se pudo registrar IVA, se revirtió la compra". No es el archivo: **la cuenta 12.5 ya no existe**. El plan de cuentas fue renumerado hoy y ahora el IVA vive en 7.3 (débito, ventas) y 7.4 (crédito, compras). Como cada transacción exige una cuenta válida del plan, la pierna de IVA es rechazada, la compra 2.1 se borra y la fila cuenta como fallida.

El problema es más amplio: **la aplicación tiene códigos de cuenta escritos a mano en más de 20 archivos** y buena parte de ellos ya no existe o, peor, hoy significa otra cosa. Ejemplos verificados: 10.6 (CapEx) ya no existe y ahora CapEx es 5.6; 5.6 antes era otra cosa; 14.2 (anticipos a proveedores) ahora es 9.2; 13.2 (pago de CxP) ahora es 8.2. Hasta que esto se corrija, fallan o se contabilizan mal: importación de compras y ventas, importación de movimientos bancarios, pagos de CxP, anticipos, CapEx, aumento de capital, préstamos, liquidaciones, conciliación, Flujo de caja, Resumen ejecutivo y las funciones internas de la base de datos.

## Qué propongo

### 1. Una sola tabla de equivalencias

Crear un único módulo con el mapa oficial viejo → nuevo y usarlo en todo el sistema, para que un futuro cambio de códigos se haga en un solo lugar.

| Antes | Ahora |
|---|---|
| 12.4 IVA débito · 12.5 IVA crédito | 7.3 · 7.4 |
| 12.1 Pago IVA SENIAT · 12.2 ISLR · 12.3 IMAE | 7.1 · 7.2 · 4.11 |
| 11.1 Ganancia cambiaria · 11.2 Pérdida cambiaria | 6.1 · 6.2 |
| 13.1 Propinas por pagar · 13.2 Pago de CxP · 13.4 Bonos 10% por pagar | 8.1 · 8.2 · 8.3 |
| 14.1 Préstamos al personal · 14.2 Anticipos a proveedores · 14.3 Anticipos de nómina | 9.1 · 9.2 · 9.3 |
| 10.1 … 10.7 (financiamiento, CapEx, depreciación) | 5.1 … 5.7 (mismo orden) |
| 9.3 Agua · 9.4 Internet · 9.5 Teléfono · 9.7 Electricidad · 9.8 Mantenimiento | 3.14 · 3.15 · 3.16 · 3.18 · 4.10 |
| 3.16 Nómina operativa · 3.17 Nómina administración · 3.23 Transporte de personal | 3.1 · 3.3 · 3.5 |
| 4.8 Gastos administrativos (categoría ADM del banco) | 4.1 Gastos oficina |

Hay tres casos que no tienen equivalente evidente en el plan nuevo y los dejo apuntados para confirmarlos contigo antes de tocarlos: **13.3**, **3.24** y las cuentas de **parafiscales / bono de alimentación** que usa el formulario de nómina. Mientras tanto, esas rutas seguirán funcionando como hoy y avisarán claramente si la cuenta no existe.

### 2. Reemplazar los códigos en toda la aplicación

Importar compras y ventas, importar movimientos bancarios e importar ajustes, pagar CxP, anticipos a proveedores, activos transitorios, CapEx, aumento de capital, liquidaciones, préstamos, conciliación y pareo, movimientos bancarios, transacciones, Flujo de caja, Resumen ejecutivo, saldos bancarios, gráficos del panel y exportaciones a Excel.

### 3. Actualizar las reglas internas de la base de datos

Las funciones y validaciones internas también nombran las cuentas viejas (12.5, 14.2, 13.2, 7.2/11.1 del diferencial cambiario): se actualizan a los códigos nuevos para que anticipos, pagos y reversión de importaciones sigan funcionando.

### 4. Red de seguridad

Que un código inexistente deje de perderse en un aviso genérico: el asistente de filas fallidas mostrará el mensaje real de la base de datos, y añadiré una verificación que compare los códigos usados por la aplicación contra el plan vigente.

## Detalle técnico

- Nuevo `src/lib/plan-cuentas-map.ts` con el mapa y helpers (`CUENTA.IVA_CREDITO`, etc.); el resto del código deja de escribir literales.
- Archivos a actualizar: `src/lib/iva-helpers.ts`, `conciliacion.ts`, `conciliacion-matching.ts`, `clasificar-personal.ts`, `account-helpers.ts`, `pareo-cxp.ts`, `cxp-saldo.ts`, `anticipos-proveedor.ts`, `excel-export.ts`, `import-batches.ts`, `home-checklist.ts`, `inventario.functions.ts`; componentes `transaccion-edit-dialog.tsx`, `pareo-manual-dialog.tsx`, `dashboard-charts.tsx`, `pagar-cxp-inline.tsx`; rutas `importar-compras/ventas/movimientos/ajustes`, `registrar`, `transacciones`, `movimientos-bancarios`, `pagar-cxp`, `cxp`, `anticipos-proveedores`, `activos-transitorios`, `capex`, `aumento-capital`, `liquidaciones`, `fc`, `gyp`, `impuestos`, `resumen-ejecutivo`, `saldos-bancarios`, `propinas`, `bonos10`, `diferencial-cambiario`, `proveedores/$id`.
- Migración para `aplicar_anticipo_a_factura`, `enforce_anticipo_iva_rules`, `enforce_anticipo_proveedor_currency`, `purgar_filas_importacion`, `purgar_todo_importado`, `purgar_transacciones_huerfanas`: 12.5→7.4, 14.2→9.2, 13.2→8.2, 7.2/11.1→6.1/6.2.
- `insertIvaLeg` devolverá el error real en vez de `null`, y el wizard de filas fallidas lo mostrará.
- Verificación final: reimportar `COMPRAS_04-01_A_07-31.xls` y confirmar que las 273 filas quedan registradas con su IVA y su cuenta por pagar.
