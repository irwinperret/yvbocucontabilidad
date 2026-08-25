import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fmtUsd } from "@/lib/format";
import { tasaBcvQuery } from "@/lib/tasas";
import { editarInventarioSnapshot } from "@/lib/inventario.functions";
import { periodoActual } from "@/lib/home-checklist";

function shiftPeriodo(periodo: string, delta: number) {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Entrada rápida del inventario final del mes en curso, directo desde el
 * Inicio. Escribe en la misma tabla (`inventario_snapshots`) que usan
 * Inventarios y el tab de Cierre/COGS en Registrar, así que cualquiera de
 * esas pantallas ve el valor actualizado de inmediato, sin duplicar datos.
 */
export function InventarioFinalQuickEntry() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const periodo = periodoActual();
  const editar = useServerFn(editarInventarioSnapshot);
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [tocado, setTocado] = useState(false);

  const { data: snap, isLoading } = useQuery({
    queryKey: ["inventario-final-actual", periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventario_snapshots")
        .select("id, monto_usd")
        .eq("periodo", periodo)
        .eq("tipo", "final")
        .maybeSingle();
      return data ?? null;
    },
  });

  const valorMostrado = tocado ? monto : (snap?.monto_usd != null ? String(snap.monto_usd) : "");

  const guardar = async () => {
    const montoUsd = Number(monto || valorMostrado);
    if (!Number.isFinite(montoUsd) || montoUsd < 0) return toast.error("Monto inválido");
    if (!user) return toast.error("Sin sesión");
    setGuardando(true);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const { data: tasaRow } = await tasaBcvQuery(hoy);
      const tasa = Number(tasaRow?.tasa) || 0;
      const montoBs = tasa > 0 ? Math.round(montoUsd * tasa * 100) / 100 : 0;

      if (snap?.id) {
        // Ya existía: reusa el mismo flujo que la pantalla de Inventarios,
        // que ya sincroniza el inicial del mes siguiente y recalcula el COGS.
        await editar({
          data: {
            snapshot_id: snap.id,
            monto_usd: montoUsd,
            monto_bs: montoBs,
            tasa_bcv: tasa || null,
            notas: null,
            cascade_next_month: true,
            cascade_prev_month: false,
          },
        });
      } else {
        // Primera vez que se registra este mes: se crea directo, y de paso
        // se deja sincronizado el inicial del mes siguiente si ya existiera.
        await supabase.from("inventario_snapshots").insert({
          periodo, tipo: "final", monto_usd: montoUsd, monto_bs: montoBs,
          tasa_bcv: tasa || null, fecha: hoy, registrado_por: user.id,
        } as any);
        const siguiente = shiftPeriodo(periodo, 1);
        const { data: inicialSiguiente } = await supabase
          .from("inventario_snapshots").select("id")
          .eq("periodo", siguiente).eq("tipo", "inicial").maybeSingle();
        if (inicialSiguiente?.id) {
          await supabase.from("inventario_snapshots").update({
            monto_usd: montoUsd, monto_bs: montoBs, tasa_bcv: tasa || null,
          } as any).eq("id", inicialSiguiente.id);
        } else {
          await supabase.from("inventario_snapshots").insert({
            periodo: siguiente, tipo: "inicial", monto_usd: montoUsd, monto_bs: montoBs,
            tasa_bcv: tasa || null, fecha: hoy, registrado_por: user.id,
          } as any);
        }
      }
      toast.success(`Inventario final de ${periodo} guardado: ${fmtUsd(montoUsd)}`);
      setTocado(false);
      qc.invalidateQueries({ queryKey: ["inventario-final-actual", periodo] });
      qc.invalidateQueries({ queryKey: ["inventario-snapshots"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error guardando el inventario");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="pl-9 pr-3 pb-2 -mt-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">↳ Inventario final ({periodo}):</span>
      <Input
        type="number"
        step="0.01"
        min="0"
        placeholder={isLoading ? "…" : "0.00"}
        value={valorMostrado}
        onChange={(e) => { setMonto(e.target.value); setTocado(true); }}
        onClick={(e) => e.stopPropagation()}
        className="h-7 w-28 text-xs mono"
      />
      <Button size="sm" variant="outline" className="h-7 px-2" disabled={guardando} onClick={(e) => { e.stopPropagation(); guardar(); }}>
        {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
      </Button>
      <span className="text-[10px] text-muted-foreground/70">se sincroniza con Inventarios y COGS</span>
    </div>
  );
}
