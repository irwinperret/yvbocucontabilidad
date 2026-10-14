import sys

path = "mnt/yvbocucontabilidad/src/routes/_authenticated/iris/movimientos-sin-proveedor.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

old = '''        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_bancaria_id, origen")
          .in("transaccion_bancaria_id", movs.map((m) => m.id))
          .range(from, to),
      );
      const yaConfirmados = new Set(
        vinculos.filter((v: any) => v.origen === "manual").map((v: any) => v.transaccion_bancaria_id),
      );
      return movs.filter((m) => !yaConfirmados.has(m.id));'''

new = '''        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_bancaria_id, estado")
          .in("transaccion_bancaria_id", movs.map((m) => m.id))
          .range(from, to),
      );
      // Mismo criterio que fetchMovimientosSinProveedorCount() en
      // @/lib/iris-checklist: "resuelto" es por estado (pareado/parcial con
      // factura, o gasto_directo/no_contable decidido a mano), no por
      // origen -- "pendiente_revision" y "sin_pareo" siguen pendientes
      // aunque se hayan guardado como origen "manual".
      const ESTADOS_RESUELTOS = new Set(["pareado", "parcial", "gasto_directo", "no_contable"]);
      const yaConfirmados = new Set(
        vinculos
          .filter((v: any) => ESTADOS_RESUELTOS.has(v.estado))
          .map((v: any) => v.transaccion_bancaria_id),
      );
      return movs.filter((m) => !yaConfirmados.has(m.id));'''

src = apply_once(src, old, new, "list query + filter")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
