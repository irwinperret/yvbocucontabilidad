# Arreglar las 273 fallas al importar compras (IVA)

## Qué está pasando (verificado en la base de datos)

Todas las filas fallan con el mismo mensaje: "12.5 …: no se pudo registrar IVA, se revirtió la compra".

La causa no es el archivo: **las cuentas 12.4 y 12.5 ya no existen en el plan de cuentas**. Hoy el plan tiene, en el grupo Impuestos:

- 7.3 — IVA débito fiscal cobrado (ventas)
- 7.4 — IVA crédito fiscal pagado (compras)

Como cada transacción exige una cuenta válida del plan, la pierna de IVA con código 12.5 es rechazada, la compra 2.1 se borra y la fila se cuenta como fallida. Por eso fallan las 273: la compra se inserta bien y el IVA no.

Verificado además: no existe ninguna transacción registrada con 12.4, 12.5, 7.3 ni 7.4, así que no hay historial que migrar ni riesgo de romper datos.

## Qué propongo

Alinear la aplicación con el plan de cuentas actual: usar **7.3 para IVA de ventas** y **7.4 para IVA de compras** en todo el sistema, en lugar de 12.4 / 12.5.

Con eso, la importación de compras vuelve a registrar la compra + su IVA + la cuenta por pagar, y la pestaña de Impuestos sigue mostrando el IVA débito/crédito y el neto a declarar (con las etiquetas de cuenta actualizadas).

## Detalle técnico

Reemplazar 12.4 → 7.3 y 12.5 → 7.4 en:

- `src/lib/iva-helpers.ts` (`insertIvaLeg`, `deleteIvaLegsByGrupo`, `calcularSplitIvaPagoCxp`)
- `src/routes/_authenticated/impuestos.tsx` (consulta, clasificación y textos visibles)
- `src/routes/_authenticated/importar-compras.tsx` e `importar-ventas.tsx` (mensajes de error y filtros)
- `src/lib/pareo-cxp.ts`, `src/lib/conciliacion.ts`, `src/lib/autocomplete-hooks.ts`
- `src/routes/_authenticated/registrar.tsx`, `transacciones.tsx`, `pagar-cxp.tsx`, `importar-movimientos.tsx`

Además, hacer que `insertIvaLeg` devuelva el error real en lugar de `null`, para que el aviso de fila fallida muestre el motivo exacto (hoy oculta el mensaje de la base de datos) y este tipo de problema se diagnostique de inmediato.

Después: reimportar `COMPRAS_04-01_A_07-31.xls` y confirmar que las 273 filas quedan registradas.
