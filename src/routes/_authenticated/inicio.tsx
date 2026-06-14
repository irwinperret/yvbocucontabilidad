import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { CierrePendienteBanner } from "@/components/cierre-pendiente-banner";
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
      <CierrePendienteBanner />
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

      <Card className="bg-muted/30 border-muted">
        <CardContent className="p-6 space-y-3 text-[15px] leading-relaxed">
          <h2 className="text-lg font-semibold tracking-tight">¿Cómo funciona este sistema?</h2>
          <p>
            Este app analiza el desempeño financiero de YV y Bocú en tiempo real. Los ingresos y compras vienen
            de los reportes que genera Xetux y se importan periódicamente al sistema.
          </p>
          <p>
            Todo lo que no esté en esos reportes — nómina, gastos administrativos, operativos, generales,
            mercadeo, pagos financieros y cualquier otro movimiento de caja — se registra manualmente en la
            sección <span className="font-semibold">"Registrar movimiento"</span>.
          </p>
          <p>
            Al cierre de mes se registran los inventarios y el sistema calcula el COGS:{" "}
            <span className="font-mono text-sm">Inventario inicial + Compras − Inventario final</span>.
            Sin ese cierre el COGS queda en cero y el G&amp;P no refleja la realidad.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
