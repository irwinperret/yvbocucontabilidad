import sys
path = "src/lib/deuda-neta.ts"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

old1 = '.select("id, monto_bs, tasa_bcv, monto_usd")'
new1 = '.select("id, monto_bs, tasa_bcv, monto_usd, solventado_manual_usd")'
src = apply_once(src, old1, new1, "select solventado_manual_usd")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK part1")
