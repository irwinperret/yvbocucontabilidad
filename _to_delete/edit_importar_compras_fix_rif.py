import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

path = "mnt/yvbocucontabilidad/src/routes/_authenticated/importar-compras.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# 1. Tipo: marcar explicitamente las filas sin RIF utilizable.
old = '''type ParsedCompra = {
  idx: number;
  tipo_rif: "V" | "J" | "E" | "G" | "P";
  rif: string;
  proveedor: string;'''
new = '''type ParsedCompra = {
  idx: number;
  tipo_rif: "V" | "J" | "E" | "G" | "P";
  rif: string;
  /**
   * true cuando la celda de RIF del Excel no trajo ningun digito utilizable.
   * En ese caso tipo_rif/rif son solo un placeholder para mostrar en pantalla
   * -- NUNCA se usan para buscar/crear el tercero (ver ensureTercero), porque
   * esa clave RIF vacia terminaria compartida entre proveedores sin relacion
   * (fue exactamente el bug que fusiono "Mi Gran Tesoro" con compras de
   * "Distribuidora Imperial 2024, C.A."). En su lugar se matchea por nombre.
   */
  sinRif: boolean;
  proveedor: string;'''
src = apply_once(src, old, new, "ParsedCompra.sinRif field")

# 2. Import del matcher por nombre (mismo que usan los movimientos bancarios).
old = '''import { ImportacionFallidasWizard, type FilaFallida } from "@/components/importacion-fallidas-wizard";
import { tasaBcvQuery } from "@/lib/tasas";'''
new = '''import { ImportacionFallidasWizard, type FilaFallida } from "@/components/importacion-fallidas-wizard";
import { tasaBcvQuery } from "@/lib/tasas";
import { obtenerOCrearCandidato, normalizarNombreCandidato } from "@/lib/proveedores-candidatos";'''
src = apply_once(src, old, new, "import candidatos matcher")

# 3. Parseo: distinguir RIF real de "sin RIF" en vez de fabricar una clave
#    vacia compartida.
old = '''      const rifParts = splitRif(rifRaw) ?? { tipo_rif: "J" as const, rif: rifRaw.replace(/\\D/g, "") };

      parsed.push({
        idx: i + 1,
        tipo_rif: rifParts.tipo_rif,
        rif: rifParts.rif,
        proveedor: proveedor || rifRaw,'''
new = '''      const rifParts = splitRif(rifRaw);
      const digitsOnly = rifRaw.replace(/\\D/g, "");
      // Sin RIF utilizable: ni formato V/J/E/G/P-digitos, ni siquiera un
      // numero suelto. Antes esto caia en una clave "J-" (vacia) compartida
      // por TODAS las filas sin RIF, sin importar el proveedor real.
      const sinRif = !rifParts && !digitsOnly;
      const rifFinal = rifParts ?? { tipo_rif: "J" as const, rif: digitsOnly };

      parsed.push({
        idx: i + 1,
        tipo_rif: rifFinal.tipo_rif,
        rif: rifFinal.rif,
        sinRif,
        proveedor: proveedor || rifRaw,'''
src = apply_once(src, old, new, "parse sinRif")

# 4. Mapa de candidatos ya existentes (por nombre normalizado), para que el
#    resumen/preview sepan si una fila sin RIF ya tiene proveedor creado.
old = '''  const terceroByRif = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of terceros) m.set(`${t.tipo_rif}-${t.rif}`, t);
    return m;
  }, [terceros]);'''
new = '''  const terceroByRif = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of terceros) m.set(`${t.tipo_rif}-${t.rif}`, t);
    return m;
  }, [terceros]);

  // Candidatos (proveedores sin RIF, creados por nombre) ya existentes --
  // para las filas sinRif, "existe" se mira por nombre exacto normalizado,
  // nunca por la clave RIF vacia.
  const candidatoByNombre = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of terceros) {
      if (t.estado_registro === "candidato") m.set(normalizarNombreCandidato(t.razon_social ?? ""), t);
    }
    return m;
  }, [terceros]);

  const proveedorYaExiste = (r: ParsedCompra) =>
    r.sinRif
      ? candidatoByNombre.has(normalizarNombreCandidato(r.proveedor))
      : terceroByRif.has(`${r.tipo_rif}-${r.rif}`);'''
src = apply_once(src, old, new, "candidatoByNombre + proveedorYaExiste")

# 5. Stats del resumen: usar proveedorYaExiste en vez de la clave RIF cruda.
old = '''    const sinProveedor = sel.filter((r) => !terceroByRif.has(`${r.tipo_rif}-${r.rif}`)).length;'''
new = '''    const sinProveedor = sel.filter((r) => !proveedorYaExiste(r)).length;'''
src = apply_once(src, old, new, "stats sinProveedor")

# 6. ensureTercero: ramal separado y seguro para filas sin RIF.
old = '''  const ensureTercero = async (r: ParsedCompra): Promise<string | null> => {
    const k = `${r.tipo_rif}-${r.rif}`;
    const existing = terceroByRif.get(k);
    if (existing) return existing.id;'''
new = '''  const ensureTercero = async (r: ParsedCompra): Promise<string | null> => {
    if (r.sinRif) {
      // Sin RIF utilizable en el Excel: matchear por nombre exacto
      // normalizado (nunca difuso, mismo criterio que proveedores
      // adivinados de movimientos bancarios) en vez de una clave RIF vacia
      // que terminaria compartida entre proveedores sin ninguna relacion.
      // Si no hay match, se crea un candidato nuevo (estado_registro
      // "candidato") para que se verifique a mano en la ficha del
      // proveedor, en vez de fusionarlo con cualquier otro al azar.
      const res = await obtenerOCrearCandidato(r.proveedor);
      return res?.id ?? null;
    }
    const k = `${r.tipo_rif}-${r.rif}`;
    const existing = terceroByRif.get(k);
    if (existing) return existing.id;'''
src = apply_once(src, old, new, "ensureTercero sinRif branch")

# 7. Mensaje de error cuando no se pudo resolver el proveedor: aclarar el
#    caso sin RIF en vez de mostrar "(J-)".
old = '''      if (!terceroId) return { status: "fail", motivo: `No se pudo crear/encontrar el proveedor ${r.proveedor} (${r.tipo_rif}-${r.rif})` };'''
new = '''      if (!terceroId) return { status: "fail", motivo: r.sinRif
        ? `No se pudo crear/encontrar el proveedor ${r.proveedor} (sin RIF en el Excel)`
        : `No se pudo crear/encontrar el proveedor ${r.proveedor} (${r.tipo_rif}-${r.rif})` };'''
src = apply_once(src, old, new, "error message sinRif")

# 8. Preview: usar proveedorYaExiste y mostrar el RIF como "— (sin RIF)"
#    cuando corresponda, en vez del placeholder "J-" que sugiere un RIF real.
old = '''                    {visibles.map((r) => {
                      const existe = terceroByRif.has(`${r.tipo_rif}-${r.rif}`);'''
new = '''                    {visibles.map((r) => {
                      const existe = proveedorYaExiste(r);'''
src = apply_once(src, old, new, "preview existe")

old = '''                          <td className="p-2 font-mono text-[10px]">{r.tipo_rif}-{r.rif}</td>'''
new = '''                          <td className="p-2 font-mono text-[10px]">
                            {r.sinRif ? <span className="text-amber-600">— (sin RIF)</span> : `${r.tipo_rif}-${r.rif}`}
                          </td>'''
src = apply_once(src, old, new, "preview RIF column")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
