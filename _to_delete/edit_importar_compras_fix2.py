import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

path = "mnt/yvbocucontabilidad/src/routes/_authenticated/importar-compras.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''    return { count: sel.length, totalUsd, sinProveedor, sinFecha };
  }, [visibles, terceroByRif]);'''
new = '''    return { count: sel.length, totalUsd, sinProveedor, sinFecha };
  }, [visibles, terceroByRif, candidatoByNombre]);'''
src = apply_once(src, old, new, "stats deps")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
