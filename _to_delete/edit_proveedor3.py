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

old = """    const aplicadoPorCxpUsd = new Map<string, number>();
    for (const [cxpId, bs] of aplicadoPorCxp) {
      aplicadoPorCxpUsd.set(cxpId, montoMov > 0 ? +((bs / montoMov) * usdBcvMov).toFixed(2) : 0);
    }
    return { lista, montoMov, aplicado, sinAplicar, aplicadoUsd, sinAplicarUsd, aplicadoPorCxp, aplicadoPorCxpUsd };
  };"""
new = """    const aplicadoPorCxpUsd = new Map<string, number>();
    for (const [cxpId, bs] of aplicadoPorCxp) {
      aplicadoPorCxpUsd.set(cxpId, montoMov > 0 ? +((bs / montoMov) * usdBcvMov).toFixed(2) : 0);
    }
    // Lo que ya se marco "solventado manualmente" en este movimiento (pago
    // una factura vieja que nunca se cargo) se resta de lo que falta por
    // aplicar -- ya no es un remanente real esperando cruzarse.
    const solventadoUsd = Math.min(sinAplicarUsd, Number((mov as any).solventado_manual_usd) || 0);
    const sinAplicarUsdNeto = Math.max(0, +(sinAplicarUsd - solventadoUsd).toFixed(2));
    return {
      lista,
      montoMov,
      aplicado,
      sinAplicar,
      aplicadoUsd,
      sinAplicarUsd: sinAplicarUsdNeto,
      sinAplicarUsdBruto: sinAplicarUsd,
      solventadoUsd,
      aplicadoPorCxp,
      aplicadoPorCxpUsd,
    };
  };"""
src = apply_once(src, old, new, "resumenMov con solventado")

old2 = """  const movsSinResolver = movsFiltrados.filter((mv) => !cxpsDeMov(mv.id).length || resumenMov(mv).sinAplicar > 0.01);
  /** Movimientos ya cuadrados del todo (con factura(s) y sin remanente) — van a "Ya conciliado". */
  const movsResueltos = movsFiltrados.filter((mv) => cxpsDeMov(mv.id).length > 0 && resumenMov(mv).sinAplicar <= 0.01);"""
new2 = """  const movsSinResolver = movsFiltrados.filter((mv) => resumenMov(mv).sinAplicarUsd > 0.01);
  /** Movimientos ya cuadrados del todo (con factura(s), o solventados a mano, y sin remanente) — van a "Ya conciliado". */
  const movsResueltos = movsFiltrados.filter(
    (mv) => (cxpsDeMov(mv.id).length > 0 || resumenMov(mv).solventadoUsd > 0.009) && resumenMov(mv).sinAplicarUsd <= 0.01,
  );
  /** Movimientos (con o sin remanente) que tienen algun monto solventado a mano -- lista aparte, solo para auditoria/deshacer. */
  const movsConSolventadoManual = movsFiltrados.filter((mv) => (Number((mv as any).solventado_manual_usd) || 0) > 0.009);"""
src = apply_once(src, old2, new2, "movsSinResolver/movsResueltos")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK resumenMov/listas")
