## Problema

En `VentasForm` (`src/routes/_authenticated/registrar.tsx`), cuando registras una venta a crédito en bolívares, el USD contable se está calculando dividiendo entre la **tasa BCV** en lugar de la **tasa paralela**. Como la BCV es menor, el USD resultante queda inflado (igual al "USD BCV") en vez de ser el USD real al paralelo (que es menor).

Esto contradice la regla del proyecto: todas las conversiones Bs→USD se hacen a tasa paralela; la BCV solo se guarda como referencia fiscal.

### Causa exacta

- Línea 152: `usaBCV = tipo === "credito" || tipo === "cobro"`.
- Línea 203: `tasaConvN = usaBCV ? (tasaN || tasaBcvN) : (tasaParalelaN || tasaN)` → para crédito, `tasaConvN` es la BCV.
- Línea 220 (`convertInput`, rama Bs): `usd = n / tasaConvN` → divide entre BCV.
- En el insert (línea 470) se guarda `tasa_bcv: tasaN` (BCV, correcto como referencia), `tasa_paralela: paralelaSugerida?.tasa` (correcto), pero `monto_usd: baseUsd` quedó calculado a BCV.
- La CxC creada (líneas 498-499) hereda el mismo `baseUsd` inflado.

## Fix

Cambiar `convertInput` para que la conversión Bs→USD use siempre la tasa **paralela** (con fallback a BCV solo si no hay paralela ese día), independientemente de `usaBCV`. El input editable `tasa` y el campo `tasa_bcv` del insert siguen siendo BCV en crédito — eso es correcto y no se toca.

Cambio puntual en la rama Bs de `convertInput` (línea 220):

```ts
// antes:
return { bs: n, usd: tasaConvN ? n / tasaConvN : 0 };
// después:
const tasaUsd = tasaParalelaN || tasaBcvN; // paralela; fallback BCV
return { bs: n, usd: tasaUsd ? n / tasaUsd : 0 };
```

Con esto:
- Venta a crédito en Bs → `baseUsd` e `ivaUsd` se calculan a paralela (USD menor, correcto).
- La transacción guarda `tasa_bcv` = BCV (input), `tasa_paralela` = paralela del día, `monto_usd` = base/paralela.
- La CxC (`monto_usd`, `monto_pendiente_usd`) queda al USD paralelo correcto, consistente con cómo luego se cobra y se calcula la diferencia cambiaria (que ya usa `tasaConvN` paralela en el cobro porque ahí `usaBCV` también es true pero el cobro de crédito anterior trabaja en USD digitado directo).
- El recuadro informativo "Base USD BCV / IVA USD BCV" sigue mostrando el equivalente a BCV como referencia visual (ya usa `base / tasaBcvN` directamente).

## Alcance / fuera de alcance

- Solo se modifica la línea 220 de `convertInput`. Sin tocar UI, labels, ni la lógica de "Cobro de crédito anterior" (esa pestaña tiene su propio flujo en USD).
- No se migran datos históricos. Las ventas a crédito ya registradas con el `monto_usd` inflado se quedan como están; si quieres que las recalcule, dímelo y lo hacemos como paso aparte.
