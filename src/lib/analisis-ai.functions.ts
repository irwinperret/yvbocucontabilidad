import { createServerFn } from "@tanstack/react-start"; // v3
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  CUENTA_COMPRAS, construirNombrePorTerceroId, construirNombreATerceroId, rankingProveedoresMes,
  type CompraRaw, type Tercero,
} from "@/lib/cogs-proveedores-calc";
import { calcularTotalesIngresosMes, type RowIngresoRaw } from "@/lib/ingresos-detalle-calc";
import { CODIGOS_NOMINA } from "@/lib/indicadores-restaurante-calc";

const InputSchema = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  vista: z.enum(["paralela", "bcv"]).optional().default("paralela"),
  modelo: z.enum(["rapido", "profundo"]).optional().default("rapido"),
});

// Via la pasarela de Lovable AI (mismo LOVABLE_API_KEY, misma facturación
// consolidada) pero con modelos Claude en vez de Gemini Flash / GPT: Gemini
// 3.7 Flash daba análisis de mala calidad para este caso de uso. Si el
// gateway devuelve un error de "modelo no encontrado", el slug exacto puede
// diferir del supuesto aquí (sigue la misma convención que google/... y
// openai/...) — revisar el catálogo de modelos en el dashboard de Lovable.
const MODELOS = {
  rapido: "anthropic/claude-haiku-4.5",
  profundo: "anthropic/claude-sonnet-5",
} as const;

// Mismos valores que DEFAULT_OBJETIVOS en dashboard-indicadores.tsx -- si
// cambian ahí, cambiar también aquí para que el análisis compare contra el
// mismo objetivo que el usuario ve en el dashboard.
const OBJETIVOS = { foodCost: 30, primeCost: 55, margenNeto: 5, concentracion: 22 };

// Grupos que entran en el desglose de "principales cuentas de gasto". Se
// excluyen nómina (CODIGOS_NOMINA) y mercadeo (3.12) porque ya se reportan
// aparte en el snapshot, y COGS no entra aquí porque su detalle real está
// en top_proveedores_cogs_compras (una sola cuenta 2.2 no tiene desglose
// por cuenta, solo por proveedor).
const GRUPOS_GASTO_DETALLE = ["Costos Fijos", "Costos Variables (operativos)"];

const pad2 = (n: number) => String(n).padStart(2, "0");

export const generarAnalisisAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { periodo, vista, modelo } = data;

    // Use DB-side aggregation to avoid Supabase 1000-row limit
    const { data: snapRaw, error: snapErr } = await supabase.rpc("get_analisis_snapshot", { p_periodo: periodo, p_vista: vista } as any);
    if (snapErr) throw snapErr;
    const snap = (snapRaw ?? {}) as any;

    const gastos_totales =
      (snap.cogs_usd ?? 0) +
      (snap.costos_fijos_usd ?? 0) +
      (snap.costos_variables_usd ?? 0);
    const utilidad_neta_usd = (snap.ingresos_usd ?? 0) - gastos_totales;
    const margen_neto_pct = snap.ingresos_usd > 0 ? utilidad_neta_usd / snap.ingresos_usd : null;

    const [anioNum, mesNum] = periodo.split("-").map(Number);
    const incluyeMesAnterior = mesNum > 1;
    const mesAnteriorNum = incluyeMesAnterior ? mesNum - 1 : null;
    const ultimoDiaMes = new Date(anioNum, mesNum, 0).getDate();
    const finMesStr = `${anioNum}-${pad2(mesNum)}-${pad2(ultimoDiaMes)}`;
    // Rango de compras: el mes anterior (si aplica) + el mes actual -- lo
    // que necesita rankingProveedoresMes para calcular variación. Nunca
    // cruza de año (mismo criterio que el resto de "en Detalle": para enero
    // no vale la pena traer diciembre del año anterior solo para esa
    // comparación).
    const inicioRangoComprasStr = incluyeMesAnterior
      ? `${anioNum}-${pad2(mesAnteriorNum as number)}-01`
      : `${anioNum}-${pad2(mesNum)}-01`;

    const { fetchAllRows } = await import("@/lib/fetch-all");

    // CxC / CxP
    const [{ data: cxcData }, cxpData] = await Promise.all([
      supabase.from("cuentas_por_cobrar").select("estado, monto_pendiente_usd"),
      fetchAllRows(async (from, to) =>
        await supabase
          .from("cuentas_por_pagar")
          .select("estado, monto_pendiente_usd_bcv, monto_pendiente_bs")
          .range(from, to),
      ),
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

    // COGS/Compras por proveedor (quién pesó más en el mes), principales
    // cuentas de gasto (fuera de nómina/mercadeo, que ya van aparte) y
    // composición de ingresos (ventas comunes / ajustes / IVA /
    // conciliación) -- mismas fuentes y fórmulas que usan las pantallas
    // "COGS/Compras por Proveedor", "Egresos en Detalle" e "Ingresos en
    // Detalle", para que el análisis AI nunca contradiga lo que el usuario
    // ve ahí.
    const [cuentasGastoRes, comprasRows, terceros, ingresosRows] = await Promise.all([
      supabase.from("plan_de_cuentas").select("codigo,nombre,grupo").eq("afecta_gyp", true),
      fetchAllRows<CompraRaw>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("fecha,monto_bs,monto_base_bs,monto_usd,tasa_bcv,tasa_paralela,tercero_id,referencia")
          .eq("cuenta_codigo", CUENTA_COMPRAS)
          .neq("standby", true)
          .gte("fecha", inicioRangoComprasStr)
          .lte("fecha", finMesStr)
          .range(from, to),
      ),
      fetchAllRows<Tercero>(async (from, to) =>
        await supabase.from("terceros").select("id,nombre_comercial,razon_social").range(from, to),
      ),
      fetchAllRows<RowIngresoRaw>(async (from, to) =>
        await supabase
          .from("transacciones")
          .select("fecha,cuenta_codigo,centro_costo,modo,referencia,notas,monto_bs,monto_base_bs,monto_usd,tasa_bcv,tasa_paralela")
          .like("cuenta_codigo", "1.%")
          .eq("modo", "on_balance")
          .neq("standby", true)
          .gte("fecha", `${anioNum}-${pad2(mesNum)}-01`)
          .lte("fecha", finMesStr)
          .range(from, to),
      ),
    ]);

    const nombrePorTerceroId = construirNombrePorTerceroId(terceros ?? []);
    const nombreATerceroId = construirNombreATerceroId(terceros ?? []);
    const ranking = rankingProveedoresMes(comprasRows ?? [], nombrePorTerceroId, nombreATerceroId, mesNum, vista);
    const top_proveedores_cogs_compras = ranking.slice(0, 5).map((f) => ({
      nombre: f.nombre,
      usd: f.usd,
      pct_del_mes: f.pct,
      variacion_pct_vs_mes_anterior: f.variacionPct,
    }));

    const cuentasGasto = (cuentasGastoRes.data ?? []).filter(
      (c: any) => GRUPOS_GASTO_DETALLE.includes(c.grupo) && !CODIGOS_NOMINA.includes(c.codigo) && c.codigo !== "3.12",
    );
    const codigosGasto = cuentasGasto.map((c: any) => c.codigo);
    const porCuentaActual = new Map<string, number>();
    const porCuentaAnterior = new Map<string, number>();
    if (codigosGasto.length > 0) {
      const view = vista === "bcv" ? "v_transacciones_mensual_bcv" : "v_transacciones_mensual";
      const [{ data: rowsActual }, { data: rowsAnterior }] = await Promise.all([
        supabase.from(view).select("cuenta_codigo,base_usd").eq("anio", anioNum).eq("mes", mesNum).in("cuenta_codigo", codigosGasto),
        incluyeMesAnterior
          ? supabase.from(view).select("cuenta_codigo,base_usd").eq("anio", anioNum).eq("mes", mesAnteriorNum as number).in("cuenta_codigo", codigosGasto)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      (rowsActual ?? []).forEach((r: any) => porCuentaActual.set(r.cuenta_codigo, (porCuentaActual.get(r.cuenta_codigo) ?? 0) + Number(r.base_usd || 0)));
      (rowsAnterior ?? []).forEach((r: any) => porCuentaAnterior.set(r.cuenta_codigo, (porCuentaAnterior.get(r.cuenta_codigo) ?? 0) + Number(r.base_usd || 0)));
    }
    const totalGastoDetalle = Array.from(porCuentaActual.values()).reduce((s, v) => s + v, 0);
    const top_cuentas_gasto = cuentasGasto
      .map((c: any) => {
        const usd = Number((porCuentaActual.get(c.codigo) ?? 0).toFixed(2));
        const prev = porCuentaAnterior.get(c.codigo);
        return {
          nombre: c.nombre,
          usd,
          pct_del_total: totalGastoDetalle > 0 ? Number(((usd / totalGastoDetalle) * 100).toFixed(1)) : 0,
          variacion_pct_vs_mes_anterior: prev != null && prev > 0.01 ? Number((((usd - prev) / prev) * 100).toFixed(1)) : null,
        };
      })
      .filter((f) => Math.abs(f.usd) > 0.009)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 6);

    const ingresosDesglose = calcularTotalesIngresosMes(ingresosRows ?? [], mesNum, vista, false, true);

    const food_cost_pct = snap.ingresos_usd > 0 ? Number(((snap.cogs_usd / snap.ingresos_usd) * 100).toFixed(1)) : null;
    const prime_cost_pct = snap.ingresos_usd > 0 ? Number((((snap.cogs_usd + (snap.nomina_usd ?? 0)) / snap.ingresos_usd) * 100).toFixed(1)) : null;

    const businessSnapshot = {
      periodo,
      vista_usd: vista, // "paralela" o "bcv"
      ingresos_usd: round(snap.ingresos_usd ?? 0),
      cogs_usd: round(snap.cogs_usd ?? 0),
      costos_fijos_usd: round(snap.costos_fijos_usd ?? 0),
      costos_variables_usd: round(snap.costos_variables_usd ?? 0),
      nomina_usd_de_costos_fijos: round(snap.nomina_usd ?? 0),
      gastos_mercadeo_usd_de_costos_fijos: round(snap.gastos_mercadeo_usd ?? 0),
      otros_gastos_gyp_usd: 0,
      utilidad_neta_usd: round(utilidad_neta_usd),
      margen_neto_pct: margen_neto_pct == null ? null : Number((margen_neto_pct * 100).toFixed(2)),
      food_cost_pct,
      prime_cost_pct,
      objetivo_food_cost_pct: OBJETIVOS.foodCost,
      objetivo_prime_cost_pct: OBJETIVOS.primeCost,
      objetivo_margen_neto_pct: OBJETIVOS.margenNeto,
      objetivo_concentracion_proveedor_pct: OBJETIVOS.concentracion,
      top_proveedores_cogs_compras,
      top_cuentas_gasto,
      ingresos_ventas_comunes_usd: ingresosDesglose.ventasComunes,
      ingresos_ajustes_venta_lista_usd: ingresosDesglose.ajustes,
      ingresos_por_iva_usd: ingresosDesglose.ingresosIva,
      ingresos_conciliacion_bancaria_usd: ingresosDesglose.conciliacionBancaria,
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
      tasa_bcv_hoy: bcvRow?.tasa ?? null,
      tasa_paralela_hoy: parRow?.tasa ?? null,
    };

    if (businessSnapshot.ingresos_usd === 0 && gastos_totales === 0 && cxc_total_usd === 0 && cxp_total_usd === 0) {
      return { empty: true as const, snapshot: businessSnapshot };
    }

    const vistaLabel = vista === "bcv" ? "USD a tasa BCV" : "USD a tasa paralela";
    const prompt = `Eres un consultor financiero experto en restaurantes venezolanos. Analiza los siguientes datos financieros del restaurante YV/Bocú para el período ${businessSnapshot.periodo} y proporciona exactamente 3 recomendaciones concretas y accionables basadas en los números. Todos los montos USD están expresados en ${vistaLabel}.

DATOS FINANCIEROS:
${JSON.stringify(businessSnapshot, null, 2)}

Los datos incluyen, además de los totales generales: los indicadores food_cost_pct / prime_cost_pct / margen_neto_pct comparados contra su objetivo (los campos objetivo_*), los proveedores que más pesaron en COGS/Compras del mes (top_proveedores_cogs_compras, con su % de concentración y variación vs. el mes anterior), las principales cuentas de gasto fuera de nómina y mercadeo (top_cuentas_gasto, con su variación vs. el mes anterior), y la composición de los ingresos del mes (ventas comunes vs. ajustes de venta lista vs. IVA vs. conciliación bancaria). Usa esta información para que tus recomendaciones sean específicas (qué proveedor, qué cuenta, qué indicador puntual) en vez de genéricas.

Responde en español. Estructura tu respuesta así:
1. Un párrafo corto de diagnóstico general (máximo 3 oraciones)
2. Exactamente 3 recomendaciones numeradas, cada una con:
   - Título corto en negrita
   - Explicación de máximo 2 oraciones basada en los números específicos
   - Nivel de prioridad: ALTA / MEDIA / BAJA

Sé directo, específico con los números, y práctico. Evita recomendaciones genéricas. Sé breve: no excedas 350 palabras en total.

IMPORTANTE - NO incluyas en tu análisis:
- Comentarios sobre registros off-balance como si fueran sospechosos, no conciliados, o riesgo de distorsión de utilidad
- Alertas o preocupaciones por CxC, CxP, anticipos o ingresos por IVA en cero -- son normales, el IVA cobrado es un pasivo transitorio con el SENIAT, no un ingreso
- Referencias a "días de antigüedad" de off-balance como problema
- NO compares los ingresos de YV vs Bocú ni hagas recomendaciones basadas en la diferencia entre ambas unidades de negocio (por ejemplo: "equilibrar", "cerrar la brecha", "Bocú vende menos que YV", "impulsar Bocú al nivel de YV"). Son unidades de escala y modelo distintos por diseño; trátalas como negocios independientes.
Estos campos son puramente informativos y no representan señales de problema en este negocio.`;

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Falta LOVABLE_API_KEY");

    const model = MODELOS[modelo];
    const esOpenAI = model.startsWith("openai/");
    const limiteSalida = modelo === "profundo" ? 1200 : 800;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        ...(esOpenAI ? { max_completion_tokens: limiteSalida } : { max_tokens: limiteSalida }),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Límite de uso alcanzado, intenta más tarde.");
      if (res.status === 402) throw new Error("SIN_CREDITOS");
      if (res.status === 403) throw new Error("SIN_CREDITOS");
      throw new Error(`Gateway error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const texto = json?.choices?.[0]?.message?.content ?? "";

    return {
      empty: false as const,
      snapshot: businessSnapshot,
      texto,
      modelo,
      generadoEn: new Date().toISOString(),
    };
  });

function round(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}
