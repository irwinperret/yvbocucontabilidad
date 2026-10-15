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

old = """function FacturaBoardCard({
  cxp: c,
  emision,
  remanenteUsd,
  disabled,
  isAdmin,
  checked,
  onToggleCheck,
  onMarkPaid,
  onToggleEspera,
  movimientosCount,
  onEditar,
  puedeEditarFacturas,
  movsDisponibles,
  onAsignar,
  terceros,
  onCambiarProveedor,
}: {
  cxp: any;
  emision?: string;
  remanenteUsd?: number;
  disabled?: boolean;
  isAdmin: boolean;
  checked?: boolean;
  onToggleCheck?: (v: boolean) => void;
  onMarkPaid?: () => void;
  onToggleEspera?: () => void;
  movimientosCount?: number;
  onEditar?: () => void;
  puedeEditarFacturas: boolean;
  movsDisponibles: any[];
  onAsignar: (movId: string) => void;
  terceros?: any[];
  onCambiarProveedor?: (nuevo: string | null) => void;
}) {"""
new = """function FacturaBoardCard({
  cxp: c,
  emision,
  remanenteUsd,
  disabled,
  isAdmin,
  checked,
  onToggleCheck,
  onMarkPaid,
  onToggleEspera,
  movimientosCount,
  onEditar,
  puedeEditarFacturas,
  movsDisponibles,
  onAsignar,
  terceros,
  onCambiarProveedor,
  solventadoInfo,
  onDeshacerSolventado,
}: {
  cxp: any;
  emision?: string;
  remanenteUsd?: number;
  disabled?: boolean;
  isAdmin: boolean;
  checked?: boolean;
  onToggleCheck?: (v: boolean) => void;
  onMarkPaid?: () => void;
  onToggleEspera?: () => void;
  movimientosCount?: number;
  onEditar?: () => void;
  puedeEditarFacturas: boolean;
  movsDisponibles: any[];
  onAsignar: (movId: string) => void;
  terceros?: any[];
  onCambiarProveedor?: (nuevo: string | null) => void;
  /** Texto "solventado $X manualmente — quien / fecha — nota", si aplica. */
  solventadoInfo?: string;
  onDeshacerSolventado?: () => void;
}) {"""
src = apply_once(src, old, new, "props FacturaBoardCard")

old2 = """          <div className="text-[11px] text-muted-foreground mt-0.5">
            {emision ? `Emitida ${fmtDate(emision)}` : "—"}
          </div>
        </div>"""
new2 = """          <div className="text-[11px] text-muted-foreground mt-0.5">
            {emision ? `Emitida ${fmtDate(emision)}` : "—"}
          </div>
          {solventadoInfo && (
            <div className="text-[11px] text-[#534AB7] font-medium mt-0.5">{solventadoInfo}</div>
          )}
        </div>"""
src = apply_once(src, old2, new2, "render solventadoInfo")

old3 = """            {puedeEditarFacturas && onEditar && (
              <DropdownMenuItem onClick={onEditar}>
                <Pencil className="h-3.5 w-3.5 mr-2" />Ver / editar factura
              </DropdownMenuItem>
            )}"""
new3 = """            {puedeEditarFacturas && onEditar && (
              <DropdownMenuItem onClick={onEditar}>
                <Pencil className="h-3.5 w-3.5 mr-2" />Ver / editar factura
              </DropdownMenuItem>
            )}
            {isAdmin && solventadoInfo && onDeshacerSolventado && (
              <DropdownMenuItem onClick={onDeshacerSolventado}>
                <RotateCcw className="h-3.5 w-3.5 mr-2" />Deshacer solventado manual
              </DropdownMenuItem>
            )}"""
src = apply_once(src, old3, new3, "dropdown deshacer solventado")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK FacturaBoardCard")
