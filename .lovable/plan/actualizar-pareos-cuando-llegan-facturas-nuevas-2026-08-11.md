# Actualizar pareos cuando llegan facturas nuevas

## Situación actual (verificada en el código)

El pareo automático no está "congelado": se recalcula cada vez que se abre el tab de Movimientos bancarios, comparando cada movimiento contra las facturas que existan en ese momento. Es decir, si el movimiento se cargó primero, al importar después las compras de Xetux el pareo automático **sí** aparece al recargar la página.

Lo que sí queda desactualizado son tres casos:

1. **Movimientos rechazados.** Si rechazaste una sugerencia (porque en ese momento no había factura o la sugerida era incorrecta), ese rechazo es permanente: el movimiento queda "Sin pareo" para siempre, aunque después llegue la factura correcta.
2. **Pareos parciales confirmados.** Si confirmaste 2 de 3 facturas, al llegar la tercera no se agrega sola: el movimiento sigue mostrándose como parcial hasta que lo edites a mano.
3. **La pantalla no se refresca sola** después de una importación: hay que salir y volver a entrar para ver los pareos nuevos.

## Propuesta

### 1. Botón "Recalcular pareos" en Movimientos bancarios

Un botón que revisa todos los movimientos visibles (respetando los filtros) contra el estado actual de facturas y muestra un resumen antes de aplicar nada:

- X movimientos sin pareo que ahora tienen factura sugerida
- X movimientos rechazados cuya sugerencia cambió (ahora hay otra factura candidata)
- X pareos parciales que ahora se pueden completar

Desde ese resumen se puede aplicar todo, o solo un grupo. Regla de seguridad: **nunca se pisa un pareo manual confirmado**; los rechazos se levantan solo cuando la nueva sugerencia es distinta de la que se rechazó.

### 2. Auto-completar parciales

Al recalcular, si un movimiento parcial tiene facturas nuevas cuyo número aparece en el memo del banco y con eso la suma cuadra con el monto (±1%), se agregan esas facturas y el movimiento pasa a "Pareado", marcado como automático.

### 3. Reversar rechazos obsoletos

El rechazo deja de ser un "no aplica nunca" y pasa a ser "rechazo de esta sugerencia": se guarda contra qué facturas se rechazó. Si más tarde aparece una sugerencia con facturas distintas, el movimiento vuelve a mostrarse como "Posible pareo" en vez de quedar enterrado.

### 4. Refresco automático tras importar

Al terminar una importación de compras Xetux (o de movimientos bancarios), se invalidan los datos en caché y se ofrece un aviso con enlace directo: "Se importaron N facturas — Revisar pareos". Al entrar, el recálculo ya viene corrido.

## Detalles técnicos

- `conciliacion_bancaria`: en filas con `estado = 'rechazado'` se guardarán los ids de las facturas rechazadas (columna `facturas_rechazadas uuid[]`, por defecto vacío) para poder distinguir "rechacé esta sugerencia" de "este movimiento no va con nada".
- `src/routes/_authenticated/movimientos-bancarios.tsx`: nuevo botón + diálogo de resumen; el cálculo reutiliza `parearMovimiento` / `coberturaPareo` ya existentes y escribe con `guardarVinculosConciliacion`, en lotes.
- `src/lib/conciliacion-matching.ts`: helper `recalcularPareos(movimientos, indice, vinculos)` que clasifica cada movimiento en "nuevo pareo", "parcial completable", "rechazo obsoleto" o "sin cambio"; sin efectos secundarios, para poder previsualizarlo.
- `src/lib/conciliacion.ts`: en la lógica de rechazo, persistir las facturas rechazadas.
- `src/routes/_authenticated/importar-compras.tsx` y `importar-movimientos.tsx`: `queryClient.invalidateQueries` de movimientos/facturas/vínculos + toast con enlace a Movimientos bancarios.
- No cambia cómo se importan ni contabilizan las transacciones; solo el pareo y su visualización.
