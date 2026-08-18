Tarjetas de resumen USD BCV en la parte superior del tablero de proveedor

Objetivo
En la página de detalle de cada proveedor (`/_authenticated/proveedores/$id.tsx`), agregar dos tarjetas de resumen clicables que muestren la exposición en dólares BCV (no en bolívares) de:

1. Facturas sin movimiento bancario asignado.
2. Movimientos bancarios sin factura asignada.

Cambios
1. Cálculo de los totales USD BCV
   - Reutilizar `pendienteUsdBcv(c)` del módulo `src/lib/cxp-saldo.ts` para obtener el saldo en USD BCV de cada factura sin movimiento (`facturasSinMov`).
   - Reutilizar `usdBcvDeMov(mv)` —ya existente en el archivo— para obtener el monto en USD BCV de cada movimiento sin factura (`movsSinFacturas`).
   - Sumar ambos conjuntos y formatear con `fmtUsd`.

2. Nuevas tarjetas de resumen
   - Añadir dos `Card`/`CardContent` junto a las tarjetas actuales de la cabecera.
   - Cada tarjeta mostrará:
     - Título: "Facturas sin movimiento (USD BCV)" y "Movimientos sin factura (USD BCV)".
     - Valor: la suma correspondiente en USD BCV.
     - Indicador del número de ítems detrás de cada total.
   - Las tarjetas usarán estilos del sistema (sin colores hardcodeados) y serán clicables (`cursor-pointer` o `role="button"`).

3. Comportamiento al hacer clic
   - Al hacer clic en "Facturas sin movimiento (USD BCV)", la vista se filtra/focaliza para mostrar solo la bandeja de facturas sin movimiento de la derecha (puede aprovechar el estado `filtroEstado` o desplazarse automáticamente a esa sección).
   - Al hacer clic en "Movimientos sin factura (USD BCV)", el filtro de movimientos se ajusta a "Sin facturas" (`filtroEstado = "sin-facturas"`) para mostrar solo los movimientos sin factura asignada.
   - Se añade un modo de deselección para volver a "Todos".

4. Validación
   - Verificar que las sumas coincidan con lo mostrado en la bandeja lateral y en las tarjetas actuales (contadores).
   - Confirmar que al hacer clic se aplica el filtro esperado y no se rompe el drag-and-drop ni los selectores de proveedor.

Archivos a modificar
- `src/routes/_authenticated/proveedores/$id.tsx`
