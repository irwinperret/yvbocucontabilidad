import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import logoYV from "@/assets/logo-yv.webp";
import logoBocu from "@/assets/logo-bocu.png";

export const Route = createFileRoute("/_authenticated/inicio")({ component: InicioPage });

function InicioPage() {
  const { user } = useAuth();
  const today = todayISO();

  const { data: tasa } = useQuery({
    queryKey: ["tasa-last"],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").order("fecha", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const { data: hoyTx } = useQuery({
    queryKey: ["tx-hoy", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("monto_base_bs, tasa_bcv, cuenta_codigo")
        .eq("fecha", today)
        .eq("modo", "on_balance");
      return data ?? [];
    },
  });

  const { data: cxcVencidas } = useQuery({
    queryKey: ["cxc-vencidas"],
    queryFn: async () => {
      const { count } = await supabase
        .from("cuentas_por_cobrar").select("*", { count: "exact", head: true })
        .eq("estado", "vigente").lt("fecha_vencimiento", today);
      return count ?? 0;
    },
  });

  const { data: cxpVencidas } = useQuery({
    queryKey: ["cxp-vencidas"],
    queryFn: async () => {
      const { count } = await supabase
        .from("cuentas_por_pagar").select("*", { count: "exact", head: true })
        .eq("estado", "pendiente").lt("fecha_vencimiento", today);
      return count ?? 0;
    },
  });

  const { data: offViejas } = useQuery({
    queryKey: ["off-viejas"],
    queryFn: async () => {
      const limit = new Date(); limit.setDate(limit.getDate() - 15);
      const { count } = await supabase
        .from("transacciones").select("*", { count: "exact", head: true })
        .eq("modo", "off_balance").lt("fecha", limit.toISOString().slice(0,10));
      return count ?? 0;
    },
  });

  const ingresosHoy = (hoyTx ?? []).filter((t: any) => t.cuenta_codigo?.startsWith("1."))
    .reduce((s: number, t: any) => s + Number(t.monto_base_bs) / Number(t.tasa_bcv || 1), 0);
  const gastosHoy = (hoyTx ?? []).filter((t: any) => !t.cuenta_codigo?.startsWith("1."))
    .reduce((s: number, t: any) => s + Number(t.monto_base_bs) / Number(t.tasa_bcv || 1), 0);

  const tasaVencida = tasa && tasa.fecha !== today;
  const fechaTexto = new Date().toLocaleDateString("es-VE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const saludo = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días"; if (h < 19) return "Buenas tardes"; return "Buenas noches";
  })();

  return (
    <div className="space-y-6">
      {/* Hero · marcas */}
      <div className="relative overflow-hidden rounded-lg border bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-950">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
        <div className="flex items-center justify-center gap-8 sm:gap-16 px-6 py-6">
          <img
            src={logoYV}
            alt="Yanqui Victor"
            className="h-16 sm:h-20 w-auto object-contain opacity-90 dark:invert"
          />
          <div className="flex flex-col items-center gap-1">
            <div className="h-12 w-px bg-foreground/30" />
            <span className="text-[9px] tracking-[0.3em] text-muted-foreground uppercase">&amp;</span>
            <div className="h-12 w-px bg-foreground/30" />
          </div>
          <img
            src={logoBocu}
            alt="Bocú"
            className="h-16 sm:h-20 w-auto object-contain opacity-90 dark:invert"
          />
        </div>
        <div className="text-center pb-4 -mt-1">
          <p className="text-[10px] tracking-[0.4em] text-muted-foreground uppercase">
            Yanqui Victor · Bocú
          </p>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{saludo}, {user?.email?.split("@")[0]}</h1>
        <p className="text-sm text-muted-foreground capitalize">{fechaTexto}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tasa BCV</CardTitle></CardHeader>
          <CardContent>
            {tasa ? (
              <>
                <div className="text-2xl font-bold mono">{Number(tasa.tasa).toFixed(2)} Bs</div>
                <div className="text-xs mt-1">
                  {tasaVencida
                    ? <Badge variant="destructive">Sin sincronizar hoy</Badge>
                    : <Badge className="bg-green-600">Vigente · {fmtDate(tasa.fecha)}</Badge>}
                </div>
              </>
            ) : (
              <Link to="/tasa" className="text-sm text-primary underline">Registrar tasa</Link>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transacciones hoy</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono">{hoyTx?.length ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ingresos hoy</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono positive">{fmtUsd(ingresosHoy)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gastos hoy</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold mono negative">{fmtUsd(gastosHoy)}</div></CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-orange-500" />Alertas</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {tasaVencida && <div className="flex justify-between"><span>Tasa BCV no actualizada</span><Link to="/tasa" className="text-primary underline">Actualizar</Link></div>}
            {(cxcVencidas ?? 0) > 0 && <div className="flex justify-between"><span>CxC vencidas</span><Link to="/cxc" className="text-destructive font-semibold">{cxcVencidas}</Link></div>}
            {(cxpVencidas ?? 0) > 0 && <div className="flex justify-between"><span>CxP vencidas</span><Link to="/pagar-cxp" className="text-destructive font-semibold">{cxpVencidas}</Link></div>}
            {(offViejas ?? 0) > 0 && <div className="flex justify-between"><span>Off-balance &gt; 15 días</span><Link to="/off-balance" className="text-orange-600 font-semibold">{offViejas}</Link></div>}
            {!tasaVencida && !cxcVencidas && !cxpVencidas && !offViejas && (
              <p className="text-muted-foreground text-sm">Todo en orden ✓</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
