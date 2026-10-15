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

old1 = """  const [montoUsd, setMontoUsd] = useState<string>(String(tx.monto_usd ?? ""));"""
new1 = """  // El campo "Monto USD" de este dialogo representa USD a tasa BCV (igual
  // que el resto de la app), no el valor a tasa paralela que se guardaba
  // antes en tx.monto_usd -- por eso se deriva de monto_bs / tasa_bcv en
  // vez de usar la columna guardada directamente.
  const montoUsdBcvInicial = Number(tx.tasa_bcv) > 0 ? Number(tx.monto_bs) / Number(tx.tasa_bcv) : Number(tx.monto_usd) || 0;
  const [montoUsd, setMontoUsd] = useState<string>(String(+montoUsdBcvInicial.toFixed(2)));"""
src = apply_once(src, old1, new1, "monto_usd inicial BCV")

old2 = """  const tasaParalelaN = Number(tasaPar) || 0;
  const tasaConvN = tasaParalelaN || tasaN;"""
new2 = """  const tasaParalelaN = Number(tasaPar) || 0;
  // El Bs equivalente siempre se deriva de la tasa BCV -- "Monto USD" es
  // USD BCV, no USD paralelo. La tasa paralela solo se guarda como dato de
  // referencia (para reportes que muestran "USD paralelo" aparte).
  const tasaConvN = tasaN;"""
src = apply_once(src, old2, new2, "tasaConvN siempre BCV")

old3 = """            hPatch.tasa_bcv = tasaN;
            if (tasaParalelaN > 0) hPatch.tasa_paralela = tasaParalelaN;
            // Recalcular monto_usd del hermano preservando su monto_bs.
            const hBs = Number(h.monto_bs) || 0;
            const conv = tasaParalelaN || Number(h.tasa_paralela) || tasaN;
            if (conv > 0) hPatch.monto_usd = +(hBs / conv).toFixed(2);"""
new3 = """            hPatch.tasa_bcv = tasaN;
            if (tasaParalelaN > 0) hPatch.tasa_paralela = tasaParalelaN;
            // Recalcular monto_usd (BCV) del hermano preservando su monto_bs.
            const hBs = Number(h.monto_bs) || 0;
            if (tasaN > 0) hPatch.monto_usd = +(hBs / tasaN).toFixed(2);"""
src = apply_once(src, old3, new3, "propagacion hermanos siempre BCV")

old4 = """                  <span className="mono">{fmtUsd(Number(h.monto_usd) || 0)}</span>"""
new4 = """                  <span className="mono">{fmtUsd(Number(h.tasa_bcv) > 0 ? Number(h.monto_bs) / Number(h.tasa_bcv) : Number(h.monto_usd) || 0)}</span>"""
src = apply_once(src, old4, new4, "hermanos preview BCV")

old5 = """            <Label>Monto USD {tx.iva_aplica ? "(IVA incluido)" : ""}</Label>"""
new5 = """            <Label>Monto USD BCV {tx.iva_aplica ? "(IVA incluido)" : ""}</Label>"""
src = apply_once(src, old5, new5, "label Monto USD BCV")

old6 = """            <span className="text-muted-foreground">Equivalente Bs {tasaParalelaN ? "(tasa paralela)" : "(tasa BCV)"}</span>"""
new6 = """            <span className="text-muted-foreground">Equivalente Bs (tasa BCV)</span>"""
src = apply_once(src, old6, new6, "label equivalente Bs")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK transaccion-edit-dialog.tsx")
