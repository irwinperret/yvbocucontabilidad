## 1) Migración Supabase (un solo paso)

```sql
-- Renombrar códigos viejos a nuevos códigos en transacciones (FKs se actualizan por update directo)
-- Paso A: insertar las nuevas cuentas 12.4 y 12.5 (con grupo Impuestos)
UPDATE plan_de_cuentas SET codigo='12.4', grupo='Impuestos', orden=1204,
       afecta_gyp=false, afecta_fc=true, nombre='IVA débito fiscal cobrado'
 WHERE codigo='1.9';
UPDATE plan_de_cuentas SET codigo='12.5', grupo='Impuestos', orden=1205,
       afecta_gyp=false, afecta_fc=true, nombre='IVA crédito fiscal pagado'
 WHERE codigo='2.3';

-- Propagar cambio de código en transacciones existentes
UPDATE transacciones SET cuenta_codigo='12.4' WHERE cuenta_codigo='1.9';
UPDATE transacciones SET cuenta_codigo='12.5' WHERE cuenta_codigo='2.3';

-- Unificar grupo de 11.1 (queda solo)
UPDATE plan_de_cuentas SET grupo='Otros', orden=1101 WHERE codigo='11.1';

-- Desactivar 11.2 (mantener históricas; no se borra)
UPDATE plan_de_cuentas SET activa=false WHERE codigo='11.2';
```

Resultado: el grupo "IVA" desaparece, 12.4/12.5 entran al grupo Impuestos, 11.1 queda solo en grupo "Otros", 11.2 queda inactiva pero sus transacciones históricas mantienen integridad referencial.

## 2) Refactor de código — referencias a códigos viejos

**`src/lib/iva-helpers.ts`** — cuenta de pierna IVA: `"1.9"` → `"12.4"`, `"2.3"` → `"12.5"`. Actualizar comentarios.

**`src/lib/autocomplete-hooks.ts`** (línea 20) — filtro `.not("cuenta_codigo", "in", "(1.9,2.3)")` → `"(12.4,12.5)"`.

**`src/routes/_authenticated/importar-ventas.tsx`** (líneas 308, 313, 381, 415) — toda referencia a `"1.9"` → `"12.4"`.

**`src/routes/_authenticated/importar-compras.tsx`** (líneas 257, 295) — referencias `"2.3"` → `"12.5"`.

**`src/routes/_authenticated/transacciones.tsx`** (líneas 168, 169, 173) — excluir `["12.4","12.5"]` en lugar de `["1.9","2.3"]` para no doble-contar IVA en totales.

**`src/routes/_authenticated/registrar.tsx`** (línea 450) — diferencial cambiario: `esGanancia ? "11.1" : "11.2"` → ahora solo registra `"11.1"` cuando es ganancia. Si es pérdida, lanzar `toast.error("Pérdida cambiaria ya no se registra: cuenta 11.2 fue eliminada")` y abortar.

**`src/routes/_authenticated/cxc.tsx`** (línea 57) — misma lógica: solo permitir ganancia (11.1), bloquear pérdida con mensaje.

**`src/routes/_authenticated/registrar.tsx` — Gastos/Facturas dropdown** (revisar `GastosForm` para el optgroup "Impuestos"): asegurar que 12.1, 12.2, 12.3, 12.4 y 12.5 aparezcan todas como opciones. Hoy el dropdown filtra por `grupo === "Impuestos"`, así que tras la migración 12.4/12.5 aparecen automáticamente; verificar que no haya filtro adicional que las excluya.

**`src/components/dashboard-charts.tsx`** (línea 66) — la lógica `r.cuenta_codigo === "11.1"` (ganancia cambiaria suma a ingresos) se mantiene; solo verificar que el grupo "IVA" ya no aparezca en el donut de gastos operativos (ahora cae bajo Impuestos automáticamente).

**`src/lib/account-helpers.ts`** — si exporta `CENTROS`/`GRUPOS` con "IVA", removerlo; mantener "Otros" y "Impuestos".

## 3) Plan de cuentas (display)

`src/routes/_authenticated/plan-cuentas.tsx` agrupa por `grupo` directamente desde la DB, así que **no requiere cambios de código**: tras la migración mostrará automáticamente:
- Impuestos: 12.1, 12.2, 12.3, 12.4, 12.5
- Otros: 11.1
- (sin grupo "IVA")
- 11.2 oculta porque mostramos solo `activa=true`? Revisar — actualmente muestra todas. Filtrar por `activa=true` o mostrar inactivas con badge "off" gris (ya lo hace). Mantener comportamiento actual: 11.2 aparece con badge "off".

## 4) Diferencial cambiario por cobros (decisión de producto)

Como 11.2 queda inactiva, las pérdidas cambiarias por cobros ya no son registrables. Esto afecta:
- `registrar.tsx` → form de diferencial cambiario: bloquear pérdidas
- `cxc.tsx` → auto-registro al cobrar: solo crear leg si es ganancia; si es pérdida, omitir y dejar nota en notas de la transacción de cobro

Asumo que es lo que quieres (pediste eliminar 11.2). Si querías que las pérdidas migraran a otra cuenta, dímelo.

## Archivos afectados

- migración DB (nueva)
- `src/lib/iva-helpers.ts`
- `src/lib/autocomplete-hooks.ts`
- `src/lib/account-helpers.ts` (si aplica)
- `src/routes/_authenticated/importar-ventas.tsx`
- `src/routes/_authenticated/importar-compras.tsx`
- `src/routes/_authenticated/transacciones.tsx`
- `src/routes/_authenticated/registrar.tsx`
- `src/routes/_authenticated/cxc.tsx`
- `src/components/dashboard-charts.tsx` (verificación)
