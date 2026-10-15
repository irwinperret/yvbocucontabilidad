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

old = """          <div className="space-y-3">
            {cierreAbierto && cierreAbierto.length > 1 && (
              <div className="text-xs text-muted-foreground border rounded-md p-2 max-h-28 overflow-y-auto">
                {cierreAbierto.map((c) => (
                  <div key={c.id}>Fact. {c.numero_factura ?? "s/n"} · {fmtUsd(usdBcvFactura(c))} BCV</div>
                ))}
              </div>
            )}
            <div>
              <Label className="text-xs">Fecha del pago</Label>
              <Input
                type="date"
                value={cierreForm.fecha}
                onChange={(e) => setCierreForm({ ...cierreForm, fecha: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Nota (opcional)</Label>
              <Textarea
                value={cierreForm.nota}
                onChange={(e) => setCierreForm({ ...cierreForm, nota: e.target.value })}
                placeholder="Detalle adicional…"
                rows={2}
              />
            </div>
          </div>"""
new = """          <div className="space-y-3">
            {cierreAbierto && cierreAbierto.length > 1 && (
              <div className="text-xs text-muted-foreground border rounded-md p-2 max-h-28 overflow-y-auto">
                {cierreAbierto.map((c) => (
                  <div key={c.id}>Fact. {c.numero_factura ?? "s/n"} · {fmtUsd(usdBcvFactura(c))} BCV</div>
                ))}
              </div>
            )}
            {cierreAbierto && cierreAbierto.length === 1 && (
              <div>
                <Label className="text-xs">Monto a solventar (USD BCV)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={cierreForm.monto}
                  onChange={(e) => setCierreForm({ ...cierreForm, monto: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Pendiente actual: {fmtUsd(pendienteUsdBcv(cierreAbierto[0]))} USD BCV. Si pones menos, la factura
                  queda abierta por el resto -- solo se descuenta lo que confirmes aquí.
                </p>
              </div>
            )}
            <div>
              <Label className="text-xs">Fecha del pago</Label>
              <Input
                type="date"
                value={cierreForm.fecha}
                onChange={(e) => setCierreForm({ ...cierreForm, fecha: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Nota (opcional)</Label>
              <Textarea
                value={cierreForm.nota}
                onChange={(e) => setCierreForm({ ...cierreForm, nota: e.target.value })}
                placeholder="Detalle adicional…"
                rows={2}
              />
            </div>
          </div>"""
src = apply_once(src, old, new, "dialog cierre monto field")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK dialog cierre")
