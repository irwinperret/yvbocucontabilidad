import { createServerFn } from "@tanstack/react-start";
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

async function sumTransacciones(
  supabase: any,
  from: string,
  to: string,
  filters: {
    prefix?: string;
    centro?: string;
    modo?: string;
    codigo?: string;
    montoUsdPositive?: boolean;
  },
) {
  let q = supabase
    .from("transacciones")
    .select("monto_usd", { count: "exact", head: false })
    .gte("fecha", from)
    .lte("fecha", to);
  if (filters.prefix) q = q.like("cuenta_codigo", filters.prefix);
  if (filters.codigo) q = q.eq("cuenta_codigo", filters.codigo);
  if (filters.centro) q = q.eq("centro_costo", filters.centro);
  if (filters.modo) q = q.eq("modo", filters.modo);
  if (filters.montoUsdPositive) q = q.gt("monto_usd", 0);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).reduce((s: number, r: any) => s + Number(r.monto_usd || 0), 0);
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

    const [
      ingresos,
      cogs,
      nomina,
      admin,
      operativos,
      mercadeo,
      generales,
      ing_yv,
      ing_bocu,
      ing_compartido,
      ingresos_prev,
      ingresos_prev2,
    ] = await Promise.all([
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "1.%", modo: "on_balance" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "2.%" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "3.%" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "4.%" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "5.%" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "6.%" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "9.%" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "1.%", centro: "YV", modo: "on_balance" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "1.%", centro: "Bocu", modo: "on_balance" }),
      sumTransacciones(supabase, cur.from, cur.to, { prefix: "1.%", centro: "Compartido", modo: "on_balance" }),
      sumTransacciones(supabase, prev.from, prev.to, { prefix: "1.%", modo: "on_balance" }),
      sumTransacciones(supabase, prev2.from, prev2.to, { prefix: "1.%", modo: "on_balance" }),
    ]);

    const gastos_prev = (
      await Promise.all(
        ["2.%", "3.%", "4.%", "5.%", "6.%", "9.%"].map((p) =>
          sumTransacciones(supabase, prev.from, prev.to, { prefix: p }),
        ),
      )
    ).reduce((a, b) => a + b, 0);

    const gastos_totales = cogs + nomina + admin + operativos + mercadeo + generales;
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

    // Anticipos abiertos
    const anticipos_abiertos_usd = await sumTransacciones(supabase, "1900-01-01", "2999-12-31", {
      codigo: "14.2",
      montoUsdPositive: true,
    });

    // Off balance
    const today = new Date().toISOString().slice(0, 10);
    const { data: offData } = await supabase
      .from("transacciones")
      .select("fecha")
      .eq("modo", "off_balance")
      .gte("fecha", cur.from)
      .lte("fecha", cur.to);
    const off_balance_count = offData?.length ?? 0;
    const off_balance_dias_max = (offData ?? []).reduce((max: number, r: any) => {
      const diff = Math.floor((Date.parse(today) - Date.parse(r.fecha)) / 86400000);
      return Math.max(max, diff);
    }, 0);

    // Tasas
    const { data: tasaRow } = await supabase
      .from("tasas_bcv")
      .select("tasa, tasa_paralela")
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
      utilidad_neta_usd: round(utilidad_neta_usd),
      margen_neto_pct: margen_neto_pct == null ? null : Number((margen_neto_pct * 100).toFixed(2)),
      ingresos_yv: round(ing_yv),
      ingresos_bocu: round(ing_bocu),
      ingresos_compartido: round(ing_compartido),
      cxc_vencidas_usd: round(cxc_vencidas_usd),
      cxc_total_usd: round(cxc_total_usd),
      cxp_vencidas_usd: round(cxp_vencidas_usd),
      cxp_total_usd: round(cxp_total_usd),
      anticipos_abiertos_usd: round(anticipos_abiertos_usd),
      off_balance_count,
      off_balance_dias_max,
      ingresos_mes_anterior: round(ingresos_prev),
      gastos_mes_anterior: round(gastos_prev),
      ingresos_hace_2_meses: round(ingresos_prev2),
      tasa_bcv_hoy: tasaRow?.tasa ?? null,
      tasa_paralela_hoy: tasaRow?.tasa_paralela ?? null,
    };

    if (
      businessSnapshot.ingresos_usd === 0 &&
      gastos_totales === 0 &&
      cxc_total_usd === 0 &&
      cxp_total_usd === 0
    ) {
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
