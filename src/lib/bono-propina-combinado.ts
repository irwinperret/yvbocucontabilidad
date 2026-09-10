import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

export type ResultadoDistribucionCombinada = {
  ok: boolean;
  error?: string;
  bono10Count?: number;
  propinaCount?: number;
  bono10Bs?: number;
  propinaBs?: number;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Distribuye en bloque TODO lo pendiente de Bono 10% (8.3) y Propinas (8.1)
 * con fecha <= la fecha de corte dada, contra UN solo pago bancario real.
 *
 * Reemplaza el supuesto anterior (equivocado) de que el bono 10% venía
 * incluido en la transferencia de nómina general: en realidad el negocio
 * paga bono 10% + propinas juntos, en una transferencia aparte, que
 * normalmente cubre TODO lo acumulado hasta esa fecha.
 *
 * Crea hasta 2 transacciones de salida (una por cada pasivo con algo
 * pendiente), comparte grupo_transaccion_id y va contra la cuenta bancaria
 * real del pago — así el FC queda correcto, a diferencia del cierre de mes
 * automático anterior que descargaba el pasivo sin tocar ningún banco.
 *
 * Se usa tanto al importar movimientos bancarios (detección automática por
 * texto "bono"/"propina" en el concepto) como desde el botón manual
 * "Distribuir todo pendiente" en las pantallas Bono 10% y Propinas.
 */
export async function distribuirBonoPropinaCombinado(args: {
  /** Fecha de corte: se distribuye TODO lo pendiente con fecha <= esta. */
  fecha: string;
  /** Monto real del pago bancario, en Bs (positivo). */
  montoBs: number;
  /** Monto real del pago bancario, en USD (positivo). */
  montoUsd: number;
  tasaBcv: number | null;
  tasaParalela: number | null;
  cuentaBancariaId: string;
  userId: string;
  /** Huella de dedupe del banco — solo aplica cuando viene de una importación. */
  referenciaBanco?: string | null;
  /** Texto descriptivo de origen, para las notas de las transacciones creadas. */
  origenNota: string;
  batchId?: string | null;
  /** Tolerancia en Bs contra el total pendiente. Por defecto: 1% o 5 Bs, lo mayor. */
  toleranciaBs?: number;
}): Promise<ResultadoDistribucionCombinada> {
  const {
    fecha, montoBs, montoUsd, tasaBcv, tasaParalela, cuentaBancariaId,
    userId, referenciaBanco, origenNota, batchId, toleranciaBs,
  } = args;

  const [{ data: bonosPend, error: eB }, { data: propsPend, error: eP }] = await Promise.all([
    supabase.from("bonos_10").select("id, monto_bs, monto_usd").is("transaccion_salida_id", null).lte("fecha", fecha),
    supabase.from("propinas").select("id, monto_bs, monto_usd").is("transaccion_salida_id", null).lte("fecha", fecha),
  ]);
  if (eB) return { ok: false, error: eB.message };
  if (eP) return { ok: false, error: eP.message };

  const bonos = (bonosPend ?? []) as any[];
  const props = (propsPend ?? []) as any[];
  const totalBonoBs = bonos.reduce((s, b) => s + (Number(b.monto_bs) || 0), 0);
  const totalBonoUsd = bonos.reduce((s, b) => s + (Number(b.monto_usd) || 0), 0);
  const totalPropBs = props.reduce((s, p) => s + (Number(p.monto_bs) || 0), 0);
  const totalPropUsd = props.reduce((s, p) => s + (Number(p.monto_usd) || 0), 0);
  const totalPendienteBs = totalBonoBs + totalPropBs;

  if (bonos.length === 0 && props.length === 0) {
    return { ok: false, error: "No hay Bono 10% ni Propinas pendientes de distribuir hasta esa fecha" };
  }

  const tolerancia = toleranciaBs ?? Math.max(totalPendienteBs * 0.01, 5);
  if (Math.abs(montoBs - totalPendienteBs) > tolerancia) {
    return {
      ok: false,
      error: `El monto no cuadra con lo pendiente: pendiente ${totalBonoBs.toFixed(2)} Bs (bono10, ${bonos.length}) + ${totalPropBs.toFixed(2)} Bs (propina, ${props.length}) = ${totalPendienteBs.toFixed(2)} Bs, vs. ${montoBs.toFixed(2)} Bs pagados.`,
      bono10Count: bonos.length,
      propinaCount: props.length,
      bono10Bs: totalBonoBs,
      propinaBs: totalPropBs,
    };
  }

  const grupoId = crypto.randomUUID();
  // El residuo de redondeo (si lo hay) entre lo transferido y la suma exacta
  // de lo pendiente se le suma a la pata más grande — mismo criterio que el
  // reparto de Servicios — para que el banco cuadre exacto.
  const residuoBs = montoBs - totalPendienteBs;
  const residuoUsd = montoUsd - (totalBonoUsd + totalPropUsd);
  const bonoEsMayor = totalBonoBs >= totalPropBs;
  const legBonoBs = +(totalBonoBs + (bonoEsMayor ? residuoBs : 0)).toFixed(2);
  const legBonoUsd = +(totalBonoUsd + (bonoEsMayor ? residuoUsd : 0)).toFixed(2);
  const legPropBs = +(totalPropBs + (bonoEsMayor ? 0 : residuoBs)).toFixed(2);
  const legPropUsd = +(totalPropUsd + (bonoEsMayor ? 0 : residuoUsd)).toFixed(2);

  const payloads: any[] = [];
  if (bonos.length > 0) {
    payloads.push({
      fecha,
      cuenta_codigo: "8.3",
      centro_costo: "Compartido",
      monto_bs: -legBonoBs,
      monto_base_bs: -legBonoBs,
      iva_bs: 0,
      iva_aplica: false,
      tipo_iva: null,
      tasa_bcv: tasaBcv,
      tasa_paralela: tasaParalela,
      monto_usd: -legBonoUsd,
      metodo_pago: "transferencia",
      referencia: referenciaBanco ?? null,
      detalle: `Bono 10% — pago combinado (${bonos.length} pendientes)`.slice(0, 255),
      notas: `${origenNota} · Bono 10% por pagar al personal`.slice(0, 255),
      modo: "on_balance",
      cuenta_bancaria_id: cuentaBancariaId,
      grupo_transaccion_id: grupoId,
      import_batch_id: batchId ?? null,
      created_by: userId,
    });
  }
  if (props.length > 0) {
    payloads.push({
      fecha,
      cuenta_codigo: "8.1",
      centro_costo: "Compartido",
      monto_bs: -legPropBs,
      monto_base_bs: -legPropBs,
      iva_bs: 0,
      iva_aplica: false,
      tipo_iva: null,
      tasa_bcv: tasaBcv,
      tasa_paralela: tasaParalela,
      monto_usd: -legPropUsd,
      metodo_pago: "transferencia",
      // Si no hubo pierna de bono10, la huella de dedupe va aquí.
      referencia: bonos.length === 0 ? (referenciaBanco ?? null) : null,
      detalle: `Propinas — pago combinado (${props.length} pendientes)`.slice(0, 255),
      notas: `${origenNota} · Propinas por pagar al personal`.slice(0, 255),
      modo: "on_balance",
      cuenta_bancaria_id: cuentaBancariaId,
      grupo_transaccion_id: grupoId,
      import_batch_id: batchId ?? null,
      created_by: userId,
    });
  }

  const { data: legsTx, error: errIns } = await supabase.from("transacciones").insert(payloads as any).select();
  if (errIns) return { ok: false, error: errIns.message };
  for (const tx of legsTx ?? []) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);

  const txBono = (legsTx ?? []).find((t: any) => t.cuenta_codigo === "8.3");
  const txProp = (legsTx ?? []).find((t: any) => t.cuenta_codigo === "8.1");

  const marcarDistribuidas = async (tabla: "bonos_10" | "propinas", ids: string[], txId: string) => {
    for (const idsChunk of chunk(ids, 500)) {
      await (supabase.from(tabla) as any)
        .update({
          transaccion_salida_id: txId,
          fecha_distribucion: fecha,
          notas_distribucion: origenNota,
        })
        .in("id", idsChunk);
    }
  };
  if (txBono) await marcarDistribuidas("bonos_10", bonos.map((b) => b.id), (txBono as any).id);
  if (txProp) await marcarDistribuidas("propinas", props.map((p) => p.id), (txProp as any).id);

  return {
    ok: true,
    bono10Count: bonos.length,
    propinaCount: props.length,
    bono10Bs: legBonoBs,
    propinaBs: legPropBs,
  };
}

/**
 * Totales pendientes de Bono 10% y Propinas hasta una fecha (o en general si
 * no se pasa fecha). Se usa para mostrar advertencias — p. ej. al cerrar un
 * mes — sin crear ninguna transacción.
 */
export async function pendientesBonoPropina(fechaCorte?: string) {
  let qBono = supabase.from("bonos_10").select("monto_usd").is("transaccion_salida_id", null);
  let qProp = supabase.from("propinas").select("monto_usd").is("transaccion_salida_id", null);
  if (fechaCorte) {
    qBono = qBono.lte("fecha", fechaCorte);
    qProp = qProp.lte("fecha", fechaCorte);
  }
  const [{ data: bonos }, { data: props }] = await Promise.all([qBono, qProp]);
  const bono10Count = (bonos ?? []).length;
  const propinaCount = (props ?? []).length;
  const bono10Usd = (bonos ?? []).reduce((s: number, b: any) => s + (Number(b.monto_usd) || 0), 0);
  const propinaUsd = (props ?? []).reduce((s: number, p: any) => s + (Number(p.monto_usd) || 0), 0);
  return { bono10Count, propinaCount, bono10Usd, propinaUsd };
}
