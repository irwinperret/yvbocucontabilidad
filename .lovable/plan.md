## Diagnóstico

Revisé el código y la base de datos:

**Base de datos** — la función tiene exactamente la firma esperada (verificada vía `pg_get_function_identity_arguments`):

```
aplicar_anticipo_a_factura(anticipo_id uuid, aplicar_usd_bcv numeric, grupo_id uuid, factura_fecha date, factura_proveedor text, factura_numero text, centro centro_costo)
```

No hay overloads viejos.

**Frontend** — sólo hay **un** call site (`src/lib/anticipos-proveedor.ts` líneas 84–92) y ya envía el nombre correcto `aplicar_usd_bcv`. `registrar.tsx` y `pagar-cxp.tsx` pasan por ese helper, no llaman a `supabase.rpc` directo.

Es decir, el código fuente actual ya coincide con la firma del backend. El error `aplicar_usd` que estás viendo viene del **bundle viejo cacheado en el navegador o del schema-cache de PostgREST que no se refrescó** después del último cambio a la función.

## Plan

1. **Forzar reload del schema cache de PostgREST** ejecutando `NOTIFY pgrst, 'reload schema'` vía migration. Esto resuelve el caso en que PostgREST sigue resolviendo la firma vieja aunque la nueva ya esté en la BD.
2. **Verificar enum `centro_costo`** con `SELECT enum_range(NULL::centro_costo)` y compararlo contra los valores que el frontend manda (`opts.centro` viene del form, ya tipado). Documentar valores válidos como comentario en `anticipos-proveedor.ts` para evitar mismatches silenciosos a futuro.
3. **Endurecer el call site** en `src/lib/anticipos-proveedor.ts`: tipar el payload con un objeto literal explícito (sin `as any` sobre toda la llamada, sólo sobre el cliente) para que cualquier futuro cambio de nombre de parámetro rompa el typecheck en vez de fallar en runtime.
4. **Instrucción al usuario**: después de aplicar los cambios, hacer hard-refresh del preview (Ctrl/Cmd+Shift+R) para botar el bundle viejo, e intentar registrar un anticipo aplicándolo contra una factura. Confirmar que ya no aparece el error `schema cache`.

No se modifica la función SQL ni la lógica contable — sólo refresh del cache, verificación del enum, y un type-tightening defensivo en el call site existente.
