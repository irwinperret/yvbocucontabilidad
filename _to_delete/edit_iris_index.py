import sys

path = "src/routes/_authenticated/iris/index.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences, expected 1", file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)

# 1. imports
old_import = '''import { fmtUsd } from "@/lib/format";
import { pendienteUsdBcv } from "@/lib/cxp-saldo";'''
new_import = '''import { fmtUsd } from "@/lib/format";
import { pendienteUsdBcv } from "@/lib/cxp-saldo";
import { fetchMovimientosSinProveedorCount } from "@/lib/iris-checklist";
import { ChecklistIrisCard } from "@/components/checklist-iris-card";'''
src = apply_once(src, old_import, new_import, "import")

# 2. replace inline sinProveedorCount queryFn with the shared helper (DRY)
old_query = '''  const { data: sinProveedorCount } = useQuery({
    queryKey: ["iris-sin-proveedor-count"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetch-all");
      const movs = await fetchAllRows<any>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("id")
          .like("referencia", "BANK:%")
          .neq("standby", true)
          .is("tercero_id", null)
          .range(from, to),
      );
      if (!movs.length) return 0;
      const vinculos = await fetchAllRows<any>(async (from, to) =>
        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_bancaria_id, origen")
          .in("transaccion_bancaria_id", movs.map((m) => m.id))
          .range(from, to),
      );
      const yaConfirmados = new Set(
        vinculos.filter((v: any) => v.origen === "manual").map((v: any) => v.transaccion_bancaria_id),
      );
      return movs.filter((m) => !yaConfirmados.has(m.id)).length;
    },
  });'''
new_query = '''  const { data: sinProveedorCount } = useQuery({
    queryKey: ["iris-sin-proveedor-count"],
    queryFn: fetchMovimientosSinProveedorCount,
  });'''
src = apply_once(src, old_query, new_query, "sinProveedorCount query")

# 3. render the checklist card right after the header
old_header_tail = '''        <p className="text-sm text-muted-foreground">
          Revisión administrativa de la conciliación de cada proveedor. Todos los montos en USD BCV.
        </p>
      </div>

      <Link to="/iris/notas">'''
new_header_tail = '''        <p className="text-sm text-muted-foreground">
          Revisión administrativa de la conciliación de cada proveedor. Todos los montos en USD BCV.
        </p>
      </div>

      <ChecklistIrisCard />

      <Link to="/iris/notas">'''
src = apply_once(src, old_header_tail, new_header_tail, "render checklist")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("ALL EDITS APPLIED")
