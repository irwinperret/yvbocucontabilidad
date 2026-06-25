import { supabase } from "@/integrations/supabase/client";
import { logAudit, isPeriodClosed } from "@/lib/audit";

export type TxRef = {
  id: string;
  fecha: string;
  cuenta_codigo: string;
  monto_bs: number | null;
  monto_usd: number | null;
  notas?: string | null;
  rol?: string; // descriptive: "seleccionada", "pareja off-balance", "venta original", "cobro", "hermano grupo", etc.
};

export type CxcRef = {
  id: string;
  cliente: string;
  monto_usd: number;
  rol: "venta" | "cobro";
};

export type CxpRef = {
  id: string;
  proveedor: string;
  monto_usd: number;
};

export type DeletePlan = {
  transacciones: TxRef[];
  cxc: CxcRef[];
  cxp: CxpRef[];
  propinasCount: number;
  bloqueoMesCerrado: string | null;
  bloqueoAnticipoAplicado: string | null;
  advertencias: string[];
};

export async function analizarBorradoTransaccion(t: any): Promise<DeletePlan> {
  const plan: DeletePlan = {
    transacciones: [
      {
        id: t.id,
        fecha: t.fecha,
        cuenta_codigo: t.cuenta_codigo,
        monto_bs: t.monto_bs,
        monto_usd: t.monto_usd,
        notas: t.notas,
        rol: "seleccionada",
      },
    ],
    cxc: [],
    cxp: [],
    propinasCount: 0,
    bloqueoMesCerrado: null,
    bloqueoAnticipoAplicado: null,
    advertencias: [],
  };

  const visited = new Set<string>([t.id]);
  const addTx = (row: any, rol: string) => {
    if (!row || visited.has(row.id)) return;
    visited.add(row.id);
    plan.transacciones.push({
      id: row.id,
      fecha: row.fecha,
      cuenta_codigo: row.cuenta_codigo,
      monto_bs: row.monto_bs ?? null,
      monto_usd: row.monto_usd ?? null,
      notas: row.notas ?? null,
      rol,
    });
  };

  // 1) CxC: ambos sentidos
  const { data: cxcRows } = await supabase
    .from("cuentas_por_cobrar")
    .select("id, cliente, monto_usd, transaccion_id, transaccion_cobro_id")
    .or(`transaccion_id.eq.${t.id},transaccion_cobro_id.eq.${t.id}`);
  for (const r of cxcRows ?? []) {
    const esVenta = r.transaccion_id === t.id;
    plan.cxc.push({
      id: r.id,
      cliente: r.cliente,
      monto_usd: Number(r.monto_usd) || 0,
      rol: esVenta ? "venta" : "cobro",
    });
    const otherId = esVenta ? r.transaccion_cobro_id : r.transaccion_id;
    if (otherId) {
      const { data: otra } = await supabase
        .from("transacciones")
        .select("id, fecha, cuenta_codigo, monto_bs, monto_usd, notas")
        .eq("id", otherId)
        .maybeSingle();
      if (otra) addTx(otra, esVenta ? "cobro vinculado" : "venta original");
    }
  }

  // 2) CxP
  const { data: cxpRows } = await supabase
    .from("cuentas_por_pagar")
    .select("id, proveedor, monto_usd, transaccion_id")
    .eq("transaccion_id", t.id);
  for (const r of cxpRows ?? []) {
    plan.cxp.push({
      id: r.id,
      proveedor: r.proveedor ?? "—",
      monto_usd: Number(r.monto_usd) || 0,
    });
  }

  // 3) Anticipo (cuenta 14.x con saldo aplicado)
  if (t.cuenta_codigo?.startsWith("14.") && Number(t.monto_usd) > 0) {
    const aplicado = Number(t.anticipo_aplicado_usd ?? 0);
    if (aplicado > 0.005) {
      plan.bloqueoAnticipoAplicado = `Este anticipo ya tiene $${aplicado.toFixed(2)} aplicados contra facturas. Revierte la aplicación antes de eliminarlo.`;
    }
  }

  // 4) Pareja off-balance
  if (t.pareja_off_balance_id) {
    const { data: pareja } = await supabase
      .from("transacciones")
      .select("id, fecha, cuenta_codigo, monto_bs, monto_usd, notas")
      .eq("id", t.pareja_off_balance_id)
      .maybeSingle();
    if (pareja) addTx(pareja, "pareja off-balance");
  }

  // 5) Hermanos por grupo_transaccion_id
  if (t.grupo_transaccion_id) {
    const { data: hermanos } = await supabase
      .from("transacciones")
      .select("id, fecha, cuenta_codigo, monto_bs, monto_usd, notas")
      .eq("grupo_transaccion_id", t.grupo_transaccion_id);
    for (const h of hermanos ?? []) addTx(h, "mismo grupo");
  }

  // 6) Propinas vinculadas a cualquier transacción del plan
  const ids = plan.transacciones.map((x) => x.id);
  if (ids.length) {
    const { count } = await supabase
      .from("propinas")
      .select("id", { count: "exact", head: true })
      .or(
        ids
          .map((id) => `transaccion_entrada_id.eq.${id},transaccion_salida_id.eq.${id}`)
          .join(",")
      );
    plan.propinasCount = count ?? 0;
  }

  // 7) Bloqueo por mes cerrado en cualquiera de las transacciones a eliminar
  for (const tx of plan.transacciones) {
    if (await isPeriodClosed(tx.fecha)) {
      plan.bloqueoMesCerrado = tx.fecha;
      break;
    }
  }

  return plan;
}

export async function ejecutarBorradoTransaccion(plan: DeletePlan): Promise<{ ok: boolean; error?: string }> {
  if (plan.bloqueoMesCerrado) {
    return { ok: false, error: `Hay transacciones en un mes cerrado (${plan.bloqueoMesCerrado}). Reabre el mes primero.` };
  }
  if (plan.bloqueoAnticipoAplicado) {
    return { ok: false, error: plan.bloqueoAnticipoAplicado };
  }

  const txIds = plan.transacciones.map((t) => t.id);

  // 1) CxC primero (FK hacia transacciones)
  if (plan.cxc.length) {
    const { error } = await supabase
      .from("cuentas_por_cobrar")
      .delete()
      .in("id", plan.cxc.map((c) => c.id));
    if (error) return { ok: false, error: `Error eliminando CxC: ${error.message}` };
  }

  // 2) CxP
  if (plan.cxp.length) {
    const { error } = await supabase
      .from("cuentas_por_pagar")
      .delete()
      .in("id", plan.cxp.map((c) => c.id));
    if (error) return { ok: false, error: `Error eliminando CxP: ${error.message}` };
  }

  // 3) Propinas
  if (plan.propinasCount > 0 && txIds.length) {
    const orExpr = txIds
      .map((id) => `transaccion_entrada_id.eq.${id},transaccion_salida_id.eq.${id}`)
      .join(",");
    const { error } = await supabase.from("propinas").delete().or(orExpr);
    if (error) return { ok: false, error: `Error eliminando propinas: ${error.message}` };
  }

  // 4) Romper FK self-reference de pareja off-balance
  await supabase
    .from("transacciones")
    .update({ pareja_off_balance_id: null } as any)
    .in("id", txIds);

  // 5) Eliminar transacciones
  const { error } = await supabase.from("transacciones").delete().in("id", txIds);
  if (error) return { ok: false, error: `Error eliminando transacciones: ${error.message}` };

  // 6) Auditoría
  for (const tx of plan.transacciones) {
    await logAudit("transacciones", "DELETE", tx.id, tx, null);
  }
  for (const c of plan.cxc) {
    await logAudit("cuentas_por_cobrar", "DELETE", c.id, c, null);
  }
  for (const c of plan.cxp) {
    await logAudit("cuentas_por_pagar", "DELETE", c.id, c, null);
  }

  return { ok: true };
}
