## Objetivo

Permitir crear, editar y eliminar registros **solo a estos 3 usuarios**:

- irwinperret@hotmail.com
- irwinperret@gmail.com
- castillo_iris@yahoo.com

Los demás usuarios registrados (cristobalperret@gmail.com, aeloynaz@gmail.com) y cualquier futuro usuario nuevo quedarán en **modo solo lectura**: pueden ver reportes y datos, pero no modificar nada.

## Estado actual

- Los roles ya existen en el sistema (`admin` / `usuario`).
- Solo **irwinperret@hotmail.com** es admin hoy (fue el primer usuario). Los otros 4 son `usuario`.
- Algunas tablas ya exigen rol `admin` para escribir (cuentas bancarias, cierres, plan de cuentas), pero **muchas tablas críticas permiten escritura a cualquier usuario autenticado**: transacciones, CxC, CxP, préstamos, propinas (insert), inventario (insert), tasas BCV/paralela (insert), terceros, xetux_payment_map. Ahí es donde se filtran los usuarios "solo lectura" actuales.

## Cambios

### 1. Promover a los 2 usuarios faltantes al rol `admin`

- irwinperret@gmail.com → admin
- castillo_iris@yahoo.com → admin

Los otros usuarios existentes se quedan como `usuario` (solo lectura).

### 2. Endurecer las políticas RLS de escritura

Reescribir todas las políticas de INSERT / UPDATE / DELETE de las tablas de datos para exigir `has_role(auth.uid(), 'admin')`. SELECT se mantiene abierto a cualquier autenticado para que el rol `usuario` pueda seguir viendo los reportes.

Tablas afectadas:
`transacciones`, `cuentas_por_cobrar`, `cuentas_por_pagar`, `prestamos`, `propinas`, `inventario_snapshots`, `tasas_bcv`, `tasas_paralela`, `terceros`, `xetux_payment_map`, `ajustes_bancarios`.

Las tablas que ya requerían admin (cuentas bancarias, cierres de mes, plan de cuentas) se dejan igual.

### 3. Nuevos usuarios que se registren en el futuro

Se quedan automáticamente con rol `usuario` (comportamiento actual del trigger `handle_new_user`) → **solo lectura por defecto**. Si más adelante quieres darle permisos de edición a alguien nuevo, se hace promoviéndolo a `admin` manualmente.

## Consideraciones

- **No se toca el frontend.** Los botones de "Guardar / Eliminar / Editar" seguirán visibles para los usuarios de solo lectura, pero al intentar guardar recibirán un error de permisos de la base de datos. Si prefieres que la UI oculte esos botones para los no-admins, dímelo y lo agrego como paso adicional.
- No hay revocación de sesiones activas: si alguno de los usuarios "solo lectura" tiene la app abierta ahora, deja de poder escribir en cuanto se aplique la migración.
- El cambio se hace en una sola migración SQL que tendrás que aprobar.
