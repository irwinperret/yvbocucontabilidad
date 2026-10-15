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

old2 = """  const pagosSinCruzarUsd = movs
    .filter((m) => !movsConVinculo.has(m.id))
    .reduce((s, m) => {
      const tasa = Number(m.tasa_bcv) || 0;
      const bs = Math.abs(Number(m.monto_bs) || 0);
      const usd = tasa > 0 ? bs / tasa : Number(m.monto_usd) || 0;
      return s + usd;
    }, 0);"""
new2 = """  const pagosSinCruzarUsd = movs
    .filter((m) => !movsConVinculo.has(m.id))
    .reduce((s, m) => {
      const tasa = Number(m.tasa_bcv) || 0;
      const bs = Math.abs(Number(m.monto_bs) || 0);
      const usd = tasa > 0 ? bs / tasa : Number(m.monto_usd) || 0;
      // Lo que ya se marco "solventado manualmente" (se sabe que pago una
      // factura vieja que nunca se cargo al sistema) ya no es un pago
      // esperando cruzarse contra nada.
      const solventado = Number(m.solventado_manual_usd) || 0;
      return s + Math.max(0, usd - solventado);
    }, 0);"""
src = apply_once(src, old2, new2, "restar solventado manual de pagosSinCruzarUsd")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK part2")
