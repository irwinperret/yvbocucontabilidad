import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";


export type CampoWizard = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
};

export type FilaFallida = {
  id: string;
  titulo: string;
  motivo: string;
  valores: Record<string, any>;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo?: string;
  campos: CampoWizard[];
  items: FilaFallida[];
  /** Registra la fila corregida. Devuelve ok:false + error para mantenerla en la lista. */
  onRegistrar: (item: FilaFallida, valores: Record<string, any>) => Promise<{ ok: boolean; error?: string }>;
  /** Se llama cuando cambian las filas pendientes (resueltas o descartadas). */
  onPendientesChange?: (pendientes: FilaFallida[]) => void;
};

export function ImportacionFallidasWizard({
  open,
  onOpenChange,
  titulo = "Corregir filas fallidas",
  campos,
  items,
  onRegistrar,
  onPendientesChange,
}: Props) {
  const [lista, setLista] = useState<FilaFallida[]>(items);
  const [idx, setIdx] = useState(0);
  const [valores, setValores] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);

  const itemsKey = items.map((i) => i.id).join("|");
  useEffect(() => {
    if (open) {
      setLista(items);
      setIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemsKey]);

  const actual = lista[idx];

  useEffect(() => {
    setValores(actual ? { ...actual.valores } : {});
  }, [actual?.id]);

  // ── Autocompletar tasas según la fecha (usa la más reciente <= fecha) ──
  const [tasaInfo, setTasaInfo] = useState<{ bcv?: string; paralela?: string } | null>(null);
  const tieneTasas = campos.some((c) => c.name === "tasa_bcv" || c.name === "tasa_paralela");
  const fechaValor = String(valores.fecha ?? "").slice(0, 10);
  const lastLookup = useRef<string>("");

  useEffect(() => {
    if (!open || !tieneTasas || !fechaValor) return;
    const key = `${actual?.id ?? ""}|${fechaValor}`;
    if (lastLookup.current === key) return;
    lastLookup.current = key;
    let cancel = false;
    (async () => {
      const [bcvRes, parRes] = await Promise.all([
        supabase.from("tasas_bcv").select("fecha, tasa").lte("fecha", fechaValor).order("fecha", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("tasas_paralela").select("fecha, tasa").lte("fecha", fechaValor).order("fecha", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancel) return;
      const bcv = bcvRes.data as { fecha: string; tasa: number } | null;
      const par = parRes.data as { fecha: string; tasa: number } | null;
      setValores((s) => ({
        ...s,
        tasa_bcv: bcv ? String(bcv.tasa) : s.tasa_bcv ?? "",
        tasa_paralela: par ? String(par.tasa) : s.tasa_paralela ?? "",
      }));
      setTasaInfo({ bcv: bcv?.fecha, paralela: par?.fecha });
    })();
    return () => { cancel = true; };
  }, [open, tieneTasas, fechaValor, actual?.id]);


  const aplicar = (nuevas: FilaFallida[], nuevoIdx: number) => {
    setLista(nuevas);
    onPendientesChange?.(nuevas);
    if (!nuevas.length) {
      onOpenChange(false);
      return;
    }
    setIdx(Math.min(nuevoIdx, nuevas.length - 1));
  };

  const registrar = async () => {
    if (!actual) return;
    setBusy(true);
    try {
      const res = await onRegistrar(actual, valores);
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo registrar la fila");
        return;
      }
      toast.success("Fila registrada");
      aplicar(lista.filter((l) => l.id !== actual.id), idx);
    } finally {
      setBusy(false);
    }
  };

  const descartar = () => {
    if (!actual) return;
    if (!confirm("¿Descartar esta fila? No se registrará ninguna transacción.")) return;
    aplicar(lista.filter((l) => l.id !== actual.id), idx);
  };

  const saltar = () => setIdx((i) => (i + 1 < lista.length ? i + 1 : 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        {!actual ? (
          <div className="text-sm text-muted-foreground py-6">No quedan filas pendientes.</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="outline">Fila {idx + 1} de {lista.length}</Badge>
              <span className="text-xs text-muted-foreground truncate max-w-[60%]">{actual.titulo}</span>
            </div>

            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <span className="font-medium">Motivo del fallo: </span>
              {actual.motivo}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {campos.map((c) => (
                <div key={c.name} className="space-y-1">
                  <Label className="text-xs">{c.label}</Label>
                  {c.type === "select" ? (
                    <Select
                      value={String(valores[c.name] ?? "")}
                      onValueChange={(v) => setValores((s) => ({ ...s, [c.name]: v }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                      <SelectContent>
                        {(c.options ?? []).map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                      step={c.type === "number" ? "0.01" : undefined}
                      value={valores[c.name] ?? ""}
                      onChange={(e) =>
                        setValores((s) => ({
                          ...s,
                          [c.name]: c.type === "number" ? e.target.value : e.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>

            {tieneTasas && tasaInfo && (
              <p className="text-xs text-muted-foreground">
                Tasas cargadas automáticamente — BCV: {tasaInfo.bcv ? `tasa del ${tasaInfo.bcv}` : "sin registro"} ·
                {" "}Paralela: {tasaInfo.paralela ? `tasa del ${tasaInfo.paralela}` : "sin registro"}. Puedes editarlas.
              </p>
            )}

          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={descartar} disabled={!actual || busy}>
            Descartar esta fila
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={saltar} disabled={!actual || busy || lista.length < 2}>
              Saltar por ahora
            </Button>
            <Button onClick={registrar} disabled={!actual || busy}>
              {busy ? "Registrando…" : "Registrar y siguiente"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
