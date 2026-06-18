import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtUsd, fmtDate } from "@/lib/format";
import { useAnticiposAbiertosProveedor, saldoAnticipo, type AnticipoProveedor } from "@/lib/anticipos-proveedor";

export type AplicacionSel = { anticipo: AnticipoProveedor; aplicarUsd: number };

type Row = { check: boolean; usd: string; touched: boolean };

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
  const [seleccion, setSeleccion] = useState<Record<string, Row>>({});

  const abiertos = useMemo(
    () => (anticipos ?? []).filter((a) => saldoAnticipo(a) > 0.005),
    [anticipos],
  );
  const totalAbierto = useMemo(() => abiertos.reduce((s, a) => s + saldoAnticipo(a), 0), [abiertos]);

  // Calcula la selección efectiva (clamp por saldo del anticipo y por total de factura)
  const emit = (rows: Record<string, Row>) => {
    const sel: AplicacionSel[] = [];
    let restante = Math.max(0, facturaTotalUsd);
    for (const a of abiertos) {
      const r = rows[a.id];
      if (!r?.check) continue;
      const max = saldoAnticipo(a);
      const pedido = Math.max(0, Number(r.usd) || 0);
      const tomar = Math.min(pedido, max, restante);
      if (tomar > 0.005) {
        sel.push({ anticipo: a, aplicarUsd: +tomar.toFixed(2) });
        restante -= tomar;
      }
    }
    onAplicacionesChange(sel);
  };

  // Auto-recalcular USD por defecto cuando cambia el total de la factura (si el usuario no lo tocó)
  const lastTotalRef = useRef<number>(facturaTotalUsd);
  useEffect(() => {
    if (lastTotalRef.current === facturaTotalUsd) return;
    lastTotalRef.current = facturaTotalUsd;
    if (estado !== "aplicando") return;
    setSeleccion((prev) => {
      const next: Record<string, Row> = { ...prev };
      let restante = Math.max(0, facturaTotalUsd);
      for (const a of abiertos) {
        const r = next[a.id];
        if (!r?.check) continue;
        if (r.touched) {
          restante -= Math.min(Number(r.usd) || 0, saldoAnticipo(a), restante);
          continue;
        }
        const sugerido = Math.min(saldoAnticipo(a), Math.max(0, restante));
        next[a.id] = { ...r, usd: sugerido.toFixed(2) };
        restante -= sugerido;
      }
      // emit con los valores nuevos
      const sel: AplicacionSel[] = [];
      let rem = Math.max(0, facturaTotalUsd);
      for (const a of abiertos) {
        const r = next[a.id];
        if (!r?.check) continue;
        const max = saldoAnticipo(a);
        const pedido = Math.max(0, Number(r.usd) || 0);
        const tomar = Math.min(pedido, max, rem);
        if (tomar > 0.005) {
          sel.push({ anticipo: a, aplicarUsd: +tomar.toFixed(2) });
          rem -= tomar;
        }
      }
      onAplicacionesChange(sel);
      return next;
    });
  }, [facturaTotalUsd, abiertos, estado]);

  if (!terceroId || !anticipos) return null;
  if (abiertos.length === 0) return null;

  if (estado === "ignorado") {
    return (
      <div className="text-xs text-muted-foreground border rounded p-2 flex items-center justify-between">
        <span>Anticipos abiertos ignorados ({abiertos.length}).</span>
        <button
          type="button"
          className="underline"
          onClick={() => { setEstado("oculto"); setSeleccion({}); onAplicacionesChange([]); }}
        >
          Reconsiderar
        </button>
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

  const toggleCheck = (a: AnticipoProveedor, checked: boolean) => {
    setSeleccion((prev) => {
      const next: Record<string, Row> = { ...prev };
      if (checked) {
        // sugerir USD = min(saldo, restante de factura sobre lo ya seleccionado)
        let usados = 0;
        for (const x of abiertos) {
          if (x.id === a.id) continue;
          const r = next[x.id];
          if (r?.check) usados += Math.min(Number(r.usd) || 0, saldoAnticipo(x));
        }
        const restante = Math.max(0, facturaTotalUsd - usados);
        const sugerido = Math.min(saldoAnticipo(a), restante);
        next[a.id] = { check: true, usd: sugerido.toFixed(2), touched: false };
      } else {
        next[a.id] = { check: false, usd: next[a.id]?.usd ?? "0.00", touched: next[a.id]?.touched ?? false };
      }
      emit(next);
      return next;
    });
  };

  const editUsd = (a: AnticipoProveedor, value: string) => {
    setSeleccion((prev) => {
      const next: Record<string, Row> = { ...prev };
      const cur = next[a.id] ?? { check: true, usd: value, touched: true };
      next[a.id] = { ...cur, usd: value, touched: true };
      emit(next);
      return next;
    });
  };

  return (
    <div className="rounded border border-amber-400 bg-amber-50/60 p-3 space-y-2">
      <div className="text-sm font-medium text-amber-900">Selecciona el/los anticipo(s) a aplicar</div>
      <div className="text-[11px] text-amber-900/80">
        Total factura: <span className="mono font-semibold">{fmtUsd(facturaTotalUsd)}</span>
      </div>
      <div className="space-y-1.5">
        {abiertos.map((a) => {
          const max = saldoAnticipo(a);
          const row = seleccion[a.id] ?? { check: false, usd: "0.00", touched: false };
          return (
            <div key={a.id} className="flex items-center gap-2 text-xs bg-white rounded p-2 border">
              <Checkbox
                checked={row.check}
                onCheckedChange={(v) => toggleCheck(a, !!v)}
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
                  value={row.usd}
                  disabled={!row.check}
                  onChange={(e) => editUsd(a, e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={() => { setSeleccion({}); setEstado("ignorado"); onAplicacionesChange([]); }}>Cancelar</Button>
      </div>
    </div>
  );
}
