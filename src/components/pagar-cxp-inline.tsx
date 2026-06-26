import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { fmtBs, fmtUsd, fmtDate, todayISO } from "@/lib/format";
import { PagoModal } from "@/routes/_authenticated/pagar-cxp";

type Tercero = { id: string; razon_social: string; tipo_rif: string; rif: string };

/**
 * Pago de CxP existente desde el formulario de registro.
 * grupo = "cogs" filtra cuentas que empiezan por "2."; "gastos" filtra el resto.
 */
export function PagarCxPInline({
  grupo,
  terceros,
  onDone,
}: {
  grupo: "cogs" | "gastos";
  terceros: Tercero[];
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const [terceroId, setTerceroId] = useState("");
  const [seleccionada, setSeleccionada] = useState<any | null>(null);

  const { data: cxps, refetch } = useQuery({
    queryKey: ["cxp-inline", terceroId, grupo],
    enabled: !!terceroId,
    queryFn: async () => {
      const { data } = await supabase
        .from("cuentas_por_pagar")
        .select("*, tx:transaccion_id(cuenta_codigo)")
        .eq("tercero_id", terceroId)
        .neq("estado", "pagada")
        .order("fecha_vencimiento", { ascending: true });
      const rows = (data ?? []) as any[];
      return rows.filter((c) => {
        const cc = c.tx?.cuenta_codigo as string | undefined;
        if (!cc) return grupo === "gastos"; // sin link → tratar como gasto
        const esCogs = cc.startsWith("2.");
        return grupo === "cogs" ? esCogs : !esCogs;
      });
    },
  });

  const totalAbierto = useMemo(
    () => (cxps ?? []).reduce((s, c) => s + Number(c.monto_pendiente_bs ?? c.monto_bs ?? 0), 0),
    [cxps],
  );

  const diasVencida = (c: any) => {
    if (!c.fecha_vencimiento) return null;
    const d = Math.floor((Date.now() - new Date(c.fecha_vencimiento).getTime()) / 86400000);
    return d > 0 ? d : null;
  };

  const proveedoresOrdenados = useMemo(
    () => [...terceros].sort((a, b) => a.razon_social.localeCompare(b.razon_social)),
    [terceros],
  );

  return (
    <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
      <div>
        <h3 className="font-semibold text-sm">Pagar factura pendiente (CxP)</h3>
        <p className="text-xs text-muted-foreground">
          Registra el pago de una factura ya registrada {grupo === "cogs" ? "en COGS" : "en Gastos"}. No afecta el G&amp;P (el gasto se contabilizó al crear la factura).
        </p>
      </div>

      <div>
        <Label>Proveedor (RIF o nombre)</Label>
        <Select value={terceroId} onValueChange={(v) => { setTerceroId(v); setSeleccionada(null); }}>
          <SelectTrigger><SelectValue placeholder="Selecciona proveedor…" /></SelectTrigger>
          <SelectContent>
            {proveedoresOrdenados.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.tipo_rif}-{t.rif} · {t.razon_social}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {terceroId && (
        <div className="space-y-2">
          {!cxps || cxps.length === 0 ? (
            <div className="text-xs text-muted-foreground border rounded p-2">
              Este proveedor no tiene facturas pendientes en {grupo === "cogs" ? "COGS" : "Gastos"}.
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                {cxps.length} factura(s) pendiente(s) · Total <span className="mono font-semibold">{fmtBs(totalAbierto)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-1 px-1">N° factura</th>
                      <th className="text-left py-1 px-1">Fecha</th>
                      <th className="text-right py-1 px-1">Original Bs</th>
                      <th className="text-right py-1 px-1">Pendiente Bs</th>
                      <th className="text-right py-1 px-1">≈ USD (BCV)</th>
                      <th className="text-left py-1 px-1">Vence</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cxps.map((c: any) => {
                      const dv = diasVencida(c);
                      const pendBs = Number(c.monto_pendiente_bs ?? c.monto_bs);
                      const ratio = Number(c.monto_bs) > 0 ? pendBs / Number(c.monto_bs) : 1;
                      const usdBcvBase = Number(c.usd_bcv_factura ?? c.monto_usd ?? 0);
                      const pendUsdBcv = c.monto_pendiente_usd_bcv != null
                        ? Number(c.monto_pendiente_usd_bcv)
                        : usdBcvBase * ratio;
                      const tasa = Number(c.tasa_bcv_factura) || (Number(c.monto_bs) > 0 && Number(c.monto_usd) > 0 ? Number(c.monto_bs) / Number(c.monto_usd) : 0);
                      const fechaRef = c.created_at ? String(c.created_at).slice(0, 10) : null;
                      return (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="py-1 px-1 mono">{c.numero_factura ?? "—"}</td>
                          <td className="py-1 px-1 mono">{fechaRef ? fmtDate(fechaRef) : "—"}</td>
                          <td className="py-1 px-1 text-right mono">{fmtBs(c.monto_bs)}</td>
                          <td className="py-1 px-1 text-right mono font-semibold">{fmtBs(pendBs)}</td>
                          <td className="py-1 px-1 text-right mono">
                            <div>{fmtUsd(pendUsdBcv)} <span className="text-[9px] text-muted-foreground">USD BCV</span></div>
                            {tasa > 0 && (
                              <div className="text-[9px] text-muted-foreground font-normal">BCV {tasa.toFixed(2)}</div>
                            )}
                          </td>
                          <td className="py-1 px-1 mono">
                            {c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : "—"}
                            {dv && <Badge variant="destructive" className="ml-1 text-[9px]">venció hace {dv}d</Badge>}
                          </td>
                          <td className="py-1 px-1 text-right">
                            <Button size="sm" type="button" onClick={() => setSeleccionada(c)}>Pagar</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {!terceroId && (
        <div className="text-xs text-muted-foreground">Selecciona un proveedor para ver sus facturas pendientes.</div>
      )}

      {seleccionada && user && (
        <PagoModal
          cxp={seleccionada}
          userId={user.id}
          onClose={() => setSeleccionada(null)}
          onDone={() => { setSeleccionada(null); refetch(); onDone?.(); }}
        />
      )}

      {seleccionada && (() => { const dv = diasVencida(seleccionada); return dv ? (
        <div className="rounded border border-red-300 bg-red-50 text-red-800 text-xs p-2 font-medium">
          ⚠ Esta factura venció hace {dv} días
        </div>
      ) : null; })()}
    </div>
  );
}
