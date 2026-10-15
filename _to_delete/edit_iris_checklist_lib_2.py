import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

path = "mnt/yvbocucontabilidad/src/lib/iris-checklist.ts"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''/** "2026-09" -> "Septiembre 2026". */
export function nombreMesPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const nombre = NOMBRES_MES[(mes - 1 + 12) % 12] ?? "";
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}'''

new = '''/** "2026-09" -> "Septiembre 2026". */
export function nombreMesPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const nombre = NOMBRES_MES[(mes - 1 + 12) % 12] ?? "";
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}

/** Suma (o resta, con delta negativo) meses a un periodo "YYYY-MM". */
export function sumarMeses(periodo: string, delta: number): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const d = new Date(anio, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}'''

src = apply_once(src, old, new, "add sumarMeses")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
