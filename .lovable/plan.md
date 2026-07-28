## Objetivo

1. En los formularios de nómina, poder elegir la **fecha de pago** (hoy se calcula sola: día 15 para Q1 o último día del mes para Q2) y que las tasas BCV/paralela sean las de esa fecha.
2. Aclarar en la página que esa fecha es la fecha de pago, no la fecha de captura en el sistema.
3. Al editar una transacción ya registrada, si se cambia la fecha, que las tasas se actualicen a las de la nueva fecha.

## Cambios

### 1. Campo "Fecha de pago" en Nómina (`registrar.tsx`)
Aplica a los dos formularios: "Nómina regular (Bs)" (`NominaRegularForm`) y "Nómina Chef Ejecutivo" (`NominaChefForm`).

- Añadir un input de fecha editable junto a Quincena / Mes / Año, etiquetado **Fecha de pago**.
- Valor inicial: la fecha derivada actual (15 para Q1, último día del mes para Q2).
- Si el usuario cambia Quincena / Mes / Año, la fecha se re-sugiere con esa regla; si el usuario la edita a mano, se respeta su valor hasta que vuelva a cambiar quincena/mes/año.
- El período de nómina (etiqueta "Nómina Quincena 1 Julio 2026") sigue viniendo de Quincena/Mes/Año, de modo que se puede pagar fuera del período sin perder la referencia.
- Las tasas (`useTasaForDate` / `useParalelaForDate`), el `fecha` de las transacciones insertadas y el guard de mes cerrado pasan a usar la fecha de pago elegida.

### 2. Textos aclaratorios
- Nota bajo el campo: "Es la fecha en que se pagó la nómina, no la fecha en que se registra en el sistema. Las tasas BCV y paralela se toman de esta fecha."
- La línea informativa existente pasa a mostrar fecha de pago + tasa BCV + tasa paralela de ese día (hoy solo muestra la paralela).

### 3. Edición: recalcular tasas al cambiar la fecha (`transacciones.tsx`, `EditDialog`)
Hoy el diálogo de edición ya permite cambiar la fecha, pero conserva las tasas originales (y `tasa_paralela` ni siquiera es editable).

- Al cambiar la fecha en el diálogo, consultar la tasa BCV y la paralela de esa fecha (última tasa ≤ fecha, igual que en registro) y precargarlas en los campos.
- Añadir campo editable **Tasa paralela** junto al de tasa BCV, para poder corregirla manualmente; se guarda en `tasa_paralela`.
- Recalcular montos con la nueva paralela: `monto_bs = monto_usd × tasa_paralela` (fallback BCV si no hay paralela), manteniendo el desglose base/IVA actual.
- Mostrar un aviso dentro del diálogo cuando la fecha cambió: "Se aplicarán las tasas del DD/MM/AAAA (BCV x, paralela y)".
- La propagación al grupo (checkbox existente) incluye también `tasa_paralela` y el recálculo de `monto_usd`/`monto_bs` de los hermanos con la nueva tasa.
- Se mantienen las validaciones de mes cerrado ya existentes (no se puede editar si el período origen o destino está cerrado).

## Detalle técnico

- `src/routes/_authenticated/registrar.tsx`: en `NominaRegularForm` (≈2259) y `NominaChefForm` (≈2504), sustituir la constante derivada `fecha` por estado `fechaPago` + flag `fechaTocada` con re-sugerencia al cambiar quincena/mes/año.
- `src/routes/_authenticated/transacciones.tsx`: en `EditDialog` (≈1152), añadir estado `tasaPar`, un efecto que al cambiar `fecha` consulte `tasas_bcv` y `tasas_paralela` (última ≤ fecha) y actualice ambos campos, e incluir `tasa_paralela` en el patch y en la propagación.
- Sin cambios de base de datos ni de lógica contable (cuentas, splits 20/80, conversión Bs↔USD se mantienen).
