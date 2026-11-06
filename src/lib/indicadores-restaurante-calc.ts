import { MESES } from "@/lib/account-helpers";
import type { UsdViewMode } from "@/lib/usd-view-context";
import { agruparPorProveedorMes, type CompraRaw } from "@/lib/cogs-proveedores-calc";
import { CUENTAS_IVA_INGRESO } from "@/lib/ingresos-detalle-calc";

/**
 * 4 indicadores clave de restaurante, calculados con la misma data que ya
 * usa el resto del sistema (G&P, COGS/Compras por Proveedor) -- nada nuevo
 * que registrar, solo combinarlo distinto:
 *
 *   1. Food cost %   = COGS real (2.2) / Ingresos
 *   2. Prime cost %   = (COGS real + Nómina) / Ingresos
 *   3. Margen neto %  = Utilidad neta / Ingresos
 *   4. Concentración de compras = % del proveedor #1 sobre las compras del mes
 *
 * Thresholds usados (benchmarks de industria, restaurantes en general --
 * Toast POS / Complete Controller / GetBento, consultados nov-2026):
 *   Food cost 28-35% sano · Prime cost ≤55% objetivo moderno · Margen neto
 *   3-5% sano · Concentración de proveedor: >20-25% es criterio de riesgo de
 *   cadena de suministro (no es un benchmark publicado, es manejo de riesgo).
 */

/** Cuentas de nómina (sueldos + sus pasivos laborales) dentro de "Costos
 * Fijos" -- el resto de esa categoría (seguros, honorarios, servicios, etc.)
 * NO es nómina y no cuenta para Prime Cost. */
export const CODIGOS_NOMINA = ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6"];

export type RowIndicador = {
  mes: number;
  cuenta_codigo: string;
  base_usd: number | string | null;
  modo: "on_balance" | "off_balance";
};
export type CuentaIndicador = { codigo: string; afecta_gyp: boolean };

export type FilaIndicadores = {
  mesLabel: string;
  mesNum: number;
  ingresos: number;
  foodCostPct: number | null;
  primeCostPct: number | null;
  margenNetoPct: number | null;
  // Mismo cálculo que foodCostPct (COGS real / Ingresos), expresado en
  // centavos por dólar vendido en vez de porcentaje -- misma convención que
  // "COGS real / $ vendido" en COGS/Compras por Proveedor (cogsPorDolar * 100).
  cogsPorDolar: number | null;
  concentracionTopPct: number | null;
  proveedorTopNombre: string | null;
};

export function construirSerieIndicadores(
  rows: RowIndicador[],
  mapCuentas: Map<string, CuentaIndicador>,
  cogsEstimadoPorMes: Map<string, { cogsUsdBcv: number; cogsUsdParalelo: number }> | undefined,
  comprasAnio: CompraRaw[],
  nombrePorTerceroId: Map<string, string>,
  anio: number,
  mesCorte: number,
  mode: UsdViewMode,
  incluirOff: boolean = true,
  incluirIva: boolean = true,
): FilaIndicadores[] {
  return Array.from({ length: mesCorte }, (_, i) => {
    const mes = i + 1;
    const periodo = `${anio}-${String(mes).padStart(2, "0")}`;

    let ingresos = 0, cogs = 0, nomina = 0, gastosTotal = 0;
    rows.forEach((r) => {
      if (r.mes !== mes) return;
      // Mismo criterio que Ingresos en Detalle: off-balance se incluye o
      // excluye por completo (ingresos, COGS, nomina y gastos juntos -- no
      // solo ingresos, para no comparar unos movimientos on-balance contra
      // otros off-balance).
      if (!incluirOff && r.modo !== "on_balance") return;
      const c = mapCuentas.get(r.cuenta_codigo);
      if (!c?.afecta_gyp) return;
      const base = Number(r.base_usd) || 0;
      if (r.cuenta_codigo.startsWith("1.") || r.cuenta_codigo === "6.1") {
        // Ingresos por IVA (1.8): normalmente $0, el IVA cobrado es un
        // pasivo transitorio con el SENIAT, no un ingreso real -- se puede
        // excluir igual que en Ingresos en Detalle.
        if (!incluirIva && CUENTAS_IVA_INGRESO.includes(r.cuenta_codigo)) return;
        ingresos += base;
      }
      else if (r.cuenta_codigo.startsWith("2.")) cogs += base;
      else {
        gastosTotal += base;
        if (CODIGOS_NOMINA.includes(r.cuenta_codigo)) nomina += base;
      }
    });

    // Mismo criterio que DashboardCharts / Egresos en Detalle: un mes
    // abierto (sin cierre formal) usa el COGS estimado del inventario
    // cargado, no la suma incompleta de transacciones.
    const estimado = cogsEstimadoPorMes?.get(periodo);
    if (estimado) cogs = mode === "paralela" ? estimado.cogsUsdParalelo : estimado.cogsUsdBcv;
    const utilidad = ingresos - cogs - gastosTotal;

    // Concentración de compras: el proveedor #1 de ESE mes (mismo cálculo
    // que la pantalla COGS/Compras por Proveedor) sobre el total del mes.
    const porProv = agruparPorProveedorMes(comprasAnio, nombrePorTerceroId, mes, mode);
    const totalCompras = porProv.reduce((s, p) => s + p.usd, 0);

    return {
      mesLabel: MESES[i],
      mesNum: mes,
      ingresos: Number(ingresos.toFixed(2)),
      foodCostPct: ingresos > 0 ? Number(((cogs / ingresos) * 100).toFixed(1)) : null,
      primeCostPct: ingresos > 0 ? Number((((cogs + nomina) / ingresos) * 100).toFixed(1)) : null,
      margenNetoPct: ingresos > 0 ? Number(((utilidad / ingresos) * 100).toFixed(1)) : null,
      cogsPorDolar: ingresos > 0 ? Number(((cogs / ingresos) * 100).toFixed(1)) : null,
      concentracionTopPct: totalCompras > 0 && porProv[0] ? Number(((porProv[0].usd / totalCompras) * 100).toFixed(1)) : null,
      proveedorTopNombre: porProv[0]?.nombre ?? null,
    };
  });
}
