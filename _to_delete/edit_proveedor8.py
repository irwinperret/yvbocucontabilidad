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

old = """            <DialogDescription>
              La factura queda en estado Pagada con saldo cero, sin crear ninguna transacción de pago — no afecta G&amp;P ni
              flujo de caja. Úsalo cuando el pago ya ocurrió pero su movimiento bancario nunca va a aparecer (efectivo,
              compensación, cuenta no conciliada, factura anulada).
            </DialogDescription>"""
new = """            <DialogDescription>
              No crea ninguna transacción de pago — no afecta G&amp;P ni flujo de caja. Úsalo cuando el pago ya ocurrió
              pero su movimiento bancario nunca va a aparecer (efectivo, compensación, cuenta no conciliada, factura
              anulada). Si el monto cubre todo lo pendiente, la factura queda Pagada con saldo cero; si pones solo
              una parte, la factura sigue abierta por el resto.
            </DialogDescription>"""
src = apply_once(src, old, new, "dialog description")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK description")
