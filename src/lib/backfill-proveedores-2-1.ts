// Backfill historico: reclasifica las compras 2.1 de un grupo de proveedores
// confirmados hacia su cuenta real, con el mismo criterio que usa en vivo
// reclasificarCompraSegunPareo -- pero basado en el nombre del proveedor en
// vez de un movimiento bancario puntual, porque la "cuenta sugerida" que
// trajo cada conciliacion ya aplicada no queda guardada en ningun lado.
//
// Alcance confirmado con el usuario: solo estos 5 proveedores. El resto (los
// "dudosos": Comercial Hua Hai, Ditel, Oexpress 2012, Inversiones Agro
// Delivery P&H, Tecnologia Agricola Sartenejas, JF2 Tecnologia Integral,
// Plasticos 10, Suministros Kamil, Iluvenca GD) se deja tal cual en 2.1 --
// instruccion explicita del usuario: "los dudosos dejalos en la 2.1".

import { supabase } from "@/integrations/supabase/client";
import { fetchPeriodosCerrados } from "@/lib/home-checklist";
import {
  reclasificarCompraSegunPareo,
  CUENTA_COMPRA_XETUX,
  type ResultadoReclasificacion,
} from "@/lib/reclasificar-compra";

export const MAPEO_PROVEEDORES_2_1: { razonSocial: string; cuenta: string; cuentaLabel: string }[] = [
  { razonSocial: "EUROLIMPIEZA 2008, S.D., C.A.", cuenta: "4.5", cuentaLabel: "Suministros Comedor y Limpieza" },
  { razonSocial: "VALET PARKING JADE 2025 C A", cuenta: "3.11", cuentaLabel: "Valet Parking" },
  { razonSocial: "LAVANDERIA MAGIK BLANCO, C.A.", cuenta: "3.21", cuentaLabel: "Lavanderia" },
  { razonSocial: "MUNDO PAPEL 2001 C.A", cuenta: "4.1", cuentaLabel: "Otros Insumos" },
  { razonSocial: "CAMPIFERRETERIA CA", cuenta: "4.6", cuentaLabel: "Otros Insumos generales y compartidos" },
];

export type ItemBackfillProveedor = {
  proveedor: string;
  cuentaDestino: string;
  resultado: ResultadoReclasificacion;
  transaccionId: string;
  fecha: string;
};

export type ResultadoBackfillProveedores = {
  items: ItemBackfillProveedor[];
  proveedoresNoEncontrados: string[];
};

/**
 * Recorre los 5 proveedores confirmados, resuelve su(s) tercero_id por
 * nombre (razon_social, case-insensitive), busca sus transacciones todavia
 * en 2.1 (en cualquier mes) y reclasifica cada una hacia la cuenta destino
 * confirmada, respetando meses cerrados (se reportan, no se tocan) via la
 * misma funcion reclasificarCompraSegunPareo ya usada en los flujos en vivo.
 */
export async function backfillReclasificacionProveedores2_1(): Promise<ResultadoBackfillProveedores> {
  const periodosCerrados = await fetchPeriodosCerrados();
  const items: ItemBackfillProveedor[] = [];
  const proveedoresNoEncontrados: string[] = [];

  for (const { razonSocial, cuenta } of MAPEO_PROVEEDORES_2_1) {
    const { data: terceros } = await supabase
      .from("terceros")
      .select("id, razon_social")
      .ilike("razon_social", razonSocial);

    const ids = (terceros ?? []).map((t: any) => t.id as string);
    if (!ids.length) {
      proveedoresNoEncontrados.push(razonSocial);
      continue;
    }

    const { data: txs } = await supabase
      .from("transacciones")
      .select("id, fecha, cuenta_codigo")
      .in("tercero_id", ids)
      .eq("cuenta_codigo", CUENTA_COMPRA_XETUX);

    for (const tx of txs ?? []) {
      const resultado = await reclasificarCompraSegunPareo({
        transaccionId: (tx as any).id,
        cuentaOriginal: (tx as any).cuenta_codigo,
        cuentaSugerida: cuenta,
        fecha: (tx as any).fecha,
        periodosCerrados,
      });
      items.push({
        proveedor: razonSocial,
        cuentaDestino: cuenta,
        resultado,
        transaccionId: (tx as any).id,
        fecha: (tx as any).fecha,
      });
    }
  }

  return { items, proveedoresNoEncontrados };
}

/** Resumen en una sola linea, para mostrar en un toast al terminar. */
export function resumenBackfillProveedores(res: ResultadoBackfillProveedores): string {
  const reclasificadas = res.items.filter((i) => i.resultado.status === "reclasificada").length;
  const mesesCerrados = res.items.filter((i) => i.resultado.status === "mes_cerrado").length;
  const conflictos = res.items.filter((i) => i.resultado.status === "conflicto").length;

  const partes: string[] = [];
  partes.push(`${reclasificadas} compra${reclasificadas === 1 ? "" : "s"} reclasificada${reclasificadas === 1 ? "" : "s"}`);
  if (mesesCerrados) partes.push(`${mesesCerrados} con mes cerrado -- reabre el mes para corregir`);
  if (conflictos) partes.push(`${conflictos} con cuentas en conflicto -- revisar a mano`);
  if (res.proveedoresNoEncontrados.length) {
    partes.push(`proveedor(es) no encontrado(s): ${res.proveedoresNoEncontrados.join(", ")}`);
  }
  return partes.join(" · ");
}
