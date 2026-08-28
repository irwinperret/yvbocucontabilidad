import { supabase } from "@/integrations/supabase/client";

/**
 * Extrae un nombre de proveedor candidato de un texto descriptivo (el campo
 * "detalle" de un movimiento bancario, con formato tipo
 * "SIN FACTURA XETUX · NOMBRE DEL PROVEEDOR NE 12345" o similar — nunca el
 * campo "notas", que siempre arranca con el texto fijo "Conciliación
 * bancaria..." y NO es el nombre).
 *
 * Primero se queda con el último segmento después del separador "·" (ahí es
 * donde vive el texto original del concepto bancario), y sobre ESE segmento
 * corta donde empieza cualquier patrón de número de documento
 * (FACT/F+dígito/NE/PEDIDO/PTTO/referencia suelta), ya que esa es casi
 * siempre la parte que identifica a quién se le pagó.
 */
export function nombreProveedorDeMemo(memo: string | null | undefined): string | null {
  const crudo = String(memo ?? "").trim();
  if (!crudo) return null;
  // Si hay separadores "·", el texto útil es el ÚLTIMO segmento.
  const partes = crudo.split("·").map((p) => p.trim()).filter(Boolean);
  const t = partes.length ? partes[partes.length - 1] : crudo;
  const mayus = t.toUpperCase();

  // Buscar la posición más temprana de cualquier patrón de documento.
  const patrones = [
    /\b(?:FACTURAS?|FACTS?|FAC)\b/,
    /\bF\s?\d/,
    /\bNE\.?\s*\d/,
    /\bPEDIDOS?\b/,
    /\bPTTO\.?\b/,
    /\bCONF#/i,
    /\b\d{4,}\b/, // número suelto de 4+ dígitos (referencia, cédula, etc.)
  ];
  let corte = mayus.length;
  for (const p of patrones) {
    const m = mayus.match(p);
    if (m && m.index != null && m.index < corte) corte = m.index;
  }
  let nombre = t.slice(0, corte).trim();
  // Quitar conectores sueltos al final ("PARA", "DE", "A", "-", etc.)
  nombre = nombre.replace(/[-–—.,:;]+$/, "").trim();
  nombre = nombre.replace(/\s+(PARA|DE|A|POR|CONF)$/i, "").trim();
  if (nombre.length < 3) return null; // muy corto para ser un nombre real
  return nombre;
}

/** Normaliza un nombre para comparar duplicados exactos (no difuso). */
export function normalizarNombreCandidato(nombre: string): string {
  return nombre
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita tildes
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca un candidato existente por nombre normalizado exacto, o crea uno
 * nuevo (estado_registro='candidato', sin RIF). No usa coincidencia difusa
 * a propósito: mejor tener dos candidatos separados que fusionar por error
 * dos proveedores distintos.
 */
export async function obtenerOCrearCandidato(nombreCrudo: string): Promise<{ id: string; creado: boolean } | null> {
  const nombre = nombreCrudo.trim();
  if (!nombre) return null;
  const clave = normalizarNombreCandidato(nombre);
  if (!clave) return null;

  const { data: existentes } = await supabase
    .from("terceros")
    .select("id, razon_social")
    .eq("estado_registro", "candidato" as any);
  const match = (existentes ?? []).find((t: any) => normalizarNombreCandidato(t.razon_social) === clave);
  if (match) return { id: (match as any).id, creado: false };

  const { data: nuevo, error } = await supabase
    .from("terceros")
    .insert({
      razon_social: nombre,
      tipo: "proveedor" as any,
      estado_registro: "candidato",
      origen_registro: "movimientos_bancarios",
      rif: null,
      tipo_rif: null,
    } as any)
    .select("id")
    .single();
  if (error || !nuevo) return null;
  return { id: (nuevo as any).id, creado: true };
}
