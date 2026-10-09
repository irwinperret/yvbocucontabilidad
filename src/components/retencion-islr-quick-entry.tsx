import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fmtUsd } from "@/lib/format";
import { tasaBcvQuery } from "@/lib/tasas";
import { periodoActual } from "@/lib/home-checklist";
import { fetchReclasificacionDelPeriodo, guardarReclasificacionIslr } from "@/lib/retencion-islr-reclass";

/**
 * Entrada rápida de la reclasificación ISLR del mes en curso, directo desde
 * Inicio. Un solo monto por mes: se resta a 4.8 y se suma a 9.5. Si ya
 * existe una reclasificación completa para este período, la actualiza en
 * vez de duplicarla. También se ve (y se puede editar/borrar) en
 * /retencion-islr.
 */
export function RetencionIslrQuickEntry() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const periodo = periodoActual();
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [tocado, setTocado] = useState(false);

  const { data: existente, isLoading } = useQuery({
    queryKey: ["retencion-islr-actual", periodo],
    queryFn: () => fetchReclasificacionDelPeriodo(periodo),
  });

  const valorMostrado = tocado ? monto : (existente?.montoUsd != null ? String(existente.montoUsd) : "");

  const guardar = async () => {
    const valorTexto = (monto || valorMostrado).trim();
    if (!valorTexto) return toast.error("Ingresa el monto de ISLR retenido antes de guardar");
    const montoUsd = Number(valorTexto);
    if (!Number.isFinite(montoUsd) || montoUsd < 0) return toast.error("Monto inválido");
    if (!user) return toast.error("Sin sesión");
    setGuardando(true);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const { data: tasaRow } = await tasaBcvQuery(hoy);
      const tasa = Number(tasaRow?.tasa) || 0;
      if (!tasa) { toast.error("No hay tasa BCV para hoy"); return; }
      await guardarReclasificacionIslr({
        grupoId: existente?.grupoId ?? null,
        ids: existente?.id48 ? { id95: existente.id95, id48: existente.id48 } : null,
        fecha: existente?.fecha ?? hoy,
        montoUsd,
        tasaBcv: tasa,
        userId: user.id,
      });
      toast.success(`Retención ISLR de ${periodo} guardada: ${fmtUsd(montoUsd)}`);
      setTocado(false);
      qc.invalidateQueries({ queryKey: ["retencion-islr-actual", periodo] });
      qc.invalidateQueries({ queryKey: ["retencion-islr-reclasificaciones"] });
      qc.invalidateQueries({ queryKey: ["home-checklist-mes"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error guardando la retención ISLR");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="pl-9 pr-3 pb-2 -mt-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">↳ Retención ISLR ({periodo}) — USD retenido este mes:</span>
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
      <span className="text-[10px] text-muted-foreground/70">resta de 4.8, suma a 9.5 · ver /retencion-islr</span>
    </div>
  );
}
