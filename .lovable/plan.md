# Autocalcular USD recibidos con la tasa paralela

En el formulario de Operaciones de Cambio, cuando la operación es **Compra USD** (se entregan bolívares), el campo "Monto recibido (USD)" se llenará solo con el equivalente a la tasa paralela del día.

## Comportamiento

- Al escribir el monto en Bs entregados, se calcula `USD = Bs / tasa paralela` (2 decimales) y se coloca en el campo de recibido.
- Si no hay tasa paralela para esa fecha, no se autocompleta (el campo queda manual).
- El campo sigue siendo **editable**: si el usuario lo cambia a mano, se respeta su valor y deja de recalcularse hasta que vuelva a modificar el monto entregado o la fecha/tipo.
- Cambiar de tipo (compra/venta) limpia los montos y reinicia el autocálculo.
- La tasa implícita y la diferencia contra el paralelo se siguen mostrando igual; si se acepta el valor sugerido, la diferencia será 0.

## Detalle técnico

Solo cambia `src/components/operaciones-cambio-form.tsx`:

- Añadir un flag `recibidoTocado` para saber si el usuario editó manualmente el campo.
- `useEffect` que, cuando `tipo === "compra"`, `!recibidoTocado`, hay `tasaParalela > 0` y `entregado` es válido, escribe `(nEntregado / tasaParalela).toFixed(2)` en `recibido`.
- `onChange` del input de recibido marca `recibidoTocado = true`; cambios de tipo/fecha lo resetean a `false`.
- Nota de ayuda bajo el campo: "Calculado a tasa paralela — puedes ajustarlo".

Sin cambios de base de datos ni de la lógica de registro.
