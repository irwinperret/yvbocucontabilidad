import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/ayuda")({ component: AyudaPage });

function AyudaPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">¿Cómo funciona este sistema?</h1>
        <p className="text-sm text-muted-foreground mt-1">Esta app analiza el desempeño financiero de YV y Bocú. La mayor parte de la información financiera se carga mensualmente mediante cuatro archivos de Excel. Cada archivo se importa una vez al sistema y, a partir de esa información, la app realiza los cálculos y reportes financieros.</p>
      </div>
      <div className="space-y-4 text-sm leading-6">
        <div>
          <h2 className="font-semibold text-base mb-2">Los cuatro archivos son:</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li><strong>Informe de Ventas Xetux</strong><br />Se genera automáticamente desde Xetux y contiene la información de ventas.</li>
            <li><strong>Informe de Compras Xetux</strong><br />Se genera automáticamente desde Xetux y contiene la información de compras.</li>
            <li><strong>Movimientos Bancarios</strong><br />Contiene los movimientos de las cuentas bancarias y permite identificar y clasificar los ingresos, gastos, pagos y demás movimientos de caja.</li>
            <li><strong>Ajustes de Ventas</strong><br />Contiene las correcciones o ajustes necesarios sobre las ventas reportadas por Xetux.</li>
          </ol>
        </div>
        <p>Una vez cargados estos archivos, el sistema utiliza la información para alimentar <strong>Ganancias y Pérdidas, Flujo de Caja, CapEx, COGS</strong> y los demás reportes financieros. Los movimientos que requieran un registro adicional o una corrección también pueden registrarse directamente mediante <strong>“Registrar movimiento”</strong>.</p>
        <div>
          <h2 className="font-semibold text-base mb-2">Cierre de inventario</h2>
          <p>Al cierre de cada mes se deben registrar los inventarios. El sistema calcula automáticamente el <strong>COGS (Costo de Ventas)</strong> utilizando:</p>
          <p className="font-semibold text-center my-3">Inventario inicial + Compras − Inventario final = COGS</p>
          <p>Si no se registra el cierre de inventario, el COGS queda en cero y, por lo tanto, el <strong>G&amp;P no reflejará correctamente el resultado real del período</strong>.</p>
        </div>
      </div>
    </div>
  );
}
