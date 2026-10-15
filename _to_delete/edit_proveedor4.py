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

old = """  const cierreManualInfo = (c: any) => {
    if (!c?.cierre_manual) return "";
    const quien = c.cierre_manual_por ? emailById[c.cierre_manual_por] ?? c.cierre_manual_por : "—";
    const cuando = c.cierre_manual_fecha ? fmtDate(c.cierre_manual_fecha) : "—";
    const base = `${quien} / ${cuando}`;
    return c.cierre_manual_nota ? `${base} — ${c.cierre_manual_nota}` : base;
  };"""
new = """  const cierreManualInfo = (c: any) => {
    if (!c?.cierre_manual) return "";
    const quien = c.cierre_manual_por ? emailById[c.cierre_manual_por] ?? c.cierre_manual_por : "—";
    const cuando = c.cierre_manual_fecha ? fmtDate(c.cierre_manual_fecha) : "—";
    const base = `${quien} / ${cuando}`;
    return c.cierre_manual_nota ? `${base} — ${c.cierre_manual_nota}` : base;
  };

  /** "Usuario · fecha · monto" de un solventado PARCIAL manual sobre una factura. */
  const solventadoManualInfo = (c: any) => {
    const monto = Number(c?.monto_solventado_manual_usd) || 0;
    if (monto <= 0.009) return "";
    const quien = c.solventado_manual_por ? emailById[c.solventado_manual_por] ?? c.solventado_manual_por : "—";
    const cuando = c.solventado_manual_fecha ? fmtDate(c.solventado_manual_fecha) : "—";
    const base = `Solventado ${fmtUsd(monto)} USD BCV manualmente — ${quien} / ${cuando}`;
    return c.solventado_manual_nota ? `${base} — ${c.solventado_manual_nota}` : base;
  };

  /** "Usuario · fecha · monto" de un movimiento marcado solventado a mano. */
  const movSolventadoInfo = (mv: any) => {
    const monto = Number((mv as any)?.solventado_manual_usd) || 0;
    if (monto <= 0.009) return "";
    const quien = (mv as any).solventado_manual_por ? emailById[(mv as any).solventado_manual_por] ?? (mv as any).solventado_manual_por : "—";
    const cuando = (mv as any).solventado_manual_fecha ? fmtDate((mv as any).solventado_manual_fecha) : "—";
    const base = `Solventado ${fmtUsd(monto)} USD BCV manualmente — ${quien} / ${cuando}`;
    return (mv as any).solventado_manual_nota ? `${base} — ${(mv as any).solventado_manual_nota}` : base;
  };"""
src = apply_once(src, old, new, "helpers info")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK helpers")
