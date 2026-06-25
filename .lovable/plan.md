## Objetivo

Centralizar la lógica de borrado de transacciones para detectar relaciones (CxC, CxP, anticipos, grupos) y pedir confirmación explícita antes de hacer borrado en cascada. Reemplazar el `confirm()` y el `eliminar()` actuales por un diálogo unificado.

## Cambios

### 1. Nuevo helper `src/lib/eliminar-transaccion.ts`
Función `analizarBorradoTransaccion(t)` que devuelve:
```ts
{
  transaccionesAEliminar: { id, fecha, cuenta_codigo, descripcion }[],
  cxcAEliminar: { id, cliente, monto_usd, rol: 'venta'|'cobro' }[],
  cxpAEliminar: { id, proveedor, monto_usd, rol: 'factura'|'pago' }[],
  anticipoInfo: { id, proveedor, aplicado_usd } | null,
  propinasAEliminar: number,
  bloqueoMesCerrado: string | null,  // fecha que bloquea
  advertencias: string[],
}
```

Detecciones (todas en paralelo):
- `cuentas_por_cobrar` donde `transaccion_id = t.id` OR `transaccion_cobro_id = t.id` → agregar contraparte (venta o cobro) a `transaccionesAEliminar`.
- `cuentas_por_pagar` donde `transaccion_id = t.id` OR `transaccion_pago_id = t.id` (verificar nombre real de columna) → ídem.
- Si `t.cuenta_codigo` empieza con `14.` → buscar reversos por `grupo_transaccion_id` y advertir si `anticipo_aplicado_usd > 0` (bloquear borrado pidiendo revertir aplicación primero).
- Si `t.grupo_transaccion_id` no es null → traer todos los hermanos del grupo (bono 3.5/3.10, IVA 12.4/12.5, propina 13.1, reversos 14.x) y listarlos como "se eliminarán junto con esta".
- `pareja_off_balance_id` (lógica existente).
- Para cada transacción en la lista, validar `periodo_cerrado(fecha)`; si alguna está cerrada, setear `bloqueoMesCerrado`.

Y función `ejecutarBorradoTransaccion(plan)` que ejecuta en orden:
1. `cuentas_por_cobrar.delete().in('id', cxcIds)`
2. `cuentas_por_pagar.delete().in('id', cxpIds)`
3. `propinas.delete()` por transacción
4. Romper `pareja_off_balance_id` con UPDATE
5. `transacciones.delete().in('id', allIds)`
6. `logAudit` por cada id

Si cualquier paso devuelve error → toast con el mensaje y abortar (Supabase no soporta tx multi-statement desde cliente, pero borrar hijos primero evita FK violations; los pasos previos ya borrados quedan, pero la combinación CxC→transacciones es segura porque CxC tiene FK a transacciones).

### 2. Nuevo componente `src/components/eliminar-transaccion-dialog.tsx`
AlertDialog que recibe el resultado de `analizarBorradoTransaccion` y muestra:
- Título: "Eliminar transacción y registros vinculados"
- Mensaje en lenguaje natural: ej. *"Esta transacción está vinculada a una cuenta por cobrar de Irwin Perret por $60.40. Para eliminarla también se eliminará la cuenta por cobrar y la transacción de venta original."*
- Lista detallada (bullets) de TODO lo que se eliminará: cada transacción (fecha, cuenta, monto), cada CxC/CxP, conteo de propinas.
- Si `bloqueoMesCerrado` → solo botón "Cerrar" con explicación.
- Si `anticipo aplicado` → solo botón "Cerrar" pidiendo revertir aplicación primero (no soportamos auto-revertir aún).
- Botones: **"Eliminar todo"** (destructive) y **"Cancelar"**.

### 3. Refactor `src/routes/_authenticated/transacciones.tsx`
- Reemplazar `eliminar(t)` para que abra el dialog en vez de `confirm()`. El `DeleteButton` actual se sustituye por un botón que setea `dialogTarget` y deja al dialog ejecutar.
- `borrarSeleccionadas` (bulk): correr `analizarBorradoTransaccion` para cada seleccionada, unir resultados, mostrar el mismo dialog con resumen agregado.

### 4. Aplicar en otros puntos donde se borran transacciones
Buscar y reemplazar `confirm` + `transacciones.delete` en:
- `src/routes/_authenticated/cxc.tsx` (si permite borrar cobro)
- `src/routes/_authenticated/cxp.tsx` / `pagar-cxp.tsx`
- `src/routes/_authenticated/anticipos-proveedores.tsx`

Cada uno importará el mismo helper + dialog.

## Detalles técnicos

- No usamos transacción SQL real porque el cliente Supabase no la expone; el orden hijo→padre evita FK errors. Si quisiéramos atomicidad estricta, podríamos crear RPC `eliminar_transaccion_cascada(ids[])` SECURITY DEFINER — **lo dejo como opción**: avísame si lo prefieres en lugar del cascade desde el cliente.
- `logAudit` se llama con snapshot previo (`datos_antes`) para poder reconstruir si fuera necesario.
- Validación de mes cerrado se mantiene vía `periodo_cerrado` RPC ya existente.

## Pregunta para confirmar antes de implementar
¿Prefieres que el borrado en cascada se haga vía **RPC `SECURITY DEFINER`** (atómico, rollback real) o desde el cliente en orden hijo→padre (más simple, ya cubre el 99% de casos)?