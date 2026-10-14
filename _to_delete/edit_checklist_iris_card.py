import sys

path = "mnt/yvbocucontabilidad/src/components/checklist-iris-card.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

# 1. Card se destaca del resto de la pagina (borde + fondo morado tenue + sombra).
old = '''  return (
    <Card>
      <CardHeader className="pb-2">'''
new = '''  return (
    <Card className="border-[#534AB7]/30 bg-[#534AB7]/[0.04] shadow-sm">
      <CardHeader className="pb-2">'''
src = apply_once(src, old, new, "card prominence")

# 2. El progreso de arriba (X de 6) ahora incluye el paso 6 -- antes solo
#    contaba los 5 pasos primarios, aunque el titulo diga "6 pasos".
old = '''  const siguienteIdx = pasos.findIndex((p) => !p.hecho);
  const completados = pasos.filter((p) => p.hecho).length;
  const total = pasos.length;'''
new = '''  const siguienteIdx = pasos.findIndex((p) => !p.hecho);
  const paso6Cargado = sinProveedorCount !== undefined;
  const paso6Hecho = sinProveedorCount === 0;
  const completados = pasos.filter((p) => p.hecho).length + (paso6Hecho ? 1 : 0);
  const total = pasos.length + 1;'''
src = apply_once(src, old, new, "progress includes step 6")

old_progress_guard = '''          {data && total > 0 && ('''
new_progress_guard = '''          {data && paso6Cargado && total > 0 && ('''
src = apply_once(src, old_progress_guard, new_progress_guard, "progress guard waits for step 6 too")

# 3. Paso 6: ya no es amarillo fijo -- se marca "hecho" (check verde, igual
#    que los pasos 1-5) cuando ya no quedan movimientos sin proveedor, y
#    mientras este pendiente usa el mismo tono neutro que el resto en vez
#    de amarillo (que se leia como alerta/urgencia, no como "pendiente normal").
old_step6 = '''        <Link to="/iris/movimientos-sin-proveedor" className="block">
          <div className="flex items-center gap-3 rounded-md px-3 py-2 text-sm bg-amber-500/10">
            <Circle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="w-5 text-muted-foreground/60">6.</span>
            <span className="flex-1">
              Confirmar movimientos bancarios
              <span className="block text-[11px] font-normal text-muted-foreground">
                Vincularlos a su factura o marcarlos como gasto directo (sin proveedor)
              </span>
            </span>
            <span className="text-[11px] font-semibold bg-amber-200/60 text-amber-800 px-2 py-0.5 rounded-full whitespace-nowrap">
              {sinProveedorCount ?? "…"} pendientes
            </span>
          </div>
        </Link>'''

new_step6 = '''        <Link to="/iris/movimientos-sin-proveedor" className="block">
          <div
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
              paso6Hecho ? "text-muted-foreground" : ""
            }`}
          >
            {paso6Hecho ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            )}
            <span className="w-5 text-muted-foreground/60">6.</span>
            <span className="flex-1">
              Confirmar movimientos bancarios
              <span className="block text-[11px] font-normal text-muted-foreground">
                Vincularlos a su factura o marcarlos como gasto directo (sin proveedor)
              </span>
            </span>
            {!paso6Hecho && (
              <span className="text-[11px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full whitespace-nowrap">
                {sinProveedorCount ?? "…"} pendientes
              </span>
            )}
          </div>
        </Link>'''

src = apply_once(src, old_step6, new_step6, "step 6 done/pending styling")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
