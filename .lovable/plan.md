# Arreglos en Movimientos bancarios y pareo con facturas Xetux

Cuatro cambios: quitar el error al confirmar/rechazar, dejar de marcar "No aplica" pagos que sí tienen factura, introducir el pareo parcial, y añadir el filtro de fechas estilo Transacciones.

## 1. Error "no unique or exclusion constraint matching the ON CONFLICT"

La tabla de conciliación tiene su índice único definido sobre una expresión (`COALESCE(factura, ceros)`), así que cualquier guardado que use "insertar o actualizar si ya existe" falla con ese mensaje.

- Reemplazar ese índice por uno normal sobre (movimiento, factura) que trate los nulos como iguales, de modo que el guardado tenga siempre una clave válida.
- Unificar el guardado de pareos (tab Movimientos bancarios y tab Cuentas por pagar) en una sola función que borre los vínculos previos del movimiento y escriba los nuevos en una operación, mostrando el error real si algo falla.

## 2. Pagos que salen como "No aplica" teniendo factura (caso ANITA BOHN)

Confirmado en los datos: ese movimiento quedó registrado en la cuenta **13.2 (pago de cuentas por pagar)**, y hoy la regla trata toda la familia 13.x como "cuenta que no requiere factura". Justamente 13.2 y 14.2 (anticipos a proveedor) son los pagos que sí deben cruzarse contra facturas de compra. La factura 9195 del proveedor existe en el sistema por el monto exacto del pago.

- Sacar 13.2 y 14.2 de la lista de cuentas "sin factura": pasan a ser candidatas normales de pareo.
- Mantener como "No aplica" solo lo que realmente nunca lleva factura (nómina 3.x, financieros, impuestos, transitorios, Condo + Alquiler).

### Columna "Proveedor (si aplica)"

- Nueva columna en la tabla (y en el Excel) con el proveedor del movimiento.
- Se obtiene en este orden: (a) el proveedor ya asociado al movimiento cuando existe —los 297 pagos 13.2 y 152 anticipos 14.2 ya lo traen—; (b) si no, se adivina comparando el texto del concepto bancario (columna F del archivo importado, que se guarda en las notas) contra el listado de proveedores, con tolerancia a acentos, sufijos ("C.A.", "S.R.L.") y coincidencias parciales.
- Se muestra si fue tomado del registro o adivinado del memo, y las facturas candidatas se restringen primero a ese proveedor: eso mejora directamente la calidad del pareo.
- Filtro por proveedor en la tabla.

## 3. Pareo parcial

Hoy un movimiento que identifica 2 de 3 facturas se muestra como "Pareado". Se añade un estado intermedio:

- **Pareado** — las facturas vinculadas suman el monto del movimiento (tolerancia 1%).
- **Pareado parcial** — hay facturas vinculadas, pero suman menos (o más) que el movimiento. Se muestra el monto cubierto, el remanente y un aviso de cuántos números del memo no se pudieron ubicar.
- El estado parcial aparece como KPI arriba, en el filtro de estados y en el Excel.
- Desde una fila parcial se puede seguir agregando facturas sin perder las ya confirmadas.

## 4. Filtro de fechas estilo Transacciones

Reemplazar los dos campos sueltos de fecha por el mismo bloque del tab Transacciones: Desde / Hasta más botones de rango rápido (Hoy, Esta semana, Este mes, Mes anterior, Este año, Todo), con chips de filtros activos y botón para limpiar todo.

## Detalles técnicos

- Migración: sustituir `conciliacion_bancaria_mov_fact_uq` por `CREATE UNIQUE INDEX ... (transaccion_bancaria_id, transaccion_factura_id) NULLS NOT DISTINCT`; ampliar el CHECK de `estado` para admitir `parcial` (por si se quiere persistir) manteniendo `pareado`/`rechazado`/`pendiente`.
- `src/lib/conciliacion-matching.ts`: quitar `13.` y `14.` de `PREFIJOS_SIN_FACTURA` (dejar 13.1 como sin factura), añadir `EstadoConciliacion = "parcial"`, exponer `proveedorDeMemo(memo, terceros)` y calcular cobertura (`total pareado` vs `monto movimiento`) dentro de `parearMovimiento`.
- `src/routes/_authenticated/movimientos-bancarios.tsx`: cargar `terceros` y el `tercero_id` del movimiento, columna Proveedor + filtro, presets de fecha, KPI y badge de parcial, columnas nuevas en `exportTableToExcel`, y `guardarVinculo` unificado.
- `src/routes/_authenticated/cxp.tsx`: usar la misma función de guardado y reflejar el estado parcial.
- No se cambia cómo se importan ni se contabilizan los movimientos; solo el pareo y su visualización.
