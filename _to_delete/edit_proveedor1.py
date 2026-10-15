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

# A) imports
old = """  cerrarCxpSinMovimiento,
  reabrirCxpCerradaManual,
  marcarEnEsperaMovimiento,
  quitarEnEsperaMovimiento,
} from "@/lib/pareo-cxp";"""
new = """  cerrarCxpSinMovimiento,
  reabrirCxpCerradaManual,
  quitarSolventadoParcialCxp,
  marcarMovimientoSolventadoManual,
  quitarSolventadoManualMovimiento,
  marcarEnEsperaMovimiento,
  quitarEnEsperaMovimiento,
} from "@/lib/pareo-cxp";"""
src = apply_once(src, old, new, "A imports")

# B) cierreForm state: add monto field
old = """  const [cierreAbierto, setCierreAbierto] = useState<any[] | null>(null);
  const [cierreForm, setCierreForm] = useState({
    nota: "",
    fecha: new Date().toISOString().slice(0, 10),
  });"""
new = """  const [cierreAbierto, setCierreAbierto] = useState<any[] | null>(null);
  const [cierreForm, setCierreForm] = useState({
    nota: "",
    fecha: new Date().toISOString().slice(0, 10),
    monto: "",
  });
  // Marcar un movimiento (o parte de su monto) como "solventado manualmente":
  // se sabe que pago una factura real que nunca se cargo al sistema.
  const [solventarMovAbierto, setSolventarMovAbierto] = useState<any | null>(null);
  const [solventarMovForm, setSolventarMovForm] = useState({
    nota: "",
    fecha: new Date().toISOString().slice(0, 10),
    monto: "",
  });"""
src = apply_once(src, old, new, "B state")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK part A-B")
