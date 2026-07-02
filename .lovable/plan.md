## Problema

El parser de "Lista de Facturas" de Xetux (`src/routes/_authenticated/importar-compras.tsx`) usa columnas incorrectas para IVA y neto:

- **IVA actual**: solo columna M (`row[12]` – Impuestos). Falta N (`ImpAdic`) y O (`ImpRet`).
- **Neto actual**: columna I (`row[8]` – "Neto" pre-descuentos) con fallback a `total − iva`. No aplica descuento global ni suma cargos adicionales.
- **Total actual**: columna R (`row[17]` – TotalConCargos), con fallback a P (`row[15]` – Total).

## Cambios

En `onFile` (líneas ~88-105) reemplazar la lógica de cálculo por lo que el usuario especificó (todos los valores ya vienen en USD BCV):

```ts
// Columnas 0-indexadas (Excel → índice):
// K=10 DescGlobal · L=11 Subtotal · M=12 Impuestos · N=13 ImpAdic · O=14 ImpRet · Q=16 CargosAdic
const descGlobal  = numFromCell(row[10]);
const subtotal    = numFromCell(row[11]);
const impuestos   = numFromCell(row[12]);
const impAdic     = numFromCell(row[13]);
const impRet      = numFromCell(row[14]);
const cargosAdic  = numFromCell(row[16]);

const iva   = impuestos + impAdic + impRet;      // M + N + O
const neto  = Math.max(0, subtotal + cargosAdic - descGlobal); // L + Q − K
const total = neto + iva;
```

Actualizar también el comentario de mapeo de columnas para que refleje que ahora se usan K, L, M, N, O y Q.

Mantener sin cambios: `total <= 0` como filtro de fila vacía, dedup por `(tercero, numero_factura)`, cálculo de USD paralelo (`Bs = usd_bcv × tasa_bcv`, luego `Bs / tasa_paralela` para el USD contable) — todo eso sigue funcionando; solo cambian los tres valores base leídos de la fila.

## No incluye

- **Backfill retroactivo** de compras Xetux ya importadas con la fórmula antigua. Si el usuario lo necesita, es un paso aparte (re-importar el reporte del período o migración SQL) — puedo abordarlo después de confirmar el fix con una prueba real.
- **Cierre de mes / cuenta 2.1 / 2.2**: la corrección anterior sigue vigente. Solo se corrige el parser.

## Verificación sugerida

Después del cambio: subir un reporte reciente y comparar en la tabla de vista previa que `neto_usd + iva_usd = total_usd = columna R` para 2-3 filas, y que el IVA coincida con M+N+O.
