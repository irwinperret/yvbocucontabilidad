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
import { fetchVentaIvaDelPeriodo, guardarVentaIva } from "@/lib/venta-iva";

/**
 * Entrada rápida de la Venta de IVA del mes en curso, directo desde Inicio.
 * Un solo registro por mes en la cuenta 1.8 -- si ya existe uno para este
 * período, lo actualiza en vez de duplicarlo. Igual que el inventario, se
 * ve también (y se puede editar/borrar) en su propia página /venta-iva.
 */
export function VentaIvaQuickEntry() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const periodo = periodoActual();
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [tocado, setTocado] = useState(false);

  const { data: existente, isLoading } = useQuery({
    queryKey: ["venta-iva-actual", periodo],
    queryFn: () => fetchVentaIvaDelPeriodo(periodo),
  });

  const valorMostrado = tocado ? monto : (existente?.monto_usd != null ? String(existente.monto_usd) : "");

  const guardar = async () => {
    const valorTexto = (monto || valorMostrado).trim();
    if (!valorTexto) return toast.error("Ingresa el monto de Venta de IVA antes de guardar");
    const montoUsd = Number(valorTexto);
    if (!Number.isFinite(montoUsd) || montoUsd < 0) return toast.error("Monto inválido");
    if (!user) return toast.error("Sin sesión");
    setGuardando(true);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const { data: tasaRow } = await tasaBcvQuery(hoy);
      const tasa = Number(tasaRow?.tasa) || 0;
      if (!tasa) { toast.error("No hay tasa BCV para hoy"); return; }
      await guardarVentaIva({
        id: existente?.id,
        fecha: existente?.fecha ?? hoy,
        montoUsd,
        tasaBcv: tasa,
        userId: user.id,
      });
      toast.success(`Venta de IVA de ${periodo} guardada: ${fmtUsd(montoUsd)}`);
      setTocado(false);
      qc.invalidateQueries({ queryKey: ["venta-iva-actual", periodo] });
      qc.invalidateQueries({ queryKey: ["venta-iva"] });
      qc.invalidateQueries({ queryKey: ["home-checklist-mes"] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Error guardando la Venta de IVA");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="pl-9 pr-3 pb-2 -mt-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">↳ Venta de IVA ({periodo}) — USD a tasa BCV de hoy:</span>
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
      <span className="text-[10px] text-muted-foreground/70">se sincroniza con la página de Venta de IVA</span>
    </div>
  );
}
