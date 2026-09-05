import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Sparkles, Copy, RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, Rocket, Coins } from "lucide-react";
import { currentPeriod, fmtUsd } from "@/lib/format";
import { generarAnalisisAI } from "@/lib/analisis-ai.functions";
import { UsdViewToggle } from "@/components/usd-view-toggle";
import { useUsdView } from "@/lib/usd-view-context";

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

type Modelo = "rapido" | "profundo";
const CACHE_PREFIX = "analisis-ai:";
const cacheKey = (p: string, v: string, mo: Modelo) => `${CACHE_PREFIX}${p}:${v}:${mo}`;

function AnalisisAIPage() {
  const [periodo, setPeriodo] = useState(currentPeriod());
  const { mode, label } = useUsdView();
  const generar = useServerFn(generarAnalisisAI);
  const [confirmando, setConfirmando] = useState(false);
  const [modelo, setModelo] = useState<Modelo>("rapido");
  const [generadoPara, setGeneradoPara] = useState<{ periodo: string; mode: string } | null>(null);
  const [cacheado, setCacheado] = useState<any>(null);
  const [sinCreditos, setSinCreditos] = useState(false);

  // Reutiliza el último análisis guardado para este período/vista/modelo (no consume créditos)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(cacheKey(periodo, mode, modelo));
      const parsed = raw ? JSON.parse(raw) : null;
      setCacheado(parsed);
      if (parsed) setGeneradoPara({ periodo, mode });
    } catch {
      setCacheado(null);
    }
  }, [periodo, mode, modelo]);

  const m = useMutation({
    mutationFn: async (args: { p: string; v: "paralela" | "bcv"; mo: Modelo }) =>
      generar({ data: { periodo: args.p, vista: args.v, modelo: args.mo } }),
    onSuccess: (data, vars) => {
      setGeneradoPara({ periodo: vars.p, mode: vars.v });
      setSinCreditos(false);
      setCacheado(data);
      try {
        localStorage.setItem(cacheKey(vars.p, vars.v, vars.mo), JSON.stringify(data));
      } catch {
        /* cuota de almacenamiento llena: no es crítico */
      }
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (msg.includes("SIN_CREDITOS")) {
        setSinCreditos(true);
        return;
      }
      setSinCreditos(false);
      if (msg.includes("Límite")) toast.error(msg);
      else toast.error("Error al conectar con el servicio de análisis. Intenta de nuevo.");
    },
  });

  const desplegar = () => {
    m.mutate({ p: periodo, v: mode, mo: modelo });
    setConfirmando(false);
  };

  // El resultado ya cargado corresponde a otro período/vista distinto al seleccionado ahora
  const desactualizado = !!generadoPara && (generadoPara.periodo !== periodo || generadoPara.mode !== mode);

  const result = m.data ?? cacheado;
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
        <div className="flex items-end gap-2 flex-wrap">
          <UsdViewToggle />
          <div>
            <Label>Modo</Label>
            <div className="inline-flex items-center rounded-lg border bg-card p-1 text-sm font-medium h-9">
              <button
                type="button"
                onClick={() => setModelo("rapido")}
                className={`px-3 py-1 rounded-md transition-colors ${modelo === "rapido" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Rápido (bajo costo)
              </button>
              <button
                type="button"
                onClick={() => setModelo("profundo")}
                className={`px-3 py-1 rounded-md transition-colors ${modelo === "profundo" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Profundo
              </button>
            </div>
          </div>
          <div>
            <Label>Período</Label>
            <Input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
          </div>
          <Button onClick={() => setConfirmando(true)} disabled={m.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${m.isPending ? "animate-spin" : ""}`} />
            {result ? `Regenerar (${label})` : `Desplegar análisis (${label})`}
          </Button>
        </div>
      </div>

      {desactualizado && !m.isPending && (
        <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm">
              Este análisis es de <strong>{generadoPara?.periodo}</strong>, cambiaste el período o la vista. Vuelve a
              desplegar para generarlo con la selección actual.
            </p>
            <Button size="sm" onClick={() => setConfirmando(true)} disabled={m.isPending}>
              <Rocket className="h-3.5 w-3.5 mr-2" /> Desplegar de nuevo
            </Button>
          </CardContent>
        </Card>
      )}

      {!result && !m.isPending && !m.isError && !sinCreditos && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center gap-4 text-center">
            <Sparkles className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">Aún no se ha generado el análisis de {mesNombre}</p>
              
