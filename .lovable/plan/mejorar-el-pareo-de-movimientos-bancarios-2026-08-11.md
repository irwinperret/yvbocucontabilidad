# Mejorar el pareo de movimientos bancarios

## Problemas detectados

1. **Se cruzan movimientos de egreso contra facturas de venta.** El índice de facturas hoy toma *cualquier* transacción con `numero_factura`, e incluye las 2.125 filas de ventas (1.x), las 2.182 de IVA (12.x) y las 752 de pagos de CxP (13.2). Un pago a proveedor puede quedar "pareado" con una factura de venta.
2. **Las cuentas sin factura igual se parean.** La regla "esta cuenta no requiere factura" se evalúa al final, después de monto/fecha, así que la nómina termina pareada contra facturas ajenas.
3. **Condo + Alquiler (4.10)** hoy se considera que requiere factura, y no la tiene.
4. **No se usa el nombre del proveedor** como señal, aunque suele venir en el memo bancario.

## Cambios

### 1. Solo facturas de compra como candidatas

El universo de facturas para parear pasa a ser únicamente **facturas de compra/gasto**: transacciones con `numero_factura` cuya cuenta sea de COGS o gasto (2.x, 4.x, 5.x, 6.x, 8.x, 9.x, 10.6). Se excluyen explícitamente:

- Ventas (1.x)
- IVA (12.x) y pagos de cuentas por pagar (13.2)
- Nómina (3.x) y transitorios (13.x, 14.x)

Si en el futuro se quisiera conciliar depósitos de ingreso, se haría contra facturas de venta según el signo/cuenta del movimiento; hoy todos los movimientos bancarios importados son egresos, así que solo se usa el lado de compras.

### 2. Las cuentas sin factura nunca se parean (movimientos "standalone")

La regla de "cuenta que no requiere factura" pasa al **primer** lugar: el movimiento queda como **No aplica**, sin sugerencia ni botones de confirmar/rechazar.

Cuentas sin factura (lista ampliada): nómina completa 3.x, financieros 7.x, otros 11.x, impuestos 12.x, transitorios 13.x y 14.x, financiamiento 10.1–10.5 y 10.7, y **4.10 Condo + Alquiler**.

### 3. Nuevo criterio: proveedor parecido + número de factura igual o parecido

Se incorpora el proveedor de la factura (tercero asociado) y se compara con el memo bancario:

- **N° exacto + proveedor parecido** -> Pareado
- **N° exacto sin proveedor identificable** -> Pareado
- **N° parecido** (mismos dígitos con ceros/prefijos distintos, o difiere en un dígito) **+ proveedor parecido** -> Posible pareo
- **Proveedor parecido + monto igual (±1%)** -> Posible pareo
- **Monto igual + fecha ±5 días** -> Posible pareo
- **Proveedor parecido + fecha cercana** -> Posible pareo débil

La comparación de nombres normaliza mayúsculas y acentos, quita sufijos societarios (C.A., S.A., RIF…) y compara por tokens distintivos.

### 4. Prioridad final de las reglas

```text
1. Cuenta sin factura              -> No aplica (corta aquí)
2. N° exacto + proveedor           -> Pareado
3. N° exacto                       -> Pareado
4. N° parecido + proveedor         -> Posible pareo
5. Proveedor + monto igual         -> Posible pareo
6. Monto igual + fecha ±5 días     -> Posible pareo
7. Proveedor + fecha cercana       -> Posible pareo
8. Resto                           -> Sin pareo
```

El motivo mostrado explica qué regla disparó el resultado.

### 5. Corrección retroactiva

Se limpian las confirmaciones guardadas que quedaron mal: se eliminan los registros de conciliación cuyo movimiento pertenece a una cuenta sin factura, y los que apuntan a una factura de venta, IVA o pago de CxP. Como el estado de cada fila se recalcula al abrir la página, el resto de los movimientos queda corregido automáticamente con las nuevas reglas, sin tocar transacciones ni montos.

## Detalle técnico

- `src/lib/conciliacion-matching.ts`: reordenar `parearMovimiento` (no-factura primero), ampliar `PREFIJOS_SIN_FACTURA` con `4.10`, agregar `normalizarProveedor`, `proveedorSimilar`, `numeroSimilar` y usar `FacturaRef.proveedor`.
- `src/routes/_authenticated/movimientos-bancarios.tsx`: la consulta de facturas filtra por cuentas de compra/gasto e incluye `tercero_id`; se cruza con `terceros` para poblar el proveedor, que se muestra en la celda de conciliación y en el Excel.
- Limpieza de datos en `conciliacion_bancaria` (solo borrado de vínculos inválidos). Sin cambios de esquema.
