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

old1 = """      const movs = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id, monto_bs, tasa_bcv, monto_usd")
          .like("referencia", "BANK:%")
          .neq("standby", true)
          .not("tercero_id", "is", null)
          .range(from, to),
      );"""
new1 = """      const movs = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id, monto_bs, tasa_bcv, monto_usd, solventado_manual_usd")
          .like("referencia", "BANK:%")
          .neq("standby", true)
          .not("tercero_id", "is", null)
          .range(from, to),
      );"""
src = apply_once(src, old1, new1, "select solventado_manual_usd")

old2 = """      const pagosSinCruzarUsd = movs
        .filter((m) => !movsConVinculo.has(m.id))
        .reduce((s, m) => {
          const tasa = Number(m.tasa_bcv) || 0;
          const bs = Math.abs(Number(m.monto_bs) || 0);
          const usd = tasa > 0 ? bs / tasa : Number(m.monto_usd) || 0;
          return s + usd;
        }, 0);"""
new2 = """      const pagosSinCruzarUsd = movs
        .filter((m) => !movsConVinculo.has(m.id))
        .reduce((s, m) => {
          const tasa = Number(m.tasa_bcv) || 0;
          const bs = Math.abs(Number(m.monto_bs) || 0);
          const usd = tasa > 0 ? bs / tasa : Number(m.monto_usd) || 0;
          // Lo que ya se marcó "solventado manualmente" (pagó una factura
          // vieja que nunca se cargó) ya no es un pago esperando cruzarse.
          const solventado = Number(m.solventado_manual_usd) || 0;
          return s + Math.max(0, usd - solventado);
        }, 0);"""
src = apply_once(src, old2, new2, "restar solventado manual de pagosSinCruzarUsd")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
