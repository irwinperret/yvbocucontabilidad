import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fmtUsd } from "@/lib/format";
import { CENTROS, MESES } from "@/lib/account-helpers";

export const Route = createFileRoute("/_authenticated/fc")({ component: FCPage });

type Row = { anio: number; mes: number; cuenta_codigo: string; centro_costo: string; modo: string; total_usd: number };

function FCPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [centro, setCentro] = useState<string>("Consolidado");
  const [incluirOff, setIncluirOff] = useState(false);
  const [mesSel, setMesSel] = useState(new Date().getMonth() + 1);
  const [hastaMes, setHastaMes] = useState(new Date().getMonth() + 1);

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-fc"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("*").eq("afecta_fc", true).order("orden");
      return data ?? [];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["fc-rows", anio, centro, incluirOff],
    queryFn: async () => {
      let q = supabase.from("v_transacciones_mensual").select("*").eq("anio", anio);
      if (centro !== "Consolidado") q = q.eq("centro_costo", centro as any);
      if (!incluirOff) q = q.eq("modo", "on_balance");
      const { data } = await q;
      // Excluir pendientes: si metodo_pago = pendiente — esa info no está en la vista. Aproximación: ya excluimos por afecta_fc en cuentas.
      return (data ?? []) as Row[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Flujo de caja</h1>
        <p className="text-sm text-muted-foreground">Movimientos efectivos en USD</p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
          <div><Label className="text-xs">Año</Label><Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[2024,2025,2026,2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Centro de costo</Label><Select value={centro} onValueChange={setCentro}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Consolidado">Consolidado</SelectItem>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-2"><Switch checked={incluirOff} onCheckedChange={setIncluirOff} id="off" /><Label htmlFor="off" className="text-xs">Incluir off-balance</Label></div>
        </CardContent>
      </Card>

      <Tabs defaultValue="mes">
        <TabsList>
          <TabsTrigger value="mes">Mes individual</TabsTrigger>
          <TabsTrigger value="ytd">Acumulado YTD</TabsTrigger>
          <TabsTrigger value="comp">Comparativo mensual</TabsTrigger>
        </TabsList>

        <TabsContent value="mes">
          <div className="mb-3"><Label className="text-xs">Mes</Label>
            <Select value={String(mesSel)} onValueChange={(v) => setMesSel(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <ReporteFC rows={(rows ?? []).filter((r) => r.mes === mesSel)} cuentas={cuentas ?? []} />
        </TabsContent>

        <TabsContent value="ytd">
          <div className="mb-3"><Label className="text-xs">Hasta el mes</Label>
            <Select value={String(hastaMes)} onValueChange={(v) => setHastaMes(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <ReporteFC rows={(rows ?? []).filter((r) => r.mes <= hastaMes)} cuentas={cuentas ?? []} />
        </TabsContent>

        <TabsContent value="comp">
          <ReporteFCComparativo rows={rows ?? []} cuentas={cuentas ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReporteFC({ rows, cuentas }: { rows: Row[]; cuentas: any[] }) {
  const sum = (filter: (c: any) => boolean) => cuentas.filter(filter).reduce((s, c) => s + rows.filter((r) => r.cuenta_codigo === c.codigo).reduce((a, r) => a + Number(r.total_usd || 0), 0), 0);

  const entOp = sum((c) => c.codigo.startsWith("1."));
  const salOp = sum((c) => /^[2-9]\./.test(c.codigo));
  const flujoOp = entOp - salOp;
  const entFin = sum((c) => ["10.1", "10.5"].includes(c.codigo));
  const salFin = sum((c) => ["10.2", "10.4", "10.6"].includes(c.codigo));
  const flujoFin = entFin - salFin;
  const neto = flujoOp + flujoFin;

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <Linea label="Actividades operativas — Entradas" v={entOp} positive />
        <Linea label="Actividades operativas — Salidas" v={-salOp} />
        <Total label="Flujo operativo neto" v={flujoOp} />
        <Linea label="Financiamiento — Entradas" v={entFin} positive />
        <Linea label="Financiamiento — Salidas" v={-salFin} />
        <Total label="Flujo financiamiento neto" v={flujoFin} />
        <Total label="VARIACIÓN NETA DE CAJA" v={neto} big />
      </CardContent>
    </Card>
  );
}

function ReporteFCComparativo({ rows, cuentas }: { rows: Row[]; cuentas: any[] }) {
  const cuentasActivas = useMemo(() => cuentas.filter((c) => rows.some((r) => r.cuenta_codigo === c.codigo)), [cuentas, rows]);
  const valor = (codigo: string, mes: number) => rows.filter((r) => r.cuenta_codigo === codigo && r.mes === mes).reduce((s, r) => s + Number(r.total_usd || 0), 0);
  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2 px-2 sticky left-0 bg-background">Cuenta</th>
              {MESES.map((m, i) => <th key={i} className="text-right py-2 px-2">{m}</th>)}
              <th className="text-right py-2 px-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {cuentasActivas.map((c) => {
              const vs = MESES.map((_, i) => valor(c.codigo, i + 1));
              const t = vs.reduce((s, v) => s + v, 0);
              return (
                <tr key={c.codigo} className="border-b last:border-0">
                  <td className="py-1.5 px-2 sticky left-0 bg-background"><span className="text-muted-foreground">{c.codigo}</span> {c.nombre}</td>
                  {vs.map((v, i) => <td key={i} className="py-1.5 px-2 text-right mono">{v === 0 ? "—" : fmtUsd(v)}</td>)}
                  <td className="py-1.5 px-2 text-right mono font-semibold">{fmtUsd(t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Linea({ label, v, positive }: { label: string; v: number; positive?: boolean }) {
  return (
    <div className="flex justify-between py-1.5 px-2 text-sm border-b">
      <span>{label}</span>
      <span className={`mono ${v >= 0 ? "positive" : "negative"}`}>{v >= 0 ? fmtUsd(v) : `(${fmtUsd(Math.abs(v)).replace("$ ","")})`}</span>
    </div>
  );
}

function Total({ label, v, big }: { label: string; v: number; big?: boolean }) {
  return (
    <div className={`flex justify-between py-2 px-2 border-t-2 ${big ? "text-base font-bold bg-muted/30" : "text-sm font-semibold"}`}>
      <span>{label}</span>
      <span className={`mono ${v >= 0 ? "positive" : "negative"}`}>{v >= 0 ? fmtUsd(v) : `(${fmtUsd(Math.abs(v)).replace("$ ","")})`}</span>
    </div>
  );
}
