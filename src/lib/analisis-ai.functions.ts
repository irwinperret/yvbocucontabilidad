import { createServerFn } from "@tanstack/react-start"; //v2
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({ periodo: z.string().regex(/^\d{4}-\d{2}$/) });

function monthRange(periodo: string) {
  const [y, m] = periodo.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

function shiftMonth(periodo: string, delta: number) {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function fetchTxs(supabase: any, from: string, to: string) {
  const { data, error } = await supabase
    .from("transacciones")
    .select("cuenta_codigo, monto_usd, modo, centro_costo, fecha")
    .gte("fecha", from)
    .lte("fecha", to)
    .limit(10000);
  if (error) throw error;
  return data ?? [];
}

export const generarAnalisisAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { periodo } = data;
    const cur = monthRange(periodo);
    const prev = monthRange(shiftMonth(periodo, -1));
    const prev2 = monthRange(shiftMonth(periodo, -2));

    // Cuentas G&P: fuente de verdad = plan_de_cuentas.afecta_gyp
    const { data: cuentasPlan, error: planErr } = await supabase.from("plan_de_cuentas").select("codigo, afecta_gyp");
    if (planErr) throw planErr;
    const gyp = new Set<string>((cuentasPlan ?? []).filter((c: any) => c.afecta_gyp).map((c: any) => c.codigo));

    const [txsCur, txsPrev, txsPrev2] = await Promise.all([
      fetchTxs(supabase, cur.from, cur.to),
      fetchTxs(supabase, prev.from, prev.to),
      fetchTxs(supabase, prev2.from, prev2.to),
    ]);

    const sum = (arr: any[], pred: (t: any) => boolean) =>
      arr.filter(pred).reduce((s, t) => s + Number(t.monto_usd || 0), 0);

    // Ingresos: cuentas 1.x en G&P, on_balance
    const isIngreso = (t: any) =>
      String(t.cuenta_codigo || "").startsWith("1.") && gyp.has(t.cuenta_codigo) && t.modo === "on_balance";
    // COGS: EXCLUSIVAMENTE cuenta 2.2. 2.1 pertenece a FC.
    const isCogs = (t: any) => t.cuenta_codigo === "2.2";
    const byPrefixGyp = (p: string) => (t: any) =>
      String(t.cuenta_codigo || "").startsWith(p) && gyp.has(t.cuenta_codigo);

    const ingresos = sum(txsCur, isIngreso);
    const cogs = sum(txsCur, isCogs);
    const nomina = sum(txsCur, byPrefixGyp("3."));
    const admin = sum(txsCur, byPrefixGyp("4."));
    const operativos = sum(txsCur, byPrefixGyp("5."));
    const mercadeo = sum(txsCur, byPrefixGyp("6."));
    const generales = sum(txsCur, byPrefixGyp("9."));
    // Otros gastos G&P (7.x financieros, 8.x I+D, 10.3/10.7, 11.x, 12.1/12.3, etc.)
    const otros_gyp = sum(
      txsCur,
      (t) =>
        gyp.has(t.cuenta_codigo) &&
        !isIngreso(t) &&
        !isCogs(t) &&
        !["3.", "4.", "5.", "6.", "9."].some((p) => String(t.cuenta_codigo).startsWith(p)),
    );

    const ing_yv = sum(txsCur, (t) => isIngreso(t) && t.centro_costo === "YV");
    const ing_bocu = sum(txsCur, (t) => isIngreso(t) && t.centro_costo === "Bocu");
    const ing_compartido = sum(txsCur, (t) => isIngreso(t) && t.centro_costo === "Compartido");

    const ingresos_prev = sum(txsPrev, isIngreso);
    const ingresos_prev2 = sum(txsPrev2, isIngreso);
    const gastos_prev =
      sum(txsPrev, isCogs) + sum(txsPrev, (t) => !isIngreso(t) && !isCogs(t) && gyp.has(t.cuenta_codigo));

    const gastos_totales = cogs + nomina + admin + operativos + mercadeo + generales + otros_gyp;
    const utilidad_neta_usd = ingresos - gastos_totales;
    const margen_neto_pct = ingresos > 0 ? utilidad_neta_usd / ingresos : null;

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
    const { data: tasaRow } = await supabase
      .from("tasas_bcv")
      .select("tasa_bs_usd, tasa_paralela")
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();

    const businessSnapshot = {
      periodo,
      ingresos_usd: round(ingresos),
      cogs_usd: round(cogs),
      nomina_usd: round(nomina),
      gastos_admin_usd: round(admin),
      gastos_operativos_usd: round(operativos),
      gastos_mercadeo_usd: round(mercadeo),
      gastos_generales_usd: round(generales),
      otros_gastos_gyp_usd: round(otros_gyp),
      utilidad_neta_usd: round(utilidad_neta_usd),
      margen_neto_pct: margen_neto_pct == null ? null : Number((margen_neto_pct * 100).toFixed(2)),
      ingresos_yv: round(ing_yv),
      ingresos_bocu: round(ing_bocu),
      ingresos_compartido: round(ing_compartido),
      cxc_vencidas_usd: round(cxc_vencidas_usd),
      cxc_total_usd: round(cxc_total_usd),
      cxp_vencidas_usd: round(cxp_vencidas_usd),
      cxp_total_usd: round(cxp_total_usd),
      ingresos_mes_anterior: round(ingresos_prev),
      gastos_mes_anterior: round(gastos_prev),
      ingresos_hace_2_meses: round(ingresos_prev2),
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
