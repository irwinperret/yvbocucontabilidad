import sys
path = "src/components/transaccion-edit-dialog.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

old = """  const usdN = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  // Bs se recalcula desde USD usando la tasa paralela vigente en el formulario (o BCV como fallback).
  const tasaParalelaN = Number(tasaPar) || 0;"""
new = """  const usdN = Number(montoUsd) || 0;
  const tasaN = Number(tasa) || 0;
  // Solo se guarda como referencia (reportes de "USD paralelo"); no participa en el cálculo de Bs.
  const tasaParalelaN = Number(tasaPar) || 0;"""
src = apply_once(src, old, new, "limpiar comentario viejo")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK cleanup")
