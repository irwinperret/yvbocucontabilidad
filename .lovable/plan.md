## Objetivo

Agregar la partida **5.9 — Deliveries Insumos** al plan de cuentas.

## Cómo quedará

- Código: `5.9`
- Nombre: `Deliveries Insumos`
- Grupo: **Operativos** (junto a 5.4–5.8)
- Afecta G&P: sí · Afecta Flujo de caja: sí · Activa: sí
- Orden: 59 (después de Valet Parking, 58)
- Sin restricción de centros de costo, igual que el resto de 5.x

Al quedar activa aparecerá automáticamente en los selectores de cuenta al registrar y editar transacciones, y en el reporte G&P dentro del grupo Operativos.

## Detalles técnicos

Un solo `INSERT` de datos en `public.plan_de_cuentas`; no hay cambios de esquema ni de código.
