import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

path = "mnt/yvbocucontabilidad/src/routes/_authenticated/pagar-cxp.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old_import = '''import { dentroDeTolerancia, pendienteBsAFecha, pendienteBsHistorico, pendienteUsdBcv as saldoUsdBcv } from "@/lib/cxp-saldo";'''
new_import = '''import { dentroDeTolerancia, pendienteBsAFecha, pendienteBsHistorico, pendienteUsdBcv as saldoUsdBcv } from "@/lib/cxp-saldo";
import { fetchDeudaNetaReal } from "@/lib/deuda-neta";'''
src = apply_once(src, old_import, new_import, "import fetchDeudaNetaReal")

old_query = '''  const { data: tasaHoy = 0 } = useQuery({
    queryKey: ["tasa-bcv-cxp-hoy", todayISO()],
    queryFn: async () => {
      const { data } = await tasaBcvQuery(todayISO(), "tasa");
      return Number(data?.tasa) || 0;
    },
  });'''
new_query = '''  const { data: tasaHoy = 0 } = useQuery({
    queryKey: ["tasa-bcv-cxp-hoy", todayISO()],
    queryFn: async () => {
      const { data } = await tasaBcvQuery(todayISO(), "tasa");
      return Number(data?.tasa) || 0;
    },
  });

  const { data: deudaNeta } = useQuery({
    queryKey: ["deuda-neta-real-total"],
    staleTime: 60_000,
    queryFn: fetchDeudaNetaReal,
  });'''
src = apply_once(src, old_query, new_query, "deudaNeta query")

old_jsx = '''      <div className="grid gap-4 md:grid-cols-4">
        <KpiCxP label="Vencidas (USD BCV)" value={fmtUsd(totalVencidas)} count={vencidas.length} color="negative" />'''
new_jsx = '''      <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Deuda neta real (toda la empresa)</div>
          <div className="text-3xl font-extrabold mono text-primary">{deudaNeta ? fmtUsd(deudaNeta.deudaNetaRealUsd) : "…"}</div>
        </div>
        <p className="text-xs text-muted-foreground max-w-sm text-right">
          Facturas sin movimiento ({deudaNeta ? fmtUsd(deudaNeta.facturasSinMovimientoUsd) : "…"}) menos pagos que ya se hicieron a algún proveedor y todavía no se cruzaron contra ninguna factura ({deudaNeta ? fmtUsd(deudaNeta.pagosSinCruzarUsd) : "…"}).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCxP label="Vencidas (USD BCV)" value={fmtUsd(totalVencidas)} count={vencidas.length} color="negative" />'''
src = apply_once(src, old_jsx, new_jsx, "banner JSX")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
