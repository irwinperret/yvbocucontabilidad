import sys

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

path = "mnt/yvbocucontabilidad/src/routes/_authenticated/retencion-islr.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# 1. Imports: React hooks necesarios + cliente de Supabase (para la tasa
#    paralela, que esta pagina no consultaba todavia).
old = '''import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";'''
new = '''import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";'''
src = apply_once(src, old, new, "imports")

# 2. Tasa BCV: que se ajuste sola cuando cambia la fecha DENTRO del dialogo
#    (antes solo se ponia al abrirlo, y se quedaba congelada aunque
#    cambiaras la fecha). tasaManualFechaRef guarda la ultima fecha para la
#    que ya se sincronizo, para no pisar el valor justo al abrir a editar
#    un registro existente (ahi se debe respetar la tasa que se guardo).
old = '''  const { data: tasaSugerida } = useTasaForDate(fecha);

  const openNuevo = () => {
    setEditing("nuevo");
    setFecha(todayISO());
    setMontoUsd("");
    setTasa(tasaSugerida?.tasa ? String(tasaSugerida.tasa) : "");
    setNotas("");
  };

  const openEdit = (r: ReclasificacionIslr) => {
    setEditing(r);
    setFecha(r.fecha);
    setMontoUsd(String(r.montoUsd ?? ""));
    setTasa(String(r.tasaBcv ?? ""));
    setNotas(r.notas ?? "");
  };'''
new = '''  const { data: tasaSugerida } = useTasaForDate(fecha);
  const tasaSincronizadaDesdeRef = useRef(fecha);

  const openNuevo = () => {
    const f = todayISO();
    setEditing("nuevo");
    setFecha(f);
    tasaSincronizadaDesdeRef.current = f;
    setMontoUsd("");
    setTasa(tasaSugerida?.tasa ? String(tasaSugerida.tasa) : "");
    setNotas("");
  };

  const openEdit = (r: ReclasificacionIslr) => {
    setEditing(r);
    setFecha(r.fecha);
    tasaSincronizadaDesdeRef.current = r.fecha;
    setMontoUsd(String(r.montoUsd ?? ""));
    setTasa(String(r.tasaBcv ?? ""));
    setNotas(r.notas ?? "");
  };

  // Si cambias la fecha mientras el dialogo esta abierto, la tasa BCV se
  // reajusta sola a la de esa nueva fecha (no toca el valor justo al abrir,
  // solo cuando la fecha cambia de verdad, y espera a que la tasa de la
  // nueva fecha termine de cargar antes de aplicarla).
  useEffect(() => {
    if (editing === null) return;
    if (fecha === tasaSincronizadaDesdeRef.current) return;
    if (!tasaSugerida?.tasa) return;
    tasaSincronizadaDesdeRef.current = fecha;
    setTasa(String(tasaSugerida.tasa));
  }, [fecha, tasaSugerida, editing]);'''
src = apply_once(src, old, new, "tasa auto-sync")

# 3. Tasa paralela historica (para la columna "USD paralelo" de la tabla).
old = '''  const porPeriodo = useMemo(() => {'''
new = '''  const { data: tasasParalela } = useQuery({
    queryKey: ["tasas-paralela-todas"],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_paralela").select("fecha, tasa").order("fecha", { ascending: true });
      return data ?? [];
    },
  });

  /** Tasa paralela vigente a una fecha (la ultima registrada hasta ese dia). */
  const tasaParalelaParaFecha = (f: string): number => {
    let mejor = 0;
    for (const t of tasasParalela ?? []) {
      if (t.fecha > f) break;
      mejor = Number(t.tasa) || mejor;
    }
    return mejor;
  };

  const porPeriodo = useMemo(() => {'''
src = apply_once(src, old, new, "tasaParalelaParaFecha")

# 4. Tabla: encabezados -- "USD" pasa a ser "USD BCV" y se agrega "USD
#    paralelo" justo al lado.
old = '''                    <th className="py-2 pr-4 text-right">USD</th>
                    <th className="py-2 pr-4 text-right">Bs</th>'''
new = '''                    <th className="py-2 pr-4 text-right">USD BCV</th>
                    <th className="py-2 pr-4 text-right">USD paralelo</th>
                    <th className="py-2 pr-4 text-right">Bs</th>'''
src = apply_once(src, old, new, "table headers")

old = '''                      <td className="py-2 pr-4 text-right mono font-semibold">{fmtUsd(r.montoUsd)}</td>
                      <td className="py-2 pr-4 text-right mono text-muted-foreground">{fmtBs(r.montoBs)}</td>'''
new = '''                      <td className="py-2 pr-4 text-right mono font-semibold">{fmtUsd(r.montoUsd)}</td>
                      <td className="py-2 pr-4 text-right mono text-muted-foreground">
                        {(() => {
                          const tp = tasaParalelaParaFecha(r.fecha);
                          return tp > 0 ? fmtUsd(r.montoBs / tp) : "—";
                        })()}
                      </td>
                      <td className="py-2 pr-4 text-right mono text-muted-foreground">{fmtBs(r.montoBs)}</td>'''
src = apply_once(src, old, new, "table cells")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK")
