// Lógica compartida para sincronizar la tasa BCV desde una fuente pública.
// Fuente: ve.dolarapi.com (JSON, sin auth, devuelve la tasa oficial BCV).

export type BcvFetchResult = {
  tasa: number;
  fecha: string; // YYYY-MM-DD
  fuente: string;
};

export async function fetchTasaBcv(): Promise<BcvFetchResult> {
  const res = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`dolarapi respondió ${res.status}`);
  const json = (await res.json()) as {
    promedio?: number | null;
    venta?: number | null;
    compra?: number | null;
    fechaActualizacion?: string;
  };
  const tasa = json.promedio ?? json.venta ?? json.compra;
  if (!tasa || tasa <= 0) throw new Error("dolarapi no devolvió tasa válida");
  const fecha = (json.fechaActualizacion ?? new Date().toISOString()).slice(0, 10);
  return { tasa: Number(tasa), fecha, fuente: "ve.dolarapi.com" };
}
