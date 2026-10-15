import sys
path = "src/components/dashboard-charts.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

# 1) import COLOR_INGRESOS (mismos 3 verdes que resumen-ejecutivo-mensual)
old1 = """import { CUENTA_VENTA_IVA } from "@/lib/venta-iva";"""
new1 = """import { CUENTA_VENTA_IVA } from "@/lib/venta-iva";
import { COLOR_INGRESOS } from "@/lib/resumen-mensual-calc";"""
src = apply_once(src, old1, new1, "import COLOR_INGRESOS")

# 2) data useMemo: desglosar ingresos en convencional/offBalance/iva, con el
#    MISMO criterio de "es ingreso" que ya usa este archivo (no el de
#    resumen-mensual-calc, que clasifica por `grupo` y podria no coincidir
#    exactamente) -- asi convencional+offBalance+iva siempre suma ingresos.
old2 = """      let ingresos = 0, cogs = 0, gastos = 0, capex = 0;
      rs.forEach((r) => {
        const c = mapCuentas.get(r.cuenta_codigo);
        if (!c) return;
        const base = Number(r.base_usd || 0);
        if (c.afecta_gyp) {
          if (r.cuenta_codigo.startsWith("1.") || r.cuenta_codigo === "6.1") ingresos += base;
          else if (r.cuenta_codigo.startsWith("2.")) cogs += base;
          else gastos += base;
        }
        // CapEx (activo fijo) — cuenta 5.6
        if (r.cuenta_codigo === "5.6") capex += Number(r.total_usd || 0);
      });"""
new2 = """      let ingresos = 0, cogs = 0, gastos = 0, capex = 0;
      let ingresosConvencional = 0, ingresosOffBalance = 0, ingresosIva = 0;
      rs.forEach((r) => {
        const c = mapCuentas.get(r.cuenta_codigo);
        if (!c) return;
        const base = Number(r.base_usd || 0);
        if (c.afecta_gyp) {
          if (r.cuenta_codigo.startsWith("1.") || r.cuenta_codigo === "6.1") {
            ingresos += base;
            // Mismo desglose en 3 tonos de verde que usa Resumen ejecutivo
            // mensual: convencional (on-balance, sin Venta de IVA), ajustes
            // off-balance, y Venta de IVA (cuenta 1.8) aparte.
            if (r.cuenta_codigo === CUENTA_VENTA_IVA) ingresosIva += base;
            else if (r.modo === "off_balance") ingresosOffBalance += base;
            else ingresosConvencional += base;
          }
          else if (r.cuenta_codigo.startsWith("2.")) cogs += base;
          else gastos += base;
        }
        // CapEx (activo fijo) — cuenta 5.6
        if (r.cuenta_codigo === "5.6") capex += Number(r.total_usd || 0);
      });"""
src = apply_once(src, old2, new2, "desglose ingresos en el forEach")

# 3) incluir los 3 campos redondeados en el objeto que retorna el mes
old3 = """      return {
        mes: nombre, mesNum: mes,
        ingresos: Math.round(ingresos), cogs: Math.round(cogs), gastos: Math.round(gastos),
        utilidad: Math.round(utilidad),"""
new3 = """      return {
        mes: nombre, mesNum: mes,
        ingresos: Math.round(ingresos), cogs: Math.round(cogs), gastos: Math.round(gastos),
        ingresosConvencional: Math.round(ingresosConvencional),
        ingresosOffBalance: Math.round(ingresosOffBalance),
        ingresosIva: Math.round(ingresosIva),
        utilidad: Math.round(utilidad),"""
src = apply_once(src, old3, new3, "campos de ingresos en el objeto del mes")

# 4) chart: reemplazar la barra unica de Ingresos por las 3 barras apiladas
old4 = """                <Bar dataKey="ingresos" stackId="g" name="Ingresos" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar dataKey="cogsNeg" stackId="g" name="COGS" fill="#7f1d1d" radius={[0, 0, 0, 0]} />"""
new4 = """                <Bar dataKey="ingresosConvencional" stackId="g" name="Ingresos convencionales" fill={COLOR_INGRESOS.convencional} radius={[2, 2, 0, 0]} />
                {dataConAcumulado.some((d) => Math.abs(d.ingresosOffBalance) > 0.49) && (
                  <Bar dataKey="ingresosOffBalance" stackId="g" name="Ingresos off-balance (ajuste)" fill={COLOR_INGRESOS.offBalance} radius={[2, 2, 0, 0]} />
                )}
                {dataConAcumulado.some((d) => Math.abs(d.ingresosIva) > 0.49) && (
                  <Bar dataKey="ingresosIva" stackId="g" name="Ingresos Venta de IVA" fill={COLOR_INGRESOS.iva} radius={[2, 2, 0, 0]} />
                )}
                <Bar dataKey="cogsNeg" stackId="g" name="COGS" fill="#7f1d1d" radius={[0, 0, 0, 0]} />"""
src = apply_once(src, old4, new4, "barras apiladas de ingresos")

# 5) tooltip: mostrar el desglose debajo del total de Ingresos
old5 = """      <Row k="Ingresos" v={d.ingresos} positive />
      <Row k="COGS" v={-d.cogs} />"""
new5 = """      <Row k="Ingresos" v={d.ingresos} positive bold />
      {d.ingresosConvencional > 0 && <Row k="  Convencionales" v={d.ingresosConvencional} positive />}
      {Math.abs(d.ingresosOffBalance) > 0.49 && <Row k="  Off-balance (ajuste)" v={d.ingresosOffBalance} positive />}
      {Math.abs(d.ingresosIva) > 0.49 && <Row k="  Venta de IVA" v={d.ingresosIva} positive />}
      <Row k="COGS" v={-d.cogs} />"""
src = apply_once(src, old5, new5, "tooltip desglose")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK dashboard-charts.tsx")
