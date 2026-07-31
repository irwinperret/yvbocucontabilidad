## Objetivo

En el registro de nómina, los parafiscales se descuentan del salario base y producen un **salario neto**. Ese neto es lo que debe quedar registrado en la cuenta de salario (3.9 YV / 3.4 Bocu), no el base.

Total registrado por quincena = salario neto + bono alimentación + bono compensatorio + parafiscales
(equivale a: salario base + bonos).

## 1. Formulario de nómina (`src/routes/_authenticated/registrar.tsx`)

Aplica a las dos pestañas: **Nómina regular (Bs)** y **Chef Ejecutivo (USD)**.

- En cada bloque (BYV, BOCU, BYV-BOCU y Chef) se añade una fila de solo lectura **Salario neto = Salario base − Parafiscales**, que se recalcula en vivo al escribir. Campo deshabilitado, estilo resaltado, no editable directamente.
- Si los parafiscales superan al salario base, el neto se muestra en rojo y el botón de registrar se bloquea con un mensaje.
- El total de la sección y el total general pasan a calcularse como `neto + alimentación + compensatorio + parafiscales`.
- Al registrar, la línea de salario (3.9 / 3.4, incluido el reparto 20/80 del bloque compartido) se inserta con el **neto**; las líneas de bonos y parafiscales quedan igual. El concepto de esa línea pasa a decir "Salario neto (base − parafiscales)".

## 2. Corrección retroactiva

Hay 3 grupos de nómina históricos con líneas de parafiscales (13/07, 15/07 y 28/07 de 2026). Para cada uno:

- Emparejar cada línea de parafiscales (3.15) con su línea de salario correspondiente (3.9 o 3.4) usando el mismo grupo, el mismo centro de costo y el mismo sufijo de concepto en las notas (normal, "compartido 20%", "compartido 80%").
- Restar el monto de los parafiscales al salario: se ajustan `monto_bs`, `monto_base_bs` y `monto_usd` (recalculado con la misma tasa que ya tiene la transacción, paralela con fallback a BCV) manteniendo el resto intacto.
- Registrar cada cambio en auditoría.
- El grupo del 15/07 (solo dos líneas de salario, sin parafiscales) no se toca.
- Se hará mediante una corrección de datos puntual, mostrando el antes/después de cada línea al terminar.

## Notas técnicas

- No cambia el plan de cuentas ni el esquema; los parafiscales siguen en 3.15 como línea propia.
- El neto es un valor derivado: no se guarda un campo nuevo, se calcula en el formulario y se persiste en el monto de la línea de salario.
