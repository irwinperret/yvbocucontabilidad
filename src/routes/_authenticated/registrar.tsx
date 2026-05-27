import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { fmtBs, fmtUsd, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { CENTROS, METODOS, cuentaVenta, cuentaNomina, FINANCIAMIENTO, type Centro } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";
import { TerceroSelect } from "@/components/tercero-select";

type Search = { tab?: string };
export const Route = createFileRoute("/_authenticated/registrar")({
  validateSearch: (s: Record<string, unknown>): Search => ({ tab: s.tab as string | undefined }),
  component: RegistrarPage,
});

function useTasaForDate(fecha: string) {
  return useQuery({
    queryKey: ["tasa-for", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });
}

function useCuentas() {
  return useQuery({
    queryKey: ["cuentas-all"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("*").eq("activa", true).order("orden");
      return data ?? [];
    },
  });
}

function useTerceros() {
  return useQuery({
    queryKey: ["terceros-list"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("*").order("razon_social");
      return data ?? [];
    },
  });
}

function RegistrarPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const current = tab ?? "ventas";

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Registrar movimiento</h1>
        <p className="text-sm text-muted-foreground">Elige el tipo de transacción</p>
      </div>
      <Tabs value={current} onValueChange={(v) => navigate({ to: "/registrar", search: { tab: v } })}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 w-full h-auto gap-1 p-1">
          <TabsTrigger value="ventas" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Ventas</TabsTrigger>
          <TabsTrigger value="gastos" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Gastos / Facturas</TabsTrigger>
          <TabsTrigger value="cierre" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">COGS e Inventario</TabsTrigger>
          <TabsTrigger value="nomina" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Nómina</TabsTrigger>
          <TabsTrigger value="financiamiento" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Financiamiento</TabsTrigger>
        </TabsList>
        <TabsContent value="ventas"><VentasForm /></TabsContent>
        <TabsContent value="gastos"><GastosForm /></TabsContent>
        <TabsContent value="cierre"><CierreForm /></TabsContent>
        <TabsContent value="nomina"><NominaForm /></TabsContent>
        <TabsContent value="financiamiento"><FinanciamientoForm /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- VENTAS ---------------- */
function VentasForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(todayISO());
  const [centro, setCentro] = useState<Centro>("YV");
  const [tipo, setTipo] = useState<"contado" | "credito" | "cobro">("contado");
  const [cliente, setCliente] = useState("");
  const [fechaVenc, setFechaVenc] = useState("");
  const [ivaAplica, setIvaAplica] = useState(false);
  const [montoTotal, setMontoTotal] = useState("");
  const [tasa, setTasa] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [notas, setNotas] = useState("");
  const [offBalance, setOffBalance] = useState(false);
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSugerida } = useTasaForDate(fecha);
  useEffect(() => { if (tasaSugerida && !tasa) setTasa(String(tasaSugerida.tasa)); }, [tasaSugerida]);

  const total = Number(montoTotal) || 0;
  const base = ivaAplica ? total / 1.16 : total;
  const iva = ivaAplica ? total - base : 0;
  const tasaN = Number(tasa) || 0;
  const baseUsd = tasaN ? base / tasaN : 0;
  const ivaUsd = tasaN ? iva / tasaN : 0;
  const cuenta = cuentaVenta(centro, tipo);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!tasaN) return toast.error("Falta tasa BCV");
    if (tipo === "credito" && !cliente) return toast.error("Indica el cliente");
    setBusy(true);
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha, cuenta_codigo: cuenta, centro_costo: centro as any,
      monto_bs: total, monto_base_bs: base, iva_bs: iva,
      iva_aplica: ivaAplica, tipo_iva: ivaAplica ? "debito_fiscal" : null,
      tasa_bcv: tasaN, monto_usd: baseUsd,
      metodo_pago: metodo as any, referencia: ref || null, notas: notas || null,
      modo: offBalance ? "off_balance" : "on_balance",
      cuenta_bancaria_id: tipo !== "credito" && cuentaBancariaId ? cuentaBancariaId : null,
      created_by: user.id,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    if (tipo === "credito" && tx) {
      await supabase.from("cuentas_por_cobrar").insert({
        cliente, centro_costo: centro as any, monto_bs: total, monto_usd: baseUsd,
        fecha_vencimiento: fechaVenc || null, transaccion_id: tx.id, estado: "vigente",
      } as any);
    }
    setBusy(false);
    toast.success("Venta registrada");
    qc.invalidateQueries();
    setMontoTotal(""); setRef(""); setNotas(""); setCliente("");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Ventas / Ingresos</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Centro de costo</Label>
            <Select value={centro} onValueChange={(v) => setCentro(v as Centro)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v: any) => setTipo(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contado">Contado</SelectItem>
                <SelectItem value="credito">A crédito (fiar)</SelectItem>
                <SelectItem value="cobro">Cobro de crédito anterior</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Cuenta: <span className="font-semibold">{cuenta}</span></p>
          </div>

          {tipo === "credito" && (
            <>
              <div><Label>Cliente</Label><Input value={cliente} onChange={(e) => setCliente(e.target.value)} required /></div>
              <div><Label>Fecha esperada cobro</Label><Input type="date" value={fechaVenc} onChange={(e) => setFechaVenc(e.target.value)} /></div>
            </>
          )}

          <div className="md:col-span-2 border-t pt-3 flex items-center justify-between">
            <Label>¿Aplica IVA 16%?</Label>
            <Switch checked={ivaAplica} onCheckedChange={setIvaAplica} />
          </div>
          <div>
            <Label>{ivaAplica ? "Monto total Bs (IVA incluido)" : "Monto Bs"}</Label>
            <Input type="number" step="0.01" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Tasa BCV</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          {ivaAplica && (
            <div className="md:col-span-2 grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
              <div>Base: <span className="mono font-semibold">{fmtBs(base)}</span></div>
              <div>IVA débito: <span className="mono font-semibold">{fmtBs(iva)}</span></div>
              <div>Base USD: <span className="mono">{fmtUsd(baseUsd)}</span></div>
              <div>IVA USD: <span className="mono">{fmtUsd(ivaUsd)}</span></div>
            </div>
          )}
          <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">G&P: base USD</span>
            <span className="text-lg font-bold mono">{fmtUsd(baseUsd)}</span>
          </div>
          <div>
            <Label>Método de pago</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METODOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>N° referencia</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          {tipo !== "credito" && (
            <div className="md:col-span-2">
              <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
            </div>
          )}
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
            <Label>Off-balance</Label>
            <Switch checked={offBalance} onCheckedChange={setOffBalance} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar ingreso"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ---------------- GASTOS ---------------- */
function GastosForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: cuentas } = useCuentas();
  const { data: terceros } = useTerceros();
  const [fecha, setFecha] = useState(todayISO());
  const [terceroId, setTerceroId] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [centro, setCentro] = useState<Centro>("YV");
  const [ivaAplica, setIvaAplica] = useState(false);
  const [montoTotal, setMontoTotal] = useState("");
  const [tasa, setTasa] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [pendiente, setPendiente] = useState(false);
  const [fechaVenc, setFechaVenc] = useState("");
  const [numFactura, setNumFactura] = useState("");
  const [notas, setNotas] = useState("");
  const [offBalance, setOffBalance] = useState(false);
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSugerida } = useTasaForDate(fecha);
  useEffect(() => { if (tasaSugerida && !tasa) setTasa(String(tasaSugerida.tasa)); }, [tasaSugerida]);

  const total = Number(montoTotal) || 0;
  const base = ivaAplica ? total / 1.16 : total;
  const iva = ivaAplica ? total - base : 0;
  const tasaN = Number(tasa) || 0;
  const baseUsd = tasaN ? base / tasaN : 0;
  const cuentaSel = (cuentas ?? []).find((c: any) => c.codigo === cuenta);

  const NOMINA_CODES = new Set(["3.1","3.2","3.3","3.4","3.5","3.6","3.7","3.9","3.10","3.11","3.12","3.14","3.15"]);
  const grupos = useMemo(() => {
    const g: Record<string, any[]> = {};
    (cuentas ?? [])
      .filter((c: any) => !c.codigo.startsWith("1."))
      .filter((c: any) => c.codigo !== "2.1" && c.codigo !== "2.2") // COGS se maneja solo desde COGS e Inventario
      .filter((c: any) => !NOMINA_CODES.has(c.codigo)) // Nómina solo desde su pestaña
      .filter((c: any) => !c.codigo.startsWith("10.")) // Financiamiento solo desde su pestaña
      .filter((c: any) => !c.centros_permitidos || c.centros_permitidos.includes(centro))
      .forEach((c: any) => { (g[c.grupo] ||= []).push(c); });
    return g;
  }, [cuentas, centro]);



  // Si cambia el centro y la cuenta seleccionada ya no es válida, la limpiamos.
  useEffect(() => {
    if (!cuenta || !cuentaSel) return;
    const permitidos = cuentaSel.centros_permitidos as string[] | null | undefined;
    if (permitidos && !permitidos.includes(centro)) setCuenta("");
  }, [centro, cuentaSel, cuenta]);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!cuenta) return toast.error("Selecciona cuenta");
    if (!tasaN) return toast.error("Falta tasa");
    if (!numFactura) return toast.error("N° factura obligatorio");
    setBusy(true);
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha, cuenta_codigo: cuenta, centro_costo: centro as any,
      monto_bs: total, monto_base_bs: base, iva_bs: iva,
      iva_aplica: ivaAplica, tipo_iva: ivaAplica ? "credito_fiscal" : null,
      tasa_bcv: tasaN, monto_usd: baseUsd,
      metodo_pago: pendiente ? "pendiente" : (metodo as any),
      tercero_id: terceroId || null, numero_factura: numFactura, notas: notas || null,
      modo: offBalance ? "off_balance" : "on_balance",
      cuenta_bancaria_id: !pendiente && cuentaBancariaId ? cuentaBancariaId : null,
      created_by: user.id,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    if (pendiente && tx) {
      const prov = (terceros ?? []).find((t: any) => t.id === terceroId);
      await supabase.from("cuentas_por_pagar").insert({
        proveedor: prov?.razon_social ?? "Proveedor",
        numero_factura: numFactura,
        tercero_id: terceroId || null,
        centro_costo: centro as any,
        monto_bs: total, monto_usd: total / tasaN,
        monto_pendiente_bs: total,
        fecha_vencimiento: fechaVenc || null,
        transaccion_id: tx.id, estado: "pendiente",
      } as any);
    }
    setBusy(false);
    toast.success(pendiente ? "Factura registrada (CxP creada)" : "Gasto registrado");
    qc.invalidateQueries();
    setMontoTotal(""); setNumFactura(""); setNotas("");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Gastos / Facturas</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2 font-medium">
          ⚠ CUIDADO: No incluyas aquí COGS (insumos, mercancía o productos para revender). Esas compras se registran en la pestaña <span className="font-bold">"COGS e Inventario"</span> para evitar contarlas dos veces.
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Factura pendiente: el gasto entra al G&amp;P hoy; el pago saldrá del FC cuando lo registres en "Pagar CxP".
        </p>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Fecha factura</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Centro de costo</Label>
            <Select value={centro} onValueChange={(v) => setCentro(v as Centro)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <TerceroSelect value={terceroId} onChange={setTerceroId} terceros={(terceros ?? []) as any} />
          </div>
          <div className="md:col-span-2">
            <Label>Cuenta contable</Label>
            <Select value={cuenta} onValueChange={setCuenta}>
              <SelectTrigger><SelectValue placeholder="Selecciona cuenta" /></SelectTrigger>
              <SelectContent>
                {Object.entries(grupos).map(([g, items]) => (
                  <div key={g}>
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{g}</div>
                    {items.map((c: any) => <SelectItem key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</SelectItem>)}
                  </div>
                ))}
              </SelectContent>
            </Select>
            {cuentaSel && (
              <p className="text-xs mt-1">
                {cuentaSel.afecta_gyp && <span className="text-primary font-semibold">G&P</span>}
                {cuentaSel.afecta_gyp && cuentaSel.afecta_fc && " · "}
                {cuentaSel.afecta_fc && <span className="text-primary font-semibold">FC</span>}
              </p>
            )}
          </div>
          <div className="md:col-span-2"><Label>N° factura</Label><Input value={numFactura} onChange={(e) => setNumFactura(e.target.value)} required /></div>

          <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
            <Label>¿Factura con IVA 16%?</Label>
            <Switch checked={ivaAplica} onCheckedChange={setIvaAplica} />
          </div>
          <div>
            <Label>{ivaAplica ? "Monto total Bs (IVA incluido)" : "Monto Bs"}</Label>
            <Input type="number" step="0.01" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Tasa BCV</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          {ivaAplica && (
            <div className="md:col-span-2 grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
              <div>Base: <span className="mono font-semibold">{fmtBs(base)}</span></div>
              <div>IVA crédito: <span className="mono font-semibold">{fmtBs(iva)}</span></div>
            </div>
          )}
          <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">G&P: base USD</span>
            <span className="text-lg font-bold mono">{fmtUsd(baseUsd)}</span>
          </div>

          <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
            <div>
              <Label>Pendiente de pago (crear CxP)</Label>
              <p className="text-xs text-muted-foreground">Si está activo, no afecta FC hoy</p>
            </div>
            <Switch checked={pendiente} onCheckedChange={setPendiente} />
          </div>
          {pendiente ? (
            <div className="md:col-span-2"><Label>Fecha vencimiento (opcional)</Label><Input type="date" value={fechaVenc} onChange={(e) => setFechaVenc(e.target.value)} /></div>
          ) : (
            <>
              <div className="md:col-span-2">
                <Label>Método de pago</Label>
                <Select value={metodo} onValueChange={setMetodo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
              </div>
            </>
          )}
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
            <Label>Off-balance</Label>
            <Switch checked={offBalance} onCheckedChange={setOffBalance} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar factura"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ---------------- NÓMINA ---------------- */
type EmpleadoLinea = { nombre: string; monto: string };

function NominaForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [moneda, setMoneda] = useState<"BS" | "USD">("BS");
  const [fecha, setFecha] = useState(todayISO());
  const [tipo, setTipo] = useState("regular");
  const [centro, setCentro] = useState<Centro>("Compartido");
  const [tasa, setTasa] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [empleados, setEmpleados] = useState<EmpleadoLinea[]>([{ nombre: "", monto: "" }]);
  const [notas, setNotas] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  const esUSD = moneda === "USD";
  const offBalance = esUSD; // USD siempre off-balance

  const { data: tasaSugerida } = useTasaForDate(fecha);
  useEffect(() => { if (tasaSugerida && !tasa) setTasa(String(tasaSugerida.tasa)); }, [tasaSugerida]);

  const tasaN = Number(tasa) || 0;
  const totalInput = empleados.reduce((s, e) => s + (Number(e.monto) || 0), 0);
  const totalBs = esUSD ? totalInput * tasaN : totalInput;
  const totalUsd = esUSD ? totalInput : (tasaN ? totalInput / tasaN : 0);
  const cuenta = cuentaNomina(tipo, centro);
  const esProvision = tipo === "pasivos" && !esUSD; // provisión solo aplica a Bs on-balance

  const updateLinea = (i: number, patch: Partial<EmpleadoLinea>) => {
    setEmpleados((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLinea = () => setEmpleados((arr) => [...arr, { nombre: "", monto: "" }]);
  const delLinea = (i: number) => setEmpleados((arr) => arr.length === 1 ? arr : arr.filter((_, idx) => idx !== i));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !tasaN) return toast.error("Falta tasa");
    const lineas = empleados.filter((l) => l.nombre.trim() && Number(l.monto) > 0);
    if (!lineas.length) return toast.error("Agrega al menos un empleado con monto");
    setBusy(true);

    for (const l of lineas) {
      const monto = Number(l.monto);
      const lineaBs = esUSD ? monto * tasaN : monto;
      const lineaUsd = esUSD ? monto : (tasaN ? monto / tasaN : 0);
      const notaLinea = `Empleado: ${l.nombre.trim()}${notas ? ` · ${notas}` : ""}`;
      const { data: tx, error } = await supabase.from("transacciones").insert({
        fecha, cuenta_codigo: cuenta, centro_costo: centro as any,
        monto_bs: lineaBs, monto_base_bs: lineaBs, iva_bs: 0,
        tasa_bcv: tasaN, monto_usd: lineaUsd,
        metodo_pago: esProvision ? "pendiente" : (esUSD ? "efectivo_usd" : metodo) as any,
        notas: notaLinea,
        modo: offBalance ? "off_balance" : "on_balance",
        cuenta_bancaria_id: !esProvision && !esUSD && cuentaBancariaId ? cuentaBancariaId : null,
        created_by: user.id,
      } as any).select().single();
      if (error) { setBusy(false); return toast.error(error.message); }
      if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    }

    setBusy(false);
    toast.success(`Nómina registrada (${lineas.length} empleado${lineas.length > 1 ? "s" : ""})`);
    qc.invalidateQueries();
    setEmpleados([{ nombre: "", monto: "" }]); setNotas("");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Nómina</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 inline-flex rounded-lg border p-1 w-fit">
            <button type="button" onClick={() => setMoneda("BS")} className={`px-3 py-1.5 text-sm rounded-md ${!esUSD ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Nómina en Bs (on-balance)</button>
            <button type="button" onClick={() => setMoneda("USD")} className={`px-3 py-1.5 text-sm rounded-md ${esUSD ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Nómina en USD (off-balance)</button>
          </div>
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">Nómina regular</SelectItem>
                <SelectItem value="bono">Bono</SelectItem>
                <SelectItem value="liquidacion">Liquidación</SelectItem>
                {!esUSD && <SelectItem value="pasivos">Provisión pasivos laborales</SelectItem>}
                <SelectItem value="parafiscales">Parafiscales</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Centro de costo</Label>
            <Select value={centro} onValueChange={(v) => setCentro(v as Centro)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="text-xs self-end pb-2">Cuenta: <span className="font-semibold">{cuenta}</span></div>
          {esProvision && (
            <div className="md:col-span-2 bg-orange-50 border border-orange-200 text-orange-800 text-xs p-2 rounded">
              Solo G&amp;P. FC se afecta al pagar la liquidación.
            </div>
          )}
          {esUSD && (
            <div className="md:col-span-2 bg-blue-50 border border-blue-200 text-blue-800 text-xs p-2 rounded">
              Nómina en USD: pago directo en efectivo USD, registrado como off-balance.
            </div>
          )}
          <div><Label>Tasa BCV</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" /></div>
          <div className="md:col-span-2 border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Empleados</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLinea}>+ Empleado</Button>
            </div>
            {empleados.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_auto] gap-2 items-center">
                <Input placeholder="Nombre del empleado" value={l.nombre} onChange={(e) => updateLinea(i, { nombre: e.target.value })} />
                <Input type="number" step="0.01" placeholder={esUSD ? "Monto USD" : "Monto Bs"} value={l.monto} onChange={(e) => updateLinea(i, { monto: e.target.value })} className="mono" />
                <Button type="button" variant="ghost" size="sm" disabled={empleados.length === 1} onClick={() => delLinea(i)} className="text-destructive">×</Button>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-sm">
              <span className="text-muted-foreground">Total ({empleados.filter((l) => l.nombre.trim() && Number(l.monto) > 0).length} empleado(s))</span>
              <span className="font-semibold mono">{fmtBs(totalBs)} · {fmtUsd(totalUsd)}</span>
            </div>
          </div>
          {!esProvision && !esUSD && (
            <>
              <div>
                <Label>Método de pago</Label>
                <Select value={metodo} onValueChange={setMetodo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
              </div>
            </>
          )}
          <div className="md:col-span-2"><Label>Notas (común a todos)</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar nómina"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ---------------- FINANCIAMIENTO ---------------- */
function FinanciamientoForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(todayISO());
  const [tipo, setTipo] = useState<keyof typeof FINANCIAMIENTO | "pago_cuota">("prestamo_recibido");
  const [montoBs, setMontoBs] = useState("");
  const [capitalBs, setCapitalBs] = useState("");
  const [interesesBs, setInteresesBs] = useState("");
  const [tasa, setTasa] = useState("");
  const [detalle, setDetalle] = useState("");
  const [plazo, setPlazo] = useState("");
  const [vidaUtil, setVidaUtil] = useState("");
  const [notas, setNotas] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSugerida } = useTasaForDate(fecha);
  useEffect(() => { if (tasaSugerida && !tasa) setTasa(String(tasaSugerida.tasa)); }, [tasaSugerida]);

  const tasaN = Number(tasa) || 0;
  const muestraBanco = tipo !== "depreciacion";
  const baseInsert = (cuenta: string, bs: number) => ({
    fecha, cuenta_codigo: cuenta, centro_costo: "Compartido" as any,
    monto_bs: bs, monto_base_bs: bs, iva_bs: 0,
    tasa_bcv: tasaN, monto_usd: tasaN ? bs / tasaN : 0,
    metodo_pago: "transferencia" as any, notas: notas || detalle || null,
    modo: "on_balance" as any,
    cuenta_bancaria_id: muestraBanco && cuentaBancariaId ? cuentaBancariaId : null,
    created_by: user!.id,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !tasaN) return toast.error("Falta tasa");
    setBusy(true);
    try {
      if (tipo === "pago_cuota") {
        const cap = Number(capitalBs) || 0;
        const int = Number(interesesBs) || 0;
        if (!cap && !int) throw new Error("Indica capital o intereses");
        if (cap) {
          const { data: t1 } = await supabase.from("transacciones").insert(baseInsert("10.2", cap) as any).select().single();
          if (t1) await logAudit("transacciones", "INSERT", t1.id, null, t1);
        }
        if (int) {
          const { data: t2 } = await supabase.from("transacciones").insert(baseInsert("10.3", int) as any).select().single();
          if (t2) await logAudit("transacciones", "INSERT", t2.id, null, t2);
        }
      } else {
        const cfg = FINANCIAMIENTO[tipo];
        const bs = Number(montoBs) || 0;
        const { data: tx, error } = await supabase.from("transacciones").insert(baseInsert(cfg.codigo, bs) as any).select().single();
        if (error) throw error;
        if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
        if (tipo === "prestamo_recibido" && tx) {
          await supabase.from("prestamos").insert({
            prestamista: detalle || "Prestamista",
            plazo_meses: Number(plazo) || 12,
            monto_bs: bs, monto_usd: bs / tasaN, saldo_bs: bs,
            transaccion_id: tx.id, estado: "activo",
          } as any);
        }
      }
      toast.success("Movimiento registrado");
      qc.invalidateQueries();
      setMontoBs(""); setCapitalBs(""); setInteresesBs(""); setDetalle(""); setNotas(""); setPlazo(""); setVidaUtil("");
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const cfg = tipo === "pago_cuota" ? null : FINANCIAMIENTO[tipo];
  const totalCuota = (Number(capitalBs) || 0) + (Number(interesesBs) || 0);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Financiamiento</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v: any) => setTipo(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prestamo_recibido">Préstamo recibido (10.1)</SelectItem>
                <SelectItem value="pago_cuota">Pago de cuota préstamo (10.2 + 10.3)</SelectItem>
                <SelectItem value="dividendos">Pago de dividendos (10.4)</SelectItem>
                <SelectItem value="aumento_capital">Aumento de capital (10.5)</SelectItem>
                <SelectItem value="capex">CapEx — Activo fijo (10.6)</SelectItem>
                <SelectItem value="depreciacion">Depreciación mensual (10.7)</SelectItem>
              </SelectContent>
            </Select>
            {cfg && <p className="text-xs text-muted-foreground mt-1">Afecta: <span className="font-semibold">{cfg.afecta}</span></p>}
          </div>

          {tipo === "pago_cuota" ? (
            <>
              <div><Label>Capital Bs (10.2 → FC)</Label><Input type="number" step="0.01" value={capitalBs} onChange={(e) => setCapitalBs(e.target.value)} className="mono" /></div>
              <div><Label>Intereses Bs (10.3 → G&P)</Label><Input type="number" step="0.01" value={interesesBs} onChange={(e) => setInteresesBs(e.target.value)} className="mono" /></div>
              <div><Label>Tasa BCV</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" /></div>
              <div className="md:col-span-2 rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between"><span>Total cuota:</span><span className="mono font-semibold">{fmtBs(totalCuota)}</span></div>
                <div className="flex justify-between"><span>Capital USD:</span><span className="mono">{fmtUsd(tasaN ? Number(capitalBs)/tasaN : 0)}</span></div>
                <div className="flex justify-between"><span>Intereses USD:</span><span className="mono">{fmtUsd(tasaN ? Number(interesesBs)/tasaN : 0)}</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2"><Label>{tipo === "prestamo_recibido" ? "Prestamista" : tipo === "dividendos" ? "Beneficiarios" : tipo === "aumento_capital" ? "Aportante" : tipo === "capex" ? "Descripción activo" : "Activo"}</Label><Input value={detalle} onChange={(e) => setDetalle(e.target.value)} /></div>
              {tipo === "prestamo_recibido" && (
                <div><Label>Plazo meses</Label><Input type="number" value={plazo} onChange={(e) => setPlazo(e.target.value)} /></div>
              )}
              {tipo === "capex" && (
                <div><Label>Vida útil (meses)</Label><Input type="number" value={vidaUtil} onChange={(e) => setVidaUtil(e.target.value)} /></div>
              )}
              <div><Label>Monto Bs</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} required className="mono" /></div>
              <div><Label>Tasa BCV</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" /></div>
              <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
                <span className="text-sm text-muted-foreground">USD</span>
                <span className="text-lg font-bold mono">{fmtUsd(tasaN ? Number(montoBs)/tasaN : 0)}</span>
              </div>
              {tipo === "capex" && <div className="md:col-span-2 text-xs text-muted-foreground">La depreciación se registra mensualmente por separado (10.7).</div>}
              {tipo === "depreciacion" && <div className="md:col-span-2 text-xs text-muted-foreground">No genera movimiento de caja.</div>}
            </>
          )}
          {muestraBanco && (
            <div className="md:col-span-2">
              <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} />
            </div>
          )}
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar movimiento"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ---------------- CIERRE DE MES ---------------- */
function CierreForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: terceros } = useTerceros();
  const [periodo, setPeriodo] = useState(new Date().toISOString().slice(0, 7));
  const [invIni, setInvIni] = useState("");
  const [invFin, setInvFin] = useState("");
  const [pasivos, setPasivos] = useState("");
  const [deprec, setDeprec] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  // Compras individuales del período
  const [compraFecha, setCompraFecha] = useState(todayISO());
  const [compraTasa, setCompraTasa] = useState("");
  const [compraTerceroId, setCompraTerceroId] = useState("");
  const [compraNumFactura, setCompraNumFactura] = useState("");
  const [compraMonto, setCompraMonto] = useState("");
  const [compraIvaAplica, setCompraIvaAplica] = useState(false);
  const [compraOffBalance, setCompraOffBalance] = useState(false);
  const [compraPagada, setCompraPagada] = useState(true);
  const [compraCuentaBanco, setCompraCuentaBanco] = useState("");
  const [compraVenc, setCompraVenc] = useState("");
  const [compraNotas, setCompraNotas] = useState("");
  const [compraBusy, setCompraBusy] = useState(false);

  const compraTotal = Number(compraMonto) || 0;
  const compraBase = compraIvaAplica ? compraTotal / 1.16 : compraTotal;
  const compraIva = compraIvaAplica ? compraTotal - compraBase : 0;

  const { data: tasaCompraSug } = useTasaForDate(compraFecha);
  useEffect(() => { if (tasaCompraSug && !compraTasa) setCompraTasa(String(tasaCompraSug.tasa)); }, [tasaCompraSug]);

  const { data: compras } = useQuery({
    queryKey: ["compras-periodo", periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventario_snapshots")
        .select("*")
        .eq("periodo", periodo)
        .eq("tipo", "compra")
        .order("fecha", { ascending: false });
      return data ?? [];
    },
  });

  // Tasa promedio del mes: promedio de tasas BCV registradas en el período
  const { data: tasasMes } = useQuery({
    queryKey: ["tasas-periodo", periodo],
    queryFn: async () => {
      const ini = `${periodo}-01`;
      const finDate = new Date(`${periodo}-01T00:00:00`);
      finDate.setMonth(finDate.getMonth() + 1);
      const fin = finDate.toISOString().slice(0, 10);
      const { data } = await supabase
        .from("tasas_bcv")
        .select("tasa")
        .gte("fecha", ini)
        .lt("fecha", fin);
      return data ?? [];
    },
  });
  const tasaPromedio = useMemo(() => {
    const arr = (tasasMes ?? []) as any[];
    if (!arr.length) return 0;
    return arr.reduce((s, t) => s + Number(t.tasa || 0), 0) / arr.length;
  }, [tasasMes]);

  const totalCompras = (compras ?? [])
    .filter((c: any) => c.modo !== "off_balance")
    .reduce((s: number, c: any) => s + (Number(c.monto_base_bs) || Number(c.monto_bs) || 0), 0);

  const ini = Number(invIni) || 0;
  const fin = Number(invFin) || 0;
  const cogs = ini + totalCompras - fin;
  const cogsUsd = tasaPromedio ? cogs / tasaPromedio : 0;

  const addCompra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const monto = Number(compraMonto) || 0;
    const tasaN = Number(compraTasa) || 0;
    if (!monto) return toast.error("Monto requerido");
    if (!tasaN) return toast.error("Tasa requerida");
    if (!compraTerceroId) return toast.error("Selecciona proveedor");
    if (!compraNumFactura) return toast.error("N° factura requerido");
    if (!compraOffBalance && compraPagada && !compraCuentaBanco) return toast.error("Indica cuenta bancaria");
    setCompraBusy(true);

    let cxpId: string | null = null;
    if (!compraOffBalance && !compraPagada) {
      const prov = (terceros ?? []).find((t: any) => t.id === compraTerceroId);
      const { data: cxp, error: cxpErr } = await supabase.from("cuentas_por_pagar").insert({
        proveedor: prov?.razon_social ?? "Proveedor",
        numero_factura: compraNumFactura,
        tercero_id: compraTerceroId,
        centro_costo: "Compartido" as any,
        monto_bs: monto, monto_usd: monto / tasaN,
        monto_pendiente_bs: monto,
        fecha_vencimiento: compraVenc || null,
        estado: "pendiente",
      } as any).select().single();
      if (cxpErr) { setCompraBusy(false); return toast.error(cxpErr.message); }
      cxpId = cxp?.id ?? null;
    }

    const { error } = await supabase.from("inventario_snapshots").insert({
      periodo, tipo: "compra", monto_bs: monto,
      monto_base_bs: compraBase, iva_bs: compraIva, iva_aplica: compraIvaAplica,
      modo: compraOffBalance ? "off_balance" : "on_balance",
      fecha: compraFecha, tasa_bcv: tasaN,
      tercero_id: compraTerceroId, numero_factura: compraNumFactura,
      pagada: compraOffBalance ? true : compraPagada,
      cuenta_bancaria_id: !compraOffBalance && compraPagada ? compraCuentaBanco : null,
      fecha_vencimiento: !compraOffBalance && !compraPagada ? (compraVenc || null) : null,
      cxp_id: cxpId,
      notas: compraNotas || null,
      registrado_por: user.id,
    } as any);
    setCompraBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Compra registrada");
    setCompraMonto(""); setCompraNumFactura(""); setCompraNotas(""); setCompraVenc("");
    setCompraIvaAplica(false); setCompraOffBalance(false);
    qc.invalidateQueries({ queryKey: ["compras-periodo", periodo] });
    qc.invalidateQueries({ queryKey: ["cxp"] });
  };

  const delCompra = async (c: any) => {
    if (c.cxp_id) {
      await supabase.from("cuentas_por_pagar").delete().eq("id", c.cxp_id);
    }
    const { error } = await supabase.from("inventario_snapshots").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["compras-periodo", periodo] });
    qc.invalidateQueries({ queryKey: ["cxp"] });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!tasaPromedio) return toast.error("No hay tasas BCV registradas en el período");
    setBusy(true);
    const { error } = await supabase.from("cierres_de_mes").insert({
      periodo, inventario_inicial_bs: ini, inventario_final_bs: fin,
      compras_mes_bs: totalCompras, cogs_bs: cogs, cogs_usd: cogsUsd,
      tasa_bcv_promedio: tasaPromedio,
      pasivos_laborales_bs: Number(pasivos) || 0,
      depreciacion_bs: Number(deprec) || 0,
      notas: notas || null, registrado_por: user.id, estado: "cerrado",
    } as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Mes cerrado");
    qc.invalidateQueries();
  };

  const tercerosMap = useMemo(() => {
    const m: Record<string, any> = {};
    (terceros ?? []).forEach((t: any) => { m[t.id] = t; });
    return m;
  }, [terceros]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">COGS, Inventario y Cierre</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded border border-orange-300 bg-orange-50 text-orange-800 text-xs p-2.5 font-medium">
          ⚠ Una vez cerrado el mes, no se podrán modificar ni borrar transacciones de este período.
        </div>

        <div>
          <Label className="text-sm">Período</Label>
          <Input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} required className="max-w-xs" />
        </div>

        {/* Compras individuales */}
        <div className="border rounded-lg p-4 space-y-3">
          <div>
            <h3 className="font-semibold text-sm">Compras de inventario / insumos del período</h3>
            <p className="text-xs text-muted-foreground">Cada compra forma parte del COGS y NO debe registrarse también en Gastos/Facturas.</p>
          </div>
          <form onSubmit={addCompra} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={compraFecha} onChange={(e) => setCompraFecha(e.target.value)} required />
            </div>
            <div>
              <Label className="text-xs">Tasa BCV del día</Label>
              <Input type="number" step="0.0001" value={compraTasa} onChange={(e) => setCompraTasa(e.target.value)} required className="mono" />
            </div>
            <div className="md:col-span-2">
              <TerceroSelect value={compraTerceroId} onChange={setCompraTerceroId} terceros={(terceros ?? []) as any} />
            </div>
            <div>
              <Label className="text-xs">N° factura</Label>
              <Input value={compraNumFactura} onChange={(e) => setCompraNumFactura(e.target.value)} required />
            </div>
            <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
              <Label className="text-xs">¿Factura con IVA 16%?</Label>
              <Switch checked={compraIvaAplica} onCheckedChange={setCompraIvaAplica} />
            </div>
            <div>
              <Label className="text-xs">{compraIvaAplica ? "Monto total Bs (IVA incluido)" : "Monto Bs"}</Label>
              <Input type="number" step="0.01" value={compraMonto} onChange={(e) => setCompraMonto(e.target.value)} className="mono" required />
            </div>
            <div>
              <Label className="text-xs">Costo a inventario (base)</Label>
              <Input value={fmtBs(compraBase)} disabled className="mono bg-muted/50" />
            </div>
            {compraIvaAplica && (
              <div className="md:col-span-2 grid grid-cols-2 gap-2 text-xs bg-muted/50 p-2 rounded">
                <div>Base: <span className="mono font-semibold">{fmtBs(compraBase)}</span></div>
                <div>IVA crédito: <span className="mono font-semibold">{fmtBs(compraIva)}</span></div>
              </div>
            )}
            <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
              <div>
                <Label className="text-xs">Off-balance</Label>
                <p className="text-xs text-muted-foreground">Informativo: no afecta COGS ni FC</p>
              </div>
              <Switch checked={compraOffBalance} onCheckedChange={setCompraOffBalance} />
            </div>
            {!compraOffBalance && (
              <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
                <div>
                  <Label className="text-xs">¿Ya fue pagada?</Label>
                  <p className="text-xs text-muted-foreground">Si no, se creará una Cuenta por Pagar.</p>
                </div>
                <Switch checked={compraPagada} onCheckedChange={setCompraPagada} />
              </div>
            )}
            {!compraOffBalance && compraPagada ? (
              <div className="md:col-span-2">
                <BankAccountSelect value={compraCuentaBanco} onChange={setCompraCuentaBanco} label="Cuenta bancaria de la que salió" required />
              </div>
            ) : !compraOffBalance ? (
              <div className="md:col-span-2">
                <Label className="text-xs">Fecha vencimiento (opcional)</Label>
                <Input type="date" value={compraVenc} onChange={(e) => setCompraVenc(e.target.value)} />
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Label className="text-xs">Notas (opcional)</Label>
              <Input value={compraNotas} onChange={(e) => setCompraNotas(e.target.value)} />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={compraBusy} size="sm">{compraBusy ? "…" : "Añadir compra"}</Button>
            </div>
          </form>
          {(compras ?? []).length > 0 && (
            <div className="border-t pt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1">Fecha</th>
                    <th>Proveedor</th>
                    <th>N° fact.</th>
                    <th className="text-right">Monto Bs</th>
                    <th className="text-right">Tasa</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(compras ?? []).map((c: any) => {
                    const prov = c.tercero_id ? tercerosMap[c.tercero_id] : null;
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="py-1">{c.fecha ?? new Date(c.created_at).toISOString().slice(0,10)}</td>
                        <td>{prov?.razon_social ?? "—"}</td>
                        <td>{c.numero_factura ?? "—"}</td>
                        <td className="text-right mono">{fmtBs(Number(c.monto_bs))}</td>
                        <td className="text-right mono">{c.tasa_bcv ? Number(c.tasa_bcv).toFixed(2) : "—"}</td>
                        <td>{c.pagada ? <span className="text-green-700">Pagada</span> : <span className="text-orange-700">CxP</span>}</td>
                        <td>
                          <Button type="button" variant="ghost" size="sm" onClick={() => delCompra(c)} className="text-destructive h-7">×</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td colSpan={3} className="py-2">Total compras del período</td>
                    <td className="text-right mono">{fmtBs(totalCompras)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Cierre */}
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Inventario inicial Bs</Label><Input type="number" step="0.01" value={invIni} onChange={(e) => setInvIni(e.target.value)} className="mono" /></div>
          <div><Label>Inventario final Bs</Label><Input type="number" step="0.01" value={invFin} onChange={(e) => setInvFin(e.target.value)} className="mono" /></div>
          <div className="md:col-span-2 rounded-md bg-muted/50 p-3 flex justify-between text-sm">
            <span className="text-muted-foreground">Compras del mes (auto)</span>
            <span className="mono font-semibold">{fmtBs(totalCompras)}</span>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">Tasa BCV promedio del mes (auto)</div>
            <div className="text-base font-bold mono">{tasaPromedio ? tasaPromedio.toFixed(4) : "—"}</div>
            <div className="text-xs text-muted-foreground">{(tasasMes ?? []).length} tasa(s) registradas</div>
          </div>
          <div className="rounded-md bg-muted p-3 flex flex-col justify-center">
            <span className="text-xs text-muted-foreground">COGS estimado</span>
            <span className="text-base font-bold mono">{fmtBs(cogs)} · {fmtUsd(cogsUsd)}</span>
          </div>
          <div><Label>Pasivos laborales del mes Bs</Label><Input type="number" step="0.01" value={pasivos} onChange={(e) => setPasivos(e.target.value)} className="mono" /></div>
          <div><Label>Depreciación del mes Bs</Label><Input type="number" step="0.01" value={deprec} onChange={(e) => setDeprec(e.target.value)} className="mono" /></div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Cerrando…" : "Cerrar mes"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
