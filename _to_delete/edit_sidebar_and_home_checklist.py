import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

# A. Sidebar: "Entradas del mes" minimizado por defecto, igual que Gestion.
path_a = "mnt/yvbocucontabilidad/src/components/app-sidebar.tsx"
with open(path_a, "r", encoding="utf-8") as f:
    src_a = f.read()
src_a = apply_once(
    src_a,
    '  const [importarOpen, setImportarOpen] = useState(true);',
    '  const [importarOpen, setImportarOpen] = useState(false);',
    "importarOpen default",
)
with open(path_a, "w", encoding="utf-8") as f:
    f.write(src_a)
print("A OK")

# B. Checklist de Inicio: siempre mes pasado por defecto, nunca el mes actual
#    (misma decision ya tomada para el checklist de Iris).
path_b = "mnt/yvbocucontabilidad/src/components/checklist-mensual-card.tsx"
with open(path_b, "r", encoding="utf-8") as f:
    src_b = f.read()

old_import = '''  fetchRetencionIslrPeriodos,
  periodoActual,
  tipoImportadoEnPeriodo,'''
new_import = '''  fetchRetencionIslrPeriodos,
  tipoImportadoEnPeriodo,'''
src_b = apply_once(src_b, old_import, new_import, "remove periodoActual import")

old_fn = '''/**
 * Durante los primeros 10 días del mes mostramos el checklist del mes anterior,
 * porque ese es el periodo que se está terminando de cerrar en esos días.
 * A partir del día 11 se muestra el checklist del mes corriente.
 */
function periodoChecklistInicio(): string {
  const hoy = new Date();
  if (hoy.getDate() <= 10) {
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    return `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, "0")}`;
  }
  return periodoActual();
}'''
new_fn = '''/**
 * Siempre el mes calendario anterior, nunca el mes actual: el trabajo de
 * cierre de cada mes se hace sobre el mes que ya terminó (misma decisión
 * que el checklist de Iris, ver mesPasado() en @/lib/iris-checklist).
 */
function periodoChecklistInicio(): string {
  const hoy = new Date();
  const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, "0")}`;
}'''
src_b = apply_once(src_b, old_fn, new_fn, "always mes pasado")

with open(path_b, "w", encoding="utf-8") as f:
    f.write(src_b)
print("B OK")
