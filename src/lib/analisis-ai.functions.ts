import { createServerFn } from "@tanstack/react-start"; // v3
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({ periodo: z.string().regex(/^\d{4}-\d{2}$/) });

export const generarAnalisisAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { periodo } = data;

    // Use DB-side aggregation to avoid Supabase 1000-row limit
    const { data: snapRaw, error: snapErr } = await supabase.rpc("get_analisis_snapshot", { p_periodo: periodo });
    if (snapErr) throw snapErr;
    const snap = (snapRaw ?? {}) as any;

    const gastos_totales =
      (snap.cogs_usd ?? 0) +
      (snap.nomina_usd ?? 0) +
      (snap.gastos_admin_usd ?? 0) +
      (snap.gastos_operativos_usd ?? 0) +
      (snap.gastos_mercadeo_usd ?? 0) +
      (snap.gastos_generales_usd ?? 0);
    const utilidad_neta_usd = (snap.ingresos_usd ?? 0) - gastos_totales;
    const margen_neto_pct = snap.ingresos_usd > 0 ? utilidad_neta_usd / snap.ingresos_usd : null;

    // CxC / CxP
    const [{ data: cxcData }, { data: cxpData }] = await Promise.all([
      supabase.from("cuentas_por_cobrar").select("estado, monto_pendiente_usd"),
      supabase.from("cuentas_por_pagar").select("estado, monto_pendiente_usd_bcv, monto_pendiente_bs"),
    ]);
    const cxc_vencidas_usd = (cxcData ?? [])
      .filter((r: any) => r.estado === "vencida")
      .reduce((s: number, r: any) => s + Number(r.monto_pendiente_usd || 0), 0);
    const cxc_total_usd = (cxcData ?? [])
      .filter((r: any) => r.estado !== "cobrada")
      .reduce((s: number, r: any) => s + Number(r.monto_pendiente_usd || 0), 0);
    const cxp_vencidas_usd = (cxpData ?? [])
      .filter((r: any) => r.estado === "vencida")
      .reduce((s: number, r: any) => s + Number(r.monto_pendiente_usd_bcv || 0), 0);
    const cxp_total_usd = (cxpData ?? [])
      .filter((r: any) => r.estado !== "pagada")
      .reduce((s: number, r: any) => s + Number(r.monto_pendiente_usd_bcv || 0), 0);

    // Tasas
    const [{ data: bcvRow }, { data: parRow }] = await Promise.all([
      supabase.from("tasas_bcv").select("tasa").order("fecha", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("tasas_paralela").select("tasa").order("fecha", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const businessSnapshot = {
      periodo,
      ingresos_usd: round(snap.ingresos_usd ?? 0),
      cogs_usd: round(snap.cogs_usd ?? 0),
      nomina_usd: round(snap.nomina_usd ?? 0),
      gastos_admin_usd: round(snap.gastos_admin_usd ?? 0),
      gastos_operativos_usd: round(snap.gastos_operativos_usd ?? 0),
      gastos_mercadeo_usd: round(snap.gastos_mercadeo_usd ?? 0),
      gastos_generales_usd: round(snap.gastos_generales_usd ?? 0),
      otros_gastos_gyp_usd: 0,
      utilidad_neta_usd: round(utilidad_neta_usd),
      margen_neto_pct: margen_neto_pct == null ? null : Number((margen_neto_pct * 100).toFixed(2)),
      ingresos_yv: round(snap.ingresos_yv ?? 0),
      ingresos_bocu: round(snap.ingresos_bocu ?? 0),
      ingresos_compartido: 0,
      cxc_vencidas_usd: round(cxc_vencidas_usd),
      cxc_total_usd: round(cxc_total_usd),
      cxp_vencidas_usd: round(cxp_vencidas_usd),
      cxp_total_usd: round(cxp_total_usd),
      ingresos_mes_anterior: round(snap.ingresos_mes_anterior ?? 0),
      gastos_mes_anterior: 0,
      ingresos_hace_2_meses: round(snap.ingresos_hace_2_meses ?? 0),
      tasa_bcv_hoy: tasaRow?.tasa_bs_usd ?? null,
      tasa_paralela_hoy: tasaRow?.tasa_paralela ?? null,
    };

    if (businessSnapshot.ingresos_usd === 0 && gastos_totales === 0 && cxc_total_usd === 0 && cxp_total_usd === 0) {
      return { empty: true as const, snapshot: businessSnapshot };
    }

    const prompt = `Eres un consultor financiero experto en restaurantes venezolanos. Analiza los siguientes datos financieros del restaurante YV/Bocú para el período ${businessSnapshot.periodo} y proporciona entre 3 y 5 recomendaciones concretas y accionables basadas en los números.

DATOS FINANCIEROS:
${JSON.stringify(businessSnapshot, null, 2)}

Responde en español. Estructura tu respuesta así:
1. Un párrafo corto de diagnóstico general (máximo 3 oraciones)
2. Entre 3 y 5 recomendaciones numeradas, cada una con:
   - Título corto en negrita
   - Explicación de máximo 2 oraciones basada en los números específicos
   - Nivel de prioridad: ALTA / MEDIA / BAJA

Sé directo, específico con los números, y práctico. Evita recomendaciones genéricas.

IMPORTANTE - NO incluyas en tu análisis:
- Comentarios sobre registros off-balance como si fueran sospechosos, no conciliados, o riesgo de distorsión de utilidad
- Alertas o preocupaciones por CxC, CxP o anticipos en cero
- Referencias a "días de antigüedad" de off-balance como problema
Estos campos son puramente informativos y no representan señales de problema en este negocio.`;

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Falta LOVABLE_API_KEY");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "openai/gpt-5.5",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Límite de uso alcanzado, intenta más tarde.");
      if (res.status === 402) throw new Error("Créditos agotados en Lovable AI.");
      throw new Error(`Gateway error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const texto = json?.choices?.[0]?.message?.content ?? "";

    return {
      empty: false as const,
      snapshot: businessSnapshot,
      texto,
      generadoEn: new Date().toISOString(),
    };
  });

function round(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}
