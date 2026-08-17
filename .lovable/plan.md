# Importar Ajustes + reorganización del menú Registro

## 1. Nueva página "Importar ajustes"

Nueva ruta `/importar-ajustes` con el mismo estilo de las demás importaciones (subir archivo → previsualizar → confirmar → resumen).

Lectura del Excel (hoja `todo`):
- Fila 2: fechas, una por columna.
- Fila 14 ("Venta Lista") + fila 15 ("IVA Lista") = **Ajuste a Ventas** (la fila 15 se suma como monto normal, no como IVA).
- Fila 16 ("Servicio Lista") = **Otros Bonos**.
- Se ignoran columnas cuyos tres valores sean 0 o vacíos.

Transacciones creadas por cada fecha con valores:
- 20% del ajuste de ventas → cuenta **1.1 Ventas contado YV** (centro YV)
- 80% del ajuste de ventas → cuenta **1.2 Ventas contado Bocú** (centro Bocú)
- Servicio Lista → cuenta **3.14 Otros Bonos** (centro Compartido)

Conversión (los valores del Excel son USD BCV, la variable independiente):
- `monto_bs = valor_usd_bcv × tasa_bcv_del_día`
- `monto_usd = monto_bs ÷ tasa_paralela_del_día`
- Ambas tasas se toman de la fecha de la columna, con la regla de tasa vigente que ya usa el sistema.

Reglas adicionales:
- `referencia = 'ajuste'`, sin IVA, modo on_balance, método de pago igual al que ya usan los ajustes de ventas.
- Si una fecha ya tiene transacciones con `referencia = 'ajuste'`, se omite (no duplica) y se marca "ya registrada" en la vista previa.
- Se bloquean fechas de meses cerrados con la advertencia habitual.

Vista previa antes de confirmar: tabla por fecha con Venta Lista, IVA Lista, total ajuste, split YV/Bocú, Servicio Lista, tasas BCV/paralela, montos en Bs y USD, y estado (Nueva / Ya registrada / Sin tasa).

Al confirmar: se crea un lote en **Historial de importaciones** (tipo `ajustes`) para poder revertirlo igual que las demás importaciones, y se muestra un resumen: fechas registradas, fechas omitidas y totales en Bs/USD.

## 2. Menú lateral de Registro en 3 secciones

1. **Importar Archivos** (colapsable, abierta por defecto en modo Registro):
   - Importar ventas (Xetux)
   - Importar compras (Xetux)
   - Importar movimientos bancarios
   - Importar ajustes
   - Historial de importaciones
2. **Registrar Movimiento** — ítem único sin submenú, va directo al formulario.
3. **Gestión** — sin cambios, con todos sus sub-ítems actuales.

Se conserva "Inicio" arriba y el mismo estilo visual (chevron, sangría, estado activo) de las secciones colapsables actuales.

## Notas técnicas

- Nuevo archivo `src/routes/_authenticated/importar-ajustes.tsx`, reutilizando `xetux-parse` (lectura AOA), `src/lib/tasas.ts` para tasas, el guard de mes cerrado y el registro de lote en `importaciones`.
- La reversión usa el mecanismo existente (`revertir_importacion` por `import_batch_id`); las transacciones se insertan con `import_batch_id` del lote.
- `src/components/app-sidebar.tsx`: se agrega el estado `importarOpen` (default `true`) y se reagrupan los arreglos de ítems.
