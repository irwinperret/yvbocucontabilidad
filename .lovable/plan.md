Voy a corregir la fuente del problema: la vista mensual `v_transacciones_mensual` está calculando `base_usd` y `total_usd` con `tasa_bcv`, aunque la pantalla diga “tasa paralela”.

Plan:
1. Crear una migración que reemplace `v_transacciones_mensual` para calcular:
   - `base_usd = monto_base_bs / tasa_paralela`
   - `total_usd = monto_bs / tasa_paralela`
   - con fallback a `monto_base_usd`, `monto_usd` o BCV solo si falta la tasa paralela.
2. Mantener `base_bs`, `iva_bs`, `total_bs`, filtros por año/mes/centro/modo y permisos actuales de la vista.
3. Verificar que GyP, Dashboard/charts, Propinas y Flujo de caja —que consumen esta vista— pasen a visualizar USD paralelo sin cambiar la estructura visual.
4. Ajustar etiquetas si queda alguna ambigua, pero sin modificar la lógica de registro de transacciones.