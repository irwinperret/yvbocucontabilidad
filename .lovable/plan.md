## Objetivo

En el tab **CapEx**, la tabla "Detalle" hoy es solo de lectura. Se hará que cada fila se pueda editar con el mismo formulario que ya se usa en **Transacciones**, de modo que cualquier cambio quede guardado en la misma transacción y se vea inmediatamente en el tab de Transacciones (y en el resto de reportes).

## Cómo funcionará

- Cada fila del Detalle tendrá un botón de editar (ícono de lápiz) al final.
- Al pulsarlo se abre exactamente el mismo diálogo que en Transacciones: fecha, centro, monto USD, tasa BCV, tasa paralela, método de pago, N° factura, N° orden, referencia, notas, detalle, cuenta bancaria y **categoría CapEx**.
- Se mantienen todas las reglas ya existentes: bloqueo si el mes está cerrado, recálculo de tasas al cambiar la fecha, registro en auditoría y propagación al grupo cuando aplica.
- Al guardar, se refrescan tanto la tabla de CapEx (totales, gráficos y detalle) como la lista de Transacciones.

## Detalles técnicos

1. Extraer el componente `EditDialog` de `src/routes/_authenticated/transacciones.tsx` a un archivo compartido, por ejemplo `src/components/transaccion-edit-dialog.tsx`, sin cambiar su lógica. `transacciones.tsx` pasa a importarlo.
2. En `src/routes/_authenticated/capex.tsx`:
   - Ampliar el `select` de la consulta `capex-list` para traer todos los campos que el diálogo necesita (`cuenta_codigo`, `iva_aplica`, `monto_base_bs`, `iva_bs`, `numero_orden`, `detalle`, `cuenta_bancaria_id`, `grupo_transaccion_id`, etc.) — en la práctica, `select("*")`.
   - Añadir columna de acción con botón de editar y estado local `editing`.
   - Al guardar, invalidar las queries `capex-list`, `opex-by-group` y `transacciones-list` para que ambos tabs queden sincronizados.
3. Los permisos de escritura siguen controlados por las reglas de la base de datos (solo administradores), sin cambios.
