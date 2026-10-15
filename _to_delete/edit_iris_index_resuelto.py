import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

path = "mnt/yvbocucontabilidad/src/routes/_authenticated/iris/index.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old_import = '''import { ShieldCheck, ArrowLeftRight, ChevronRight, StickyNote } from "lucide-react";'''
new_import = '''import { ShieldCheck, ArrowLeftRight, CheckCircle2, ChevronRight, StickyNote } from "lucide-react";'''
src = apply_once(src, old_import, new_import, "import CheckCircle2")

old_card = '''      <Link to="/iris/movimientos-sin-proveedor">
        <Card className="hover:border-primary/60 hover:bg-muted/30 transition-colors cursor-pointer">
          <CardContent className="pt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-lg font-bold text-[#534AB7]">Movimientos bancarios sin proveedor</div>
                <p className="text-xs text-muted-foreground">Confirmar que son efectivamente Gasto Stand-Alone</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={sinProveedorCount ? "destructive" : "secondary"}>
                {sinProveedorCount ?? "…"} sin confirmar
              </Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </Link>'''

new_card = '''      <Link to="/iris/movimientos-sin-proveedor">
        <Card className="hover:border-primary/60 hover:bg-muted/30 transition-colors cursor-pointer">
          <CardContent className="pt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {sinProveedorCount === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <div className="text-lg font-bold text-[#534AB7]">Movimientos bancarios sin proveedor</div>
                <p className="text-xs text-muted-foreground">Confirmar que son efectivamente Gasto Stand-Alone</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sinProveedorCount === 0 ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
                  Resuelto
                </Badge>
              ) : (
                <Badge variant={sinProveedorCount ? "destructive" : "secondary"}>
                  {sinProveedorCount ?? "…"} sin confirmar
                </Badge>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </Link>'''

src = apply_once(src, old_card, new_card, "resuelto badge")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
