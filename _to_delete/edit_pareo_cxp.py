import sys

path = "src/lib/pareo-cxp.ts"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

# 1) sincronizarCxpDesdeVinculos: include monto_solventado_manual_usd in aplicadoUsdBcv
old1 = """  aplicadoUsdBcv = +aplicadoUsdBcv.toFixed(2);

  const pendienteUsd = +Math.max(0, montoOriginalUsdBcv - aplicadoUsdBcv).toFixed(2);"""
new1 = """  // Un monto "solventado manualmente" (factura vieja que se sabe pagada,
  // parcial o totalmente, sin movimiento bancario encontrado) se suma como
  // si fuera un pago más -- ver cerrarCxpSinMovimiento() más abajo.
  aplicadoUsdBcv += Number((cxp as any).monto_solventado_manual_usd) || 0;
  aplicadoUsdBcv = +aplicadoUsdBcv.toFixed(2);

  const pendienteUsd = +Math.max(0, montoOriginalUsdBcv - aplicadoUsdBcv).toFixed(2);"""
src = apply_once(src, old1, new1, "sincronizar: sumar solventado manual")

# 2) cerrarCxpSinMovimiento: montoUsd param + partial branch
old2 = """export async function cerrarCxpSinMovimiento(args: {
  cxp: any;
  nota?: string | null;
  fecha: string;
  userId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { cxp, nota, fecha, userId } = args;
  const antes = {
    estado: cxp.estado,
    monto_pendiente_bs: cxp.monto_pendiente_bs,
    monto_pendiente_usd_bcv: cxp.monto_pendiente_usd_bcv,
    pagada_at: cxp.pagada_at,
  };
  const despues = {
    estado: "pagada",
    pagada_at: new Date(`${fecha}T12:00:00`).toISOString(),
    monto_pendiente_bs: 0,
    monto_pendiente_usd_bcv: 0,
    cierre_manual: true,
    cierre_manual_nota: nota ?? null,
    cierre_manual_fecha: fecha,
    cierre_manual_por: userId,
    cierre_manual_at: new Date().toISOString(),
    // Una factura cerrada sin movimiento no puede seguir "en espera" de uno.
    en_espera_movimiento: false,
    en_espera_por: null,
    en_espera_en: null,
  };
  const { error } = await supabase.from("cuentas_por_pagar").update(despues as any).eq("id", cxp.id);
  if (error) return { ok: false, error: error.message };
  await logAudit("cuentas_por_pagar", "UPDATE", cxp.id, antes, despues);
  return { ok: true };
}"""
new2 = """export async function cerrarCxpSinMovimiento(args: {
  cxp: any;
  nota?: string | null;
  fecha: string;
  userId: string | null;
  /**
   * Monto en USD BCV a solventar. Si se omite, o si cubre el pendiente
   * actual completo, se cierra la factura entera (comportamiento de
   * siempre: estado "pagada", saldo cero, bloqueada contra recálculo con
   * cierre_manual). Si es menor al pendiente, solo se descuenta ese monto
   * y la factura sigue abierta y visible por el resto -- ver
   * monto_solventado_manual_usd.
   */
  montoUsd?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { cxp, nota, fecha, userId } = args;
  const pendienteActual = pendienteUsdBcv(cxp);
  const solicitado = args.montoUsd != null ? Math.max(0, Number(args.montoUsd) || 0) : pendienteActual;
  const montoFinal = Math.min(solicitado, pendienteActual);
  const esCierreTotal = pendienteActual <= 0.01 || montoFinal >= pendienteActual - 0.01;

  if (esCierreTotal) {
    const antes = {
      estado: cxp.estado,
      monto_pendiente_bs: cxp.monto_pendiente_bs,
      monto_pendiente_usd_bcv: cxp.monto_pendiente_usd_bcv,
      pagada_at: cxp.pagada_at,
    };
    const despues = {
      estado: "pagada",
      pagada_at: new Date(`${fecha}T12:00:00`).toISOString(),
      monto_pendiente_bs: 0,
      monto_pendiente_usd_bcv: 0,
      cierre_manual: true,
      cierre_manual_nota: nota ?? null,
      cierre_manual_fecha: fecha,
      cierre_manual_por: userId,
      cierre_manual_at: new Date().toISOString(),
      // Una factura cerrada sin movimiento no puede seguir "en espera" de uno.
      en_espera_movimiento: false,
      en_espera_por: null,
      en_espera_en: null,
    };
    const { error } = await supabase.from("cuentas_por_pagar").update(despues as any).eq("id", cxp.id);
    if (error) return { ok: false, error: error.message };
    await logAudit("cuentas_por_pagar", "UPDATE", cxp.id, antes, despues);
    return { ok: true };
  }

  // Cierre parcial: solo se descuenta `montoFinal`. No se toca cierre_manual
  // -- la factura sigue abierta y su saldo se recalcula desde
  // sincronizarCxpDesdeVinculos(), que ya suma monto_solventado_manual_usd
  // junto con los vínculos reales que tenga.
  const antes = { monto_solventado_manual_usd: (cxp as any).monto_solventado_manual_usd ?? 0 };
  const despues = {
    monto_solventado_manual_usd: +(Number(antes.monto_solventado_manual_usd || 0) + montoFinal).toFixed(2),
    solventado_manual_nota: nota ?? null,
    solventado_manual_fecha: fecha,
    solventado_manual_por: userId,
    solventado_manual_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("cuentas_por_pagar").update(despues as any).eq("id", cxp.id);
  if (error) return { ok: false, error: error.message };
  await logAudit("cuentas_por_pagar", "UPDATE", cxp.id, antes, despues);
  await sincronizarCxpDesdeVinculos(cxp.id);
  return { ok: true };
}

/**
 * Deshace un cierre PARCIAL manual (monto_solventado_manual_usd) sin tocar
 * cierre_manual. Para deshacer un cierre TOTAL se usa
 * reabrirCxpCerradaManual() más abajo.
 */
export async function quitarSolventadoParcialCxp(cxp: any): Promise<{ ok: boolean; error?: string }> {
  const antes = { monto_solventado_manual_usd: (cxp as any).monto_solventado_manual_usd ?? 0 };
  const despues = {
    monto_solventado_manual_usd: 0,
    solventado_manual_nota: null,
    solventado_manual_fecha: null,
    solventado_manual_por: null,
    solventado_manual_at: null,
  };
  const { error } = await supabase.from("cuentas_por_pagar").update(despues as any).eq("id", cxp.id);
  if (error) return { ok: false, error: error.message };
  await logAudit("cuentas_por_pagar", "UPDATE", cxp.id, antes, despues);
  await sincronizarCxpDesdeVinculos(cxp.id);
  return { ok: true };
}"""
src = apply_once(src, old2, new2, "cerrarCxpSinMovimiento + quitarSolventadoParcialCxp")

# 3) New: solventado manual de un MOVIMIENTO bancario. Insert right before
# the "En espera de movimiento" section comment block.
anchor3 = """// ─────────────────────────────────────────────────────────────
// "En espera de movimiento": marca temporal y reversible sobre una factura"""
insert3 = """// ─────────────────────────────────────────────────────────────
// Solventado manual de un MOVIMIENTO bancario: el caso inverso al de
// arriba -- se sabe que este movimiento (o parte de su monto) pagó una
// factura real que nunca se cargó al sistema, así que nunca va a poder
// cruzarse por la vía normal (no hay factura con la que vincularlo). No
// crea ningún vínculo en conciliacion_bancaria: el monto simplemente se
// resta de lo que falta por aplicar de este movimiento -- ver resumenMov()
// en la ficha del proveedor y fetchDeudaNetaReal().
// ─────────────────────────────────────────────────────────────

export async function marcarMovimientoSolventadoManual(args: {
  mov: any;
  montoUsd: number;
  nota?: string | null;
  fecha: string;
  userId: string | null;
  /** Tope defensivo: no deja aplicar más de lo que de verdad falta por aplicar. */
  maxUsd?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { mov, nota, fecha, userId } = args;
  const tope = args.maxUsd != null ? Math.max(0, args.maxUsd) : Infinity;
  const monto = Math.max(0, Math.min(Number(args.montoUsd) || 0, tope));
  if (monto <= 0) return { ok: false, error: "El monto debe ser mayor a cero" };
  const antes = { solventado_manual_usd: (mov as any).solventado_manual_usd ?? 0 };
  const despues = {
    solventado_manual_usd: +(Number(antes.solventado_manual_usd || 0) + monto).toFixed(2),
    solventado_manual_nota: nota ?? null,
    solventado_manual_fecha: fecha,
    solventado_manual_por: userId,
    solventado_manual_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("transacciones").update(despues as any).eq("id", mov.id);
  if (error) return { ok: false, error: error.message };
  await logAudit("transacciones", "UPDATE", mov.id, antes, despues);
  return { ok: true };
}

export async function quitarSolventadoManualMovimiento(mov: any): Promise<{ ok: boolean; error?: string }> {
  const antes = { solventado_manual_usd: (mov as any).solventado_manual_usd ?? 0 };
  const despues = {
    solventado_manual_usd: 0,
    solventado_manual_nota: null,
    solventado_manual_fecha: null,
    solventado_manual_por: null,
    solventado_manual_at: null,
  };
  const { error } = await supabase.from("transacciones").update(despues as any).eq("id", mov.id);
  if (error) return { ok: false, error: error.message };
  await logAudit("transacciones", "UPDATE", mov.id, antes, despues);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// "En espera de movimiento": marca temporal y reversible sobre una factura"""
src = apply_once(src, anchor3, insert3, "insert movimiento solventado functions")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
