import sys
path = "src/routes/_authenticated/proveedores/$id.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

old = """                    terceros={terceros ?? []}
                    onCambiarProveedor={(nuevo) => cambiarProveedorFactura(c, nuevo)}
                  />
                ))}"""
new = """                    terceros={terceros ?? []}
                    onCambiarProveedor={(nuevo) => cambiarProveedorFactura(c, nuevo)}
                    solventadoInfo={solventadoManualInfo(c)}
                    onDeshacerSolventado={() => deshacerSolventadoParcial(c)}
                  />
                ))}"""
src = apply_once(src, old, new, "call site FacturaBoardCard")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK call site")
