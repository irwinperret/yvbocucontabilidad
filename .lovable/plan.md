# Movimientos bancarios duplicados

## Qué encontré (verificado en la base de datos)

Hay dos causas distintas, y el caso de Agrosnacks es la segunda.

**Causa 1 — mismo movimiento importado dos veces (duplicado técnico).**
El control anti-duplicados usa una huella `BANK:<banco>|<fecha>|<referencia>|<monto>` con la referencia tal cual viene del archivo. Si la misma fila aparece dos veces con la referencia escrita distinto (con y sin ceros a la izquierda, con apóstrofe, o vacía/"TD"), la huella cambia y el sistema no la reconoce como repetida.

Ejemplo real: el pago a ANITA BOHN del 27/07 por Bs 55.655,52 quedó registrado dos veces (movimientos 92075 y 92082), uno con referencia `00618476` y otro con `618476`. En total hay **7 pares así (14 movimientos), todos del 27/07/2026**, del lote de movimientos bancarios importado el 17/08.

**Causa 2 — el caso Agrosnacks (1295 y 1325): no es un duplicado técnico.**
Son dos filas distintas del archivo del banco, ambas del 18/05 en Venezolano de Crédito, ambas con el concepto "AGROSNACKS FACT 1295 Y 1325":

```text
mov 91431  18/05  Bs 60.201,48  ref 00418448  → pareado a facturas 1295 y 1325
mov 91465  18/05  Bs 60.027,42  ref 12797505  → sin pareo
```

Como el concepto del banco menciona las mismas facturas, en el tablero del proveedor los dos aparecen juntos y parece que la factura está pagada dos veces. Las facturas 1295 (Bs 46.932,84) y 1325 (Bs 10.694,95) suman Bs 57.627,79, o sea un solo movimiento las cubre. El segundo movimiento es un pago real del banco que o bien corresponde a otras facturas, o fue una transferencia repetida/devuelta en el banco — eso solo lo confirma el extracto.

## Qué propongo hacer

1. **Endurecer la huella anti-duplicados del importador** (`src/lib/conciliacion.ts`): normalizar la referencia quitando ceros a la izquierda, espacios y apóstrofes; y cuando la referencia venga vacía o genérica ("TD", "-"), construir la huella con banco + fecha + monto + concepto normalizado. Así una fila repetida se marca "Ya importada" aunque el banco la escriba distinto.

2. **Detector de posibles duplicados dentro del propio archivo.** Hoy solo se comparan las filas contra lo ya registrado; agregar además la comparación fila contra fila del archivo (misma fecha, banco, monto y referencia normalizada) y marcarlas antes de registrar.

3. **Limpiar los 7 pares ya registrados.** Enviar a *standby* la copia sobrante de cada par (dejando el registro más antiguo), deshaciendo primero cualquier pareo de la copia para que las cuentas por pagar no queden mal saldadas. Quedan recuperables desde el tab de Standby.

4. **Aviso de "posible duplicado" en el tablero del proveedor.** Cuando dos movimientos del mismo proveedor comparten fecha y montos muy parecidos (o el concepto menciona las mismas facturas), mostrar una etiqueta amarilla "posible duplicado" con acciones rápidas: *marcar como no contable / enviar a standby*. Esto cubre justo el caso Agrosnacks sin borrar nada automáticamente.

## Decisión que necesito de ti

Para Agrosnacks: el movimiento **91465 (Bs 60.027,42 del 18/05)** — ¿es un pago real que debe quedar (y buscarle sus facturas), o fue un error del banco/archivo y lo mando a standby? Si prefieres, lo dejo con la etiqueta de "posible duplicado" y tú decides desde el tablero.

## Detalle técnico

- `src/lib/conciliacion.ts`: `limpiarReferencia` + `huellaBancaria` con normalización fuerte y fallback por concepto.
- `src/routes/_authenticated/importar-movimientos.tsx`: dedupe intra-archivo además del dedupe contra base.
- `src/routes/_authenticated/proveedores/$id.tsx`: badge y acciones de "posible duplicado".
- Limpieza de los 14 movimientos vía migración/edición de datos, usando la lógica existente de standby y `pareo-cxp` para deshacer vínculos.
