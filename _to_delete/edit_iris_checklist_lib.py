import sys

path = "mnt/yvbocucontabilidad/src/lib/iris-checklist.ts"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

old = '''    await (supabase.from as any)("conciliacion_bancaria")
      .select("transaccion_bancaria_id, origen")
      .in("transaccion_bancaria_id", movs.map((m) => m.id))
      .range(from, to),
  );
  const yaConfirmados = new Set(
    vinculos.filter((v: any) => v.origen === "manual").map((v: any) => v.transaccion_bancaria_id),
  );
  return movs.filter((m) => !yaConfirmados.has(m.id)).length;'''

new = '''    await (supabase.from as any)("conciliacion_bancaria")
      .select("transaccion_bancaria_id, estado")
      .in("transaccion_bancaria_id", movs.map((m) => m.id))
      .range(from, to),
  );
  // "Resuelto" es por estado, no por origen: un vinculo "pareado"/"parcial"
  // (automatico o manual) ya tiene factura, y "gasto_directo"/"no_contable"
  // son decisiones finales marcadas a mano. "pendiente_revision" y
  // "sin_pareo" NO cuentan como resueltos aunque se hayan guardado como
  // origen "manual" -- son justo lo que todavia le falta confirmar a Iris,
  // y antes se escondian de esta lista por error.
  const yaConfirmados = new Set(
    vinculos
      .filter((v: any) => ESTADOS_RESUELTOS.has(v.estado))
      .map((v: any) => v.transaccion_bancaria_id),
  );
  return movs.filter((m) => !yaConfirmados.has(m.id)).length;'''

src = apply_once(src, old, new, "count query + filter")

old2 = '''export async function fetchMovimientosSinProveedorCount(): Promise<number> {'''
new2 = '''const ESTADOS_RESUELTOS = new Set(["pareado", "parcial", "gasto_directo", "no_contable"]);

export async function fetchMovimientosSinProveedorCount(): Promise<number> {'''
src = apply_once(src, old2, new2, "add ESTADOS_RESUELTOS const")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
