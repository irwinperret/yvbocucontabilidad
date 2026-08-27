import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { ChecklistMensualCard } from "@/components/checklist-mensual-card";
import { ConciliacionPendienteCard } from "@/components/conciliacion-pendiente-card";
import logoYV from "@/assets/logo-yv.webp";
import logoBocu from "@/assets/logo-bocu.png";

export const Route = createFileRoute("/_authenticated/inicio")({ component: InicioPage });

function InicioPage() {
  const { user } = useAuth();
  const fechaTexto = new Date().toLocaleDateString("es-VE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const saludo = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días"; if (h < 19) return "Buenas tardes"; return "Buenas noches";
  })();

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Hero · marcas */}
      <div className="relative overflow-hidden rounded-lg border bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-950">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
        <div className="flex items-center justify-center gap-8 sm:gap-16 px-6 py-6">
          <img src={logoYV} alt="Yanqui Victor" className="h-16 sm:h-20 w-auto object-contain opacity-90 dark:invert" />
          <div className="flex flex-col items-center gap-1">
            <div className="h-12 w-px bg-foreground/30" />
            <span className="text-[9px] tracking-[0.3em] text-muted-foreground uppercase">&amp;</span>
            <div className="h-12 w-px bg-foreground/30" />
          </div>
          <img src={logoBocu} alt="Bocú" className="h-16 sm:h-20 w-auto object-contain opacity-90 dark:invert" />
        </div>
        <div className="text-center pb-4 -mt-1">
          <p className="text-[10px] tracking-[0.4em] text-muted-foreground uppercase">Yanqui Victor · Bocú</p>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{saludo}, {user?.email?.split("@")[0]}</h1>
        <p className="text-sm text-muted-foreground capitalize">{fechaTexto}</p>
      </div>

      <ChecklistMensualCard />
      <ConciliacionPendienteCard />

      <Card className="bg-muted/30 border-muted">
        <CardContent className="p-6 space-y-3 text-[15px] leading-relaxed">
          <h2 className="text-lg font-semibold tracking-tight">¿Cómo funciona este sistema?</h2>
          <p>
            Esta app analiza el desempeño financiero de YV y Bocú. La mayor parte de la información financiera se carga mensualmente mediante cuatro archivos de Excel. Cada archivo se importa una vez al sistema y, a partir de esa información, la app realiza los cálculos y reportes financieros.
          </p>
          <p>
            Los cuatro archivos son:
          </p>
          <ol className="list-decimal pl-6 space-y-1">
            <li><span className="font-semibold">Informe de Ventas Xetux:</span> se genera automáticamente desde Xetux y contiene la información de ventas.</li>
            <li><span className="font-semibold">Informe de Compras Xetux:</span> se genera automáticamente desde Xetux y contiene la información de compras.</li>
            <li><span className="font-semibold">Movimientos Bancarios:</span> contiene los movimientos de las cuentas bancarias y permite identificar y clasificar los ingresos, gastos, pagos y demás movimientos de caja.</li>
            <li><span className="font-semibold">Ajustes de Ventas:</span> contiene las correcciones o ajustes necesarios sobre las ventas reportadas por Xetux.</li>
          </ol>
          <p>
            Una vez cargados estos archivos, el sistema utiliza la información para alimentar <span className="font-semibold">Ganancias y Pérdidas, Flujo de Caja, CapEx, COGS</span> y los demás reportes financieros. Los movimientos que requieran un registro adicional o una corrección también pueden registrarse directamente mediante <span className="font-semibold">"Registrar movimiento"</span>.
          </p>
          <h2 className="text-lg font-semibold tracking-tight pt-2">Cierre de inventario</h2>
          <p>
            Al cierre de cada mes se deben registrar los inventarios. El sistema calcula automáticamente el <span className="font-semibold">COGS (Costo de Ventas)</span> utilizando:
          </p>
          <p className="font-mono text-sm">Inventario inicial + Compras − Inventario final = COGS</p>
          <p>
            Si no se registra el cierre de inventario, el COGS queda en cero y, por lo tanto, el <span className="font-semibold">G&amp;P no reflejará correctamente el resultado real del período</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
