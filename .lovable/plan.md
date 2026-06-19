## Objetivo
Asegurar que cada fila de venta importada de Xetux genere TODOS los movimientos contables que correspondan (no solo la línea de ingreso), y dar visibilidad en el preview para detectar discrepancias antes de importar.

Hoy, el código de `importar-ventas.tsx` ya tiene la lógica para insertar IVA, bono de servicio y propina, pero en la base solo existe 1 transacción `referencia='xetux'` sin sus patas anexas — síntoma de que la lógica está fallando silenciosamente o que se está saltando por condicionales (`> 0`) sin que el usuario lo note.

## Cambios

### 1. Preview con desglose por fila
En `src/routes/_authenticated/importar-ventas.tsx`, agregar al preview columnas para IVA USD, Servicio USD y Propina USD, y totales agregados en los badges:
- "IVA total: $X"
- "Servicio total: $Y → bono nómina"
- "Propina total: $Z"

Así el usuario ve antes de importar exactamente qué se va a registrar.

### 2. Inserción atómica garantizada
Reescribir el ciclo de importación de cada fila para que las 4 inserciones (venta principal + IVA 12.4 + bono 3.5/3.10 + propina) se ejecuten siempre que el monto correspondiente sea > 0, dentro del mismo `grupo_transaccion_id`, y reportar en el toast el desglose: "Nuevas: X · IVA: Y · Bonos: Z · Propinas: W · Fallidas: N".

Endurecer los catch: si una pata falla, marcar la fila como `fail` y registrar el error específico ("bono falló", "iva falló") en lugar de un error genérico.

### 3. Dedup correcto para re-importaciones
- Bono: dedup por `(referencia='xetux', cuenta_codigo IN ('3.5','3.10'), numero_factura)` — ya existe, mantener.
- IVA: dedup ya cubierto por `deleteIvaLegsByGrupo` al actualizar.
- Propina: dedup ya cubierto por número de factura/orden.
- Verificar que al **actualizar** una venta existente (cuando ya estaba en BD), también se re-sincronicen bono y propina, no solo el IVA. Hoy solo se re-sincroniza IVA en el path de update.

### 4. Backfill one-shot
Botón nuevo en la página "Reparar importaciones previas" que recorre todas las transacciones con `referencia='xetux'` y `cuenta_codigo` de venta (1.1, 1.2, 1.3, 1.4), y para cada una:
- Si el grupo no tiene pata `12.4` y el archivo original (no disponible) hubiera tenido IVA, advertir.
- Como no tenemos el archivo original guardado, el botón en realidad solo permite **re-importar** el mismo Xetux y la lógica de dedup+update completará lo que falte.

→ Solución más simple: documentar que para reparar imports anteriores hay que **volver a subir el mismo archivo Xetux**; el dedup actualizará la venta y agregará las patas faltantes. Quitar el botón de backfill del plan.

### 5. Bono de servicio: parámetros confirmados
- Cuenta: `3.5` (Bocu) / `3.10` (YV) — sin cambios.
- `metodo_pago: 'efectivo_usd'`, `modo: 'on_balance'` — sin cambios (confirmado por usuario).
- Sin CxP, sin cuenta bancaria. La pata es un gasto que debita directo.

## Archivos a editar
- `src/routes/_authenticated/importar-ventas.tsx` — preview enriquecido, re-sync de bono/propina en path de UPDATE, toast con desglose.

## Verificación
Tras los cambios: subir el mismo archivo Xetux que el usuario importó antes. Confirmar en BD que para cada factura existen hasta 4 filas (venta + IVA si aplica + bono + propina) compartiendo `grupo_transaccion_id`, y el toast reporta el desglose correcto.