## Diagnóstico

Encontré **dos bugs** en el flujo de aplicar anticipos contra factura (afecta tanto COGS como Gastos):

### Bug 1 — el saldo del anticipo NO se reduce (causa raíz)

La política RLS de UPDATE sobre `transacciones` es:

```
has_role(admin) OR modo = 'off_balance'
```

Cuando `aplicarAnticiposContraFactura` intenta actualizar `anticipo_aplicado_usd` y `anticipo_estado` del anticipo original (que es `on_balance`), y el usuario **no** es admin, el UPDATE **no afecta ninguna fila pero supabase-js no devuelve error** (sólo cuenta de filas = 0). Por eso el reverso se inserta, pero el saldo queda intacto y el banner sigue mostrando el anticipo completo.

### Bug 2 — la CxP se crea por el monto total de la factura, no el neto

En el flujo de COGS (y también en Gastos), cuando la factura no está pagada se crea una `cuentas_por_pagar` por el **monto total** de la factura, ignorando lo que se aplicó del anticipo. La CxP debería ser `total − anticipo aplicado`.

### No, no espera al cierre de mes

La aplicación es inmediata al guardar la factura. El cierre de mes no toca anticipos.

## Plan de arreglo

### 1. RPC `SECURITY DEFINER` para aplicar el anticipo atómicamente

Crear `public.aplicar_anticipo_a_factura(anticipo_id uuid, aplicar_usd numeric, grupo_id uuid, factura_fecha date, factura_proveedor text, factura_numero text, centro centro_costo)` que:

- Lee el anticipo original (estado, aplicado, montos, tasas, tercero, banco).
- Valida: `aplicar_usd > 0`, `aplicar_usd ≤ saldo`, anticipo no cerrado.
- Inserta el reverso negativo en `transacciones` cuenta 14.2 (mismas tasas del anticipo, `created_by = auth.uid()`, `grupo_transaccion_id = grupo_id`).
- Actualiza `anticipo_aplicado_usd` y `anticipo_estado` (`parcialmente_aplicado` / `aplicado`).
- Todo en una transacción; bypassa RLS porque es SECURITY DEFINER.
- Devuelve `{ reverso_id, nuevo_aplicado_usd, nuevo_estado }`.

`GRANT EXECUTE ... TO authenticated`.

### 2. Reemplazar `aplicarAnticiposContraFactura` para usar el RPC

En `src/lib/anticipos-proveedor.ts`, sustituir el insert + update por una llamada `supabase.rpc('aplicar_anticipo_a_factura', {...})` por cada aplicación. Cualquier error sí se propaga al toast.

### 3. CxP neta del anticipo aplicado

En `src/routes/_authenticated/registrar.tsx`:

- **COGS** (`addCompra`, ~línea 2341): calcular `aplicadoUsd = Σ compraAplicaciones.aplicarUsd`, `aplicadoBs = aplicadoUsd * compraTasaN`, y crear la CxP con `monto_pendiente_bs = montoBs − aplicadoBs`. Si `aplicadoBs ≥ montoBs`, marcar la compra como `pagada = true` y **no** crear CxP.
- **Gastos factura** (flujo equivalente alrededor de línea 1043): mismo ajuste sobre la CxP de gasto.

### 4. Verificación

Después de aplicar la migración + cambios:

- Registrar anticipo de $100 a un proveedor.
- Registrar factura de $150 al mismo proveedor aplicando $100.
- Confirmar en `Activos transitorios → Anticipos a proveedores`: saldo del anticipo = $0, estado `aplicado`.
- Confirmar en `Cuentas por pagar`: CxP por $50, no $150.

### Archivos afectados

- Migración nueva: función `aplicar_anticipo_a_factura` (SECURITY DEFINER).
- `src/lib/anticipos-proveedor.ts` — cambia `aplicarAnticiposContraFactura` para llamar el RPC.
- `src/routes/_authenticated/registrar.tsx` — ajusta creación de CxP en COGS y en Gastos factura.

No requiere cambios en el banner ni en `activos-transitorios.tsx`.
