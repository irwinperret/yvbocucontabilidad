import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Copy, RefreshCw, Loader2 } from "lucide-react";
import { currentPeriod } from "@/lib/format";
import { generarAnalisisAI } from "@/lib/analisis-ai.functions";

export const Route = createFileRoute("/_authenticated/analisis-ai")({ component: AnalisisAIPage });

type Reco = { titulo: string; cuerpo: string; prioridad: "ALTA" | "MEDIA" | "BAJA" | null };

function parseAnalysis(texto: string): { diagnostico: string; recomendaciones: Reco[] } {
  const lines = texto.split("\n");
  const idxFirst = lines.findIndex((l) => /^\s*\d+[\.\)]/.test(l) || /^##?\s*\d+/.test(l));
  const diagLines = idxFirst === -1 ? lines : lines.slice(0, idxFirst);
  const diagnostico = diagLines.join("\n").replace(/^#+\s*.*\n?/gm, "").trim();

  const rest = idxFirst === -1 ? "" : lines.slice(idxFirst).join("\n");
  const blocks = rest.split(/\n(?=\s*\d+[\.\)]\s)/g).filter((b) => b.trim());
  const recomendaciones: Reco[] = blocks.map((b) => {
    const prioMatch = b.match(/\b(ALTA|MEDIA|BAJA)\b/i);
    const tituloMatch = b.match(/\*\*(.+?)\*\*/);
    let cuerpo = b
      .replace(/^\s*\d+[\.\)]\s*/, "")
      .replace(/\*\*(.+?)\*\*/, "")
      .replace(/\b(Prioridad|Nivel de prioridad)\s*:\s*(ALTA|MEDIA|BAJA)\b/i, "")
      .trim();
    return {
      titulo: tituloMatch?.[1]?.trim() ?? b.split("\n")[0].replace(/^\s*\d+[\.\)]\s*/, "").slice(0, 80),
      cuerpo,
      prioridad: (prioMatch?.[1]?.toUpperCase() as Reco["prioridad"]) ?? null,
    };
  });
  return { diagnostico, recomendaciones };
}

function prioridadColor(p: Reco["prioridad"]) {
  if (p === "ALTA") return "bg-red-500 text-white";
  if (p === "MEDIA") return "bg-yellow-500 text-black";
  if (p === "BAJA") return "bg-green-600 text-white";
  return "bg-muted text-muted-foreground";
}

function AnalisisAIPage() {
  const [periodo, setPeriodo] = useState(currentPeriod());
  const generar = useServerFn(generarAnalisisAI);

  const m = useMutation({
    mutationFn: async (p: string) => generar({ data: { periodo: p } }),
    onError: (e: any) => {
      const msg = e?.message || "";
      if (msg.includes("Límite")) toast.error(msg);
      else if (msg.includes("Créditos")) toast.error(msg);
      else toast.error("Error al conectar con el servicio de análisis. Intenta de nuevo.");
    },
  });

  useEffect(() => {
    m.mutate(periodo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  const result = m.data;
  const parsed = result && !result.empty ? parseAnalysis(result.texto || "") : null;

  const copiar = async () => {
    if (!result || result.empty) return;
    await navigator.clipboard.writeText(result.texto || "");
    toast.success("Análisis copiado");
  };

  const [year, month] = periodo.split("-").map(Number);
  const mesNombre = new Date(year, month - 1, 1).toLocaleDateString("es-VE", { year: "numeric", month: "long" });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6" /> Análisis AI — {mesNombre}
          </h1>
          <p className="text-sm text-muted-foreground">Diagnóstico y recomendaciones generados por IA a partir de tus datos.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>Período</Label>
            <Input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
          </div>
          <Button onClick={() => m.mutate(periodo)} disabled={m.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${m.isPending ? "animate-spin" : ""}`} />
            Actualizar análisis
          </Button>
        </div>
      </div>

      {m.isPending && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Analizando datos financieros...</p>
          </CardContent>
        </Card>
      )}

      {!m.isPending && m.isError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            Error al conectar con el servicio de análisis. Intenta de nuevo.
          </CardContent>
        </Card>
      )}

      {!m.isPending && result?.empty && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No hay suficientes datos para este período.
          </CardContent>
        </Card>
      )}

      {!m.isPending && result && !result.empty && parsed && (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base">Diagnóstico general</CardTitle>
            </CardHeader>
            <CardContent className="text-sm whitespace-pre-wrap leading-relaxed">
              {parsed.diagnostico || <span className="text-muted-foreground">—</span>}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {parsed.recomendaciones.map((r, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{r.titulo}</CardTitle>
                    {r.prioridad && <Badge className={prioridadColor(r.prioridad)}>{r.prioridad}</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="text-sm whitespace-pre-wrap leading-relaxed">{r.cuerpo}</CardContent>
              </Card>
            ))}
            {parsed.recomendaciones.length === 0 && (
              <Card>
                <CardContent className="py-6 text-sm whitespace-pre-wrap">{result.texto}</CardContent>
              </Card>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Análisis generado el {new Date(result.generadoEn).toLocaleString("es-VE")}</span>
            <Button variant="outline" size="sm" onClick={copiar}>
              <Copy className="h-3.5 w-3.5 mr-2" /> Copiar análisis
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
