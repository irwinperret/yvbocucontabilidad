# Mejorar el pareo de movimientos bancarios

## Problema

Hoy el motor de pareo prueba primero "número de factura en el memo" y "monto + fecha cercana", y solo al final revisa si la cuenta requiere factura. Resultado: un pago de nómina se puede quedar "pareado"/"posible pareo" contra una factura de un proveedor cualquiera solo porque el monto se parece. Además, "Condo + Alquiler" (cuenta 4.10) sí requiere factura según la lógica actual, cuando en la práctica no la tiene.

## Cambios

### 1. Las cuentas sin factura nunca se parean

Mover la regla "esta cuenta no requiere factura" al **primer** lugar de la evaluación. Si la cuenta es de ese tipo, el movimiento queda directamente como **No aplica**, sin sugerencia de factura ni botones de confirmar/rechazar.

Cuentas que no requieren factura (se amplía la lista actual):
- Nómina completa (3.x), incluidos bonos, parafiscales, liquidaciones y anticipos de nómina
- Financieros (7.x), impuestos (12.x), transitorios (13.x, 14.x), financiamiento (10.x), otros (11.x)
- **Nuevo:** 4.10 Condo + Alquiler

### 2. Nuevo criterio: proveedor parecido + número de factura igual o parecido

Se incorpora el nombre del proveedor al pareo. Para cada factura se toma el proveedor (tercero asociado o el texto de la factura) y para cada movimiento el memo bancario. Señales:

- **Número exacto + proveedor parecido en el memo** -> Pareado (alta confianza)
- **Número parecido** (mismos dígitos con ceros/prefijos distintos, o difiere en un dígito) **+ proveedor parecido** -> Posible pareo
- **Proveedor parecido + monto igual (±1%)** aunque no haya número -> Posible pareo
- **Proveedor parecido + fecha cercana (±5 días)** sin monto exacto -> Posible pareo de menor prioridad

La comparación de nombres normaliza mayúsculas/acentos, quita sufijos societarios (C.A., S.A., RIF, etc.) y compara por tokens: coincide si comparten al menos un token distintivo largo o si la similitud supera un umbral.

### 3. Prioridad de las reglas

```text
1. Cuenta sin factura            -> No aplica (corta aquí)
2. N° exacto + proveedor         -> Pareado
3. N° exacto (sin proveedor)     -> Pareado
4. N° parecido + proveedor       -> Posible pareo
5. Proveedor + monto             -> Posible pareo
6. Monto + fecha (±5 días)       -> Posible pareo
7. Proveedor + fecha cercana     -> Posible pareo (débil)
8. Resto                         -> Sin pareo
```

El motivo mostrado en la tabla explica cuál regla disparó el resultado (p. ej. "Proveedor y N° de factura coinciden", "Proveedor parecido y monto igual").

### 4. Detalles visibles en la tabla

- La columna de conciliación muestra el proveedor de la factura sugerida junto al número, fecha y monto, para poder validar de un vistazo.
- Los pareos confirmados manualmente siguen mandando sobre lo automático.

## Detalle técnico

- `src/lib/conciliacion-matching.ts`: reordenar `parearMovimiento`, ampliar `PREFIJOS_SIN_FACTURA` con `4.10`, y agregar utilidades `normalizarProveedor`, `proveedorSimilar` y `numeroSimilar`. El tipo `FacturaRef` ya tiene `proveedor`, se empieza a usar.
- `src/routes/_authenticated/movimientos-bancarios.tsx`: la consulta de facturas incluye `tercero_id` y se cruza con `terceros` (razón social / nombre comercial) para poblar `proveedor` en el índice; se muestra el proveedor en la celda de conciliación y en el Excel exportado.
- Sin cambios de base de datos ni en la tabla `conciliacion_bancaria`.
