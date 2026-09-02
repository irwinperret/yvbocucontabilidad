# Marcar facturas como pagadas sin movimiento bancario

En la conciliación por proveedor, la bandeja "Facturas sin movimiento" mezcla dos casos distintos: facturas que aún esperan su pago, y facturas que ya se pagaron pero cuyo movimiento bancario nunca va a aparecer (pago en efectivo, compensación, pago desde otra cuenta no importada, nota de crédito, factura anulada). Hoy no hay forma de sacarlas de esa bandeja sin inventar un pareo falso.

## Qué se agrega

1. **Botón "Marcar como pagada (sin movimiento)"** en cada tarjeta de factura de la bandeja derecha.
2. Al pulsarlo se abre un diálogo corto que pide:
   - **Motivo** (lista): Pago en efectivo · Pago desde cuenta no conciliada · Compensación / nota de crédito · Factura anulada o duplicada · Otro.
   - **Nota libre** opcional y **fecha del pago** (por defecto hoy).
3. La factura queda en estado **Pagada** con saldo cero, se saca de la bandeja y aparece con un distintivo **"Pagada sin movimiento"** (color distinto al de "Pagada" por pareo) junto al motivo al pasar el mouse.
4. **Reversible**: la misma tarjeta ofrece "Deshacer cierre manual", que devuelve la factura a Pendiente con su saldo original y la regresa a la bandeja.
5. Todo queda registrado en auditoría (quién, cuándo, motivo) y solo lo pueden hacer los usuarios admin, igual que el resto de escrituras.

Importante: cerrar una factura así **no crea ninguna transacción de pago**, no toca G&P ni flujo de caja. Es solo un cierre de la cuenta por pagar. Para el caso "el pago sí existe pero no está en el banco importado", ver la recomendación 1.

## Recomendaciones adicionales

1. **Distinguir "cerrada sin efecto contable" de "pagada en efectivo"**: si el pago realmente ocurrió (efectivo/otra cuenta), conviene una segunda opción del diálogo que además registre el pago contable, para que el gasto y la salida de caja queden reflejados. Si prefieres mantener solo el cierre puro (sin asiento), se implementa la versión simple descrita arriba.
2. **Cierre en lote**: casillas de selección en la bandeja para marcar varias facturas viejas de un mismo proveedor de una sola vez, con el mismo motivo.
3. **Filtro y visibilidad**: agregar al filtro de facturas una opción "Pagadas sin movimiento", y una tarjeta de resumen arriba con el total en USD BCV cerrado manualmente, para que nunca quede escondido.
4. **Alerta de antigüedad**: marcar en ámbar las facturas de la bandeja con más de 90 días sin movimiento — suelen ser exactamente las candidatas a cierre manual.
5. **Salida en Excel**: incluir columna "Cierre manual (motivo / usuario / fecha)" en la exportación de conciliación del proveedor.
6. **Protección**: si más adelante llega un movimiento bancario que se quiere parear a una factura cerrada manualmente, el sistema avisa y pide deshacer el cierre primero, para evitar doble conteo.

## Detalle técnico

- Migración en `cuentas_por_pagar`: columnas `cierre_manual boolean not null default false`, `cierre_manual_motivo text`, `cierre_manual_nota text`, `cierre_manual_fecha date`, `cierre_manual_por uuid`, `cierre_manual_at timestamptz`. Sin cambios de RLS (las políticas de admin ya cubren update).
- `src/lib/pareo-cxp.ts`: nuevas funciones `cerrarCxpSinMovimiento()` y `reabrirCxpCerradaManual()` (restaura saldo desde `usd_bcv_factura` y la tasa de la factura). `sincronizarCxpDesdeVinculos()` y `recalcular…` deben **salir temprano** cuando `cierre_manual = true`, para que el recálculo desde vínculos no revierta el cierre.
- `src/routes/_authenticated/proveedores/$id.tsx`: botón + diálogo en la tarjeta de factura, badge "Pagada sin movimiento", nueva rama del filtro, tarjeta de resumen y columna extra en el export; invalidar las queries de conciliación tras cada acción.
- Auditoría con `logAudit` de `src/lib/audit.ts` en cierre y reapertura.
