import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

# ayuda.tsx
path1 = "src/routes/_authenticated/ayuda.tsx"
with open(path1, "r", encoding="utf-8") as f:
    src1 = f.read()

old1 = """        <p>Una vez cargados estos archivos, el sistema utiliza la información para alimentar <strong>Ganancias y Pérdidas, Flujo de Caja, CapEx, COGS</strong> y los demás reportes financieros. Los movimientos que requieran un registro adicional o una corrección también pueden registrarse directamente mediante <strong>“Registrar movimiento”</strong>.</p>"""
new1 = """        <p>Una vez cargados estos archivos, el sistema utiliza la información para alimentar <strong>Ganancias y Pérdidas, Flujo de Caja, CapEx, COGS</strong>, el <strong>seguimiento de Cuentas por Pagar por proveedor</strong> (cruzando las compras con los movimientos bancarios) y los demás reportes financieros. Las facturas cuyo pago nunca deja un movimiento bancario identificable, o los movimientos que pagaron una factura que nunca se cargó, se pueden cerrar o solventar a mano desde la ficha de cada proveedor. Los movimientos que requieran un registro adicional o una corrección también pueden registrarse directamente mediante <strong>“Registrar movimiento”</strong>.</p>"""
src1 = apply_once(src1, old1, new1, "ayuda.tsx parrafo")

with open(path1, "w", encoding="utf-8") as f:
    f.write(src1)
print("OK ayuda.tsx")

# inicio.tsx
path2 = "src/routes/_authenticated/inicio.tsx"
with open(path2, "r", encoding="utf-8") as f:
    src2 = f.read()

old2 = """          <p>
            Una vez cargados estos archivos, el sistema utiliza la información para alimentar <span className="font-semibold">Ganancias y Pérdidas, Flujo de Caja, CapEx, COGS</span> y los demás reportes financieros. Los movimientos que requieran un registro adicional o una corrección también pueden registrarse directamente mediante <span className="font-semibold">"Registrar movimiento"</span>.
          </p>"""
new2 = """          <p>
            Una vez cargados estos archivos, el sistema utiliza la información para alimentar <span className="font-semibold">Ganancias y Pérdidas, Flujo de Caja, CapEx, COGS</span>, el <span className="font-semibold">seguimiento de Cuentas por Pagar por proveedor</span> (cruzando las compras con los movimientos bancarios) y los demás reportes financieros. Las facturas cuyo pago nunca deja un movimiento bancario identificable, o los movimientos que pagaron una factura que nunca se cargó, se pueden cerrar o solventar a mano desde la ficha de cada proveedor. Los movimientos que requieran un registro adicional o una corrección también pueden registrarse directamente mediante <span className="font-semibold">"Registrar movimiento"</span>.
          </p>"""
src2 = apply_once(src2, old2, new2, "inicio.tsx parrafo")

with open(path2, "w", encoding="utf-8") as f:
    f.write(src2)
print("OK inicio.tsx")
