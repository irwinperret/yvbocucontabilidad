# Columna "Vía de registro" en Transacciones

Agregar al final de la tabla de Transacciones una columna que indique cómo se creó cada movimiento, e incluirla también en la exportación a Excel.

## Valores

- **Manual** — registrado desde los formularios de la app
- **Importar ventas (Xetux)**
- **Importar compras (Xetux)**
- **Importar movimientos bancarios**

## Cómo se determina

No hace falta cambiar la base de datos: cada flujo ya deja una marca en el campo `referencia` de la transacción.

- `referencia` empieza con `BANK:` → Importar movimientos bancarios
- `referencia` es `xetux` o `xetux-iva` y la cuenta es de compras (2.1, 12.5) → Importar compras
- `referencia` es `xetux` (resto de cuentas: ventas, bono, propinas, 13.1) → Importar ventas
- Cualquier otro caso → Manual

Se muestra como una etiqueta (badge) discreta con color distinto por origen.

## Alcance técnico

- `src/routes/_authenticated/transacciones.tsx`
  - Helper `viaRegistro(t)` que devuelve la etiqueta según las reglas anteriores.
  - Nueva columna final "Vía" en la tabla, con filtro multi-selección igual al de "Registrado por".
  - Agregar la columna "Vía de registro" al final del Excel exportado (ExcelJS), con el mismo texto que se ve en pantalla.

## Nota

Los movimientos históricos que no tengan esas marcas aparecerán como "Manual". Si más adelante quieres una trazabilidad garantizada (no derivada), se puede añadir un campo `origen_registro` en la tabla de transacciones para los registros nuevos.
