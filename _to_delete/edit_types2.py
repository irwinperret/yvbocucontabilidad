import sys
path = "src/integrations/supabase/types.ts"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

start_marker = "      transacciones: {\n"
start = src.index(start_marker)
# the next top-level table key after transacciones' three blocks; find the
# next line that starts a new table (6-space indent + identifier + ": {")
# by searching from after start for the pattern "\n      " + word + ": {"
import re
end_match = re.search(r"\n      [a-z_]+: \{", src[start + len(start_marker):])
end = start + len(start_marker) + end_match.start()
section = src[start:end]

needle_row = "          sin_proveedor_deducido: boolean\n          standby: boolean"
needle_opt = "          sin_proveedor_deducido?: boolean\n          standby?: boolean"

count_row = section.count(needle_row)
count_opt = section.count(needle_opt)
if count_row != 1 or count_opt != 2:
    print(f"FAIL: row={count_row} opt={count_opt}")
    sys.exit(1)

insert_row = """          sin_proveedor_deducido: boolean
          solventado_manual_at: string | null
          solventado_manual_fecha: string | null
          solventado_manual_nota: string | null
          solventado_manual_por: string | null
          solventado_manual_usd: number
          standby: boolean"""
insert_opt = """          sin_proveedor_deducido?: boolean
          solventado_manual_at?: string | null
          solventado_manual_fecha?: string | null
          solventado_manual_nota?: string | null
          solventado_manual_por?: string | null
          solventado_manual_usd?: number
          standby?: boolean"""

section = section.replace(needle_row, insert_row, 1)
section = section.replace(needle_opt, insert_opt, 2)

src = src[:start] + section + src[end:]
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK transacciones")
