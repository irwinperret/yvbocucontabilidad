import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtUsd, fmtDate } from "@/lib/format";
import { useAnticiposAbiertosProveedor, saldoAnticipo, type AnticipoProveedor } from "@/lib/anticipos-proveedor";

export type AplicacionSel = { anticipo: AnticipoProveedor; aplicarUsd: number };

export function AnticipoProveedorBanner({
  terceroId,
  facturaTotalUsd,
  onAplicacionesChange,
}: {
  terceroId: string;
  facturaTotalUsd: number;
  onAplicacionesChange: (sel: AplicacionSel[]) => void;
}) {
  const { data: anticipos } = useAnticiposAbiertosProveedor(terceroId);
  const [estado, setEstado] = useState<"oculto" | "ignorado" | "aplicando">("oculto");
  const [seleccion, setSeleccion] = useState<Record<string, { check: boolean; usd: string }>>({});

  const abiertos = (anticipos ?? []).filter((a) => saldoAnticipo(a) > 0.005);
  const totalAbierto = useMemo(() => abiertos.reduce((s, a) => s + saldoAnticipo(a), 0), [abiertos]);

  if (!terceroId || !anticipos) return null;
  if (abiertos.length === 0) return null;

  if (estado === "ignorado") {
    return (
      <div className="text-xs text-muted-foreground border rounded p-2 flex items-center justify-between">
        <span>Anticipos abiertos ignorados ({abiertos.length}).</span>
        <button type="button" className="underline" onClick={() => { setEstado("oculto"); onAplicacionesChange([]); }}>Reconsiderar</button>
      </div>
    );
  }

  if (estado === "oculto") {
    return (
      <div className="rounded border border-amber-400 bg-amber-50 text-amber-900 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
        <div>
          Este proveedor tiene <strong>{abiertos.length}</strong> anticipo(s) abierto(s) por <strong className="mono">{fmtUsd(totalAbierto)}</strong>. ¿Deseas aplicar alguno contra esta factura?
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { setEstado("ignorado"); onAplicacionesChange([]); }}>Ignorar</Button>
          <Button type="button" size="sm" onClick={() => setEstado("aplicando")}>Aplicar anticipo</Button>
        </div>
      </div>
    );
  }

  const recomputar = (next: Record<string, { check: boolean; usd: string }>) => {
    setSeleccion(next);
    const sel: AplicacionSel[] = [];
    for (const a of abiertos) {
      const s = next[a.id];
      if (!s?.check) continue;
      const aplicarRaw = Number(s.usd) || 0;
      const max = saldoAnticipo(a);
      sel.push({ anticipo: a, aplicarUsd: Math.min(Math.max(aplicarRaw, 0), max) });
    }
    // No exceder factura total
    let restante = facturaTotalUsd;
    const adj: AplicacionSel[] = [];
    for (const s of sel) {
      const tomar = Math.min(s.aplicarUsd, restante);
      if (tomar <= 0) continue;
      adj.push({ ...s, aplicarUsd: +tomar.toFixed(2) });
      restante -= tomar;
    }
    onAplicacionesChange(adj);
  };

  return (
    <div className="rounded border border-amber-400 bg-amber-50/60 p-3 space-y-2">
      <div className="text-sm font-medium text-amber-900">Selecciona el/los anticipo(s) a aplicar</div>
      <div className="space-y-1.5">
        {abiertos.map((a) => {
          const max = saldoAnticipo(a);
          const cur = seleccion[a.id] ?? { check: false, usd: String(Math.min(max, facturaTotalUsd).toFixed(2)) };
          return (
            <div key={a.id} className="flex items-center gap-2 text-xs bg-white rounded p-2 border">
              <Checkbox
                checked={cur.check}
                onCheckedChange={(v) => {
                  const next = { ...seleccion, [a.id]: { ...cur, check: !!v } };
                  recomputar(next);
                }}
              />
              <div className="flex-1 grid grid-cols-3 gap-2 items-center">
                <div className="mono">{fmtDate(a.fecha)}</div>
                <div>
                  Saldo <span className="mono font-semibold">{fmtUsd(max)}</span>
                  {a.tasa_bcv ? (
                    <div className="text-[10px] text-muted-foreground">tasa BCV {Number(a.tasa_bcv).toFixed(2)} — {fmtDate(a.fecha)}</div>
                  ) : null}
                </div>
                <div className="text-muted-foreground truncate" title={a.notas ?? ""}>{a.notas ?? "—"}</div>
              </div>
              <div className="w-32">
                <Label className="text-[10px]">Aplicar USD</Label>
                <Input
                  type="number" step="0.01" min="0" max={max}
                  className="mono h-7 text-xs"
                  value={cur.usd}
                  disabled={!cur.check}
                  onChange={(e) => {
                    const next = { ...seleccion, [a.id]: { ...cur, usd: e.target.value } };
                    recomputar(next);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={() => { setEstado("ignorado"); onAplicacionesChange([]); }}>Cancelar</Button>
      </div>
    </div>
  );
}
