// Version compania-entera de "Deuda neta real" (ver la tarjeta de cada
// proveedor en /proveedores/$id): cuanto falta pagar de verdad, neteando
// las facturas pendientes que no tienen NINGUN movimiento bancario cruzado
// contra pagos que ya se hicieron (a cualquier proveedor) y todavia no se
// cruzaron contra ninguna factura -- el caso tipico es pagar algo por el
// banco y no haber entrado todavia a cruzarlo contra su factura.
//
// Simplificacion deliberada frente a la version por proveedor: aqui solo
// se cuentan movimientos COMPLETAMENTE sin cruzar (cero facturas
// vinculadas), no el remanente de un pareo parcial -- ese caso mas fino
// (un movimiento que cubrio una factura a medias) solo se calcula hoy en
// la ficha de cada proveedor, con su propia logica de aplicacion parcial.
// Para un total de toda la empresa alcanza con el caso comun.

import { supabase } from "@/integrations/supabase/client";
import { pendienteUsdBcv } from "@/lib/cxp-saldo";

export type DeudaNetaReal = {
  facturasSinMovimientoUsd: number;
  pagosSinCruzarUsd: number;
  deudaNetaRealUsd: number;
};

export async function fetchDeudaNetaReal(): Promise<DeudaNetaReal> {
  const { fetchAllRows } = await import("@/lib/fetch-all");

  // Todas las facturas (CxP) pendientes de pago.
  const cxps = await fetchAllRows<any>(async (from, to) =>
    await supabase
      .from("cuentas_por_pagar")
      .select("id, monto_bs, monto_usd, usd_bcv_factura, monto_pendiente_bs, monto_pendiente_usd_bcv, estado")
      .neq("estado", "pagada")
      .range(from, to),
  );

  // Todos los movimientos bancarios con proveedor asignado.
  const movs = await fetchAllRows<any>(async (from, to) =>
    await supabase
      .from("transacciones")
      .select("id, monto_bs, tasa_bcv, monto_usd, solventado_manual_usd")
      .like("referencia", "BANK:%")
      .neq("standby", true)
      .not("tercero_id", "is", null)
      .range(from, to),
  );

  // Facturas con al menos un vinculo activo (pareado/parcial) -- el resto
  // son "sin movimiento".
  const vinculosFacturas = cxps.length
    ? await fetchAllRows<any>(async (from, to) =>
        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_factura_id")
          .in("transaccion_factura_id", cxps.map((c) => c.id))
          .in("estado", ["pareado", "parcial"])
          .range(from, to),
      )
    : [];
  const cxpsConVinculo = new Set(vinculosFacturas.map((v: any) => v.transaccion_factura_id));
  const facturasSinMovimientoUsd = cxps
    .filter((c) => !cxpsConVinculo.has(c.id))
    .reduce((s, c) => s + pendienteUsdBcv(c), 0);

  // Movimientos con al menos un vinculo activo -- el resto son "sin cruzar".
  const vinculosMovs = movs.length
    ? await fetchAllRows<any>(async (from, to) =>
        await (supabase.from as any)("conciliacion_bancaria")
          .select("transaccion_bancaria_id")
          .in("transaccion_bancaria_id", movs.map((m) => m.id))
          .in("estado", ["pareado", "parcial"])
          .range(from, to),
      )
    : [];
  const movsConVinculo = new Set(vinculosMovs.map((v: any) => v.transaccion_bancaria_id));
  const pagosSinCruzarUsd = movs
    .filter((m) => !movsConVinculo.has(m.id))
    .reduce((s, m) => {
      const tasa = Number(m.tasa_bcv) || 0;
      const bs = Math.abs(Number(m.monto_bs) || 0);
      const usd = tasa > 0 ? bs / tasa : Number(m.monto_usd) || 0;
      // Lo que ya se marco "solventado manualmente" (se sabe que pago una
      // factura vieja que nunca se cargo al sistema) ya no es un pago
      // esperando cruzarse contra nada.
      const solventado = Number(m.solventado_manual_usd) || 0;
      return s + Math.max(0, usd - solventado);
    }, 0);

  const deudaNetaRealUsd = Math.max(0, +(facturasSinMovimientoUsd - pagosSinCruzarUsd).toFixed(2));

  return {
    facturasSinMovimientoUsd: +facturasSinMovimientoUsd.toFixed(2),
    pagosSinCruzarUsd: +pagosSinCruzarUsd.toFixed(2),
    deudaNetaRealUsd,
  };
}
