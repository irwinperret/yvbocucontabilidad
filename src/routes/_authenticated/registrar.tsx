import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { fmtBs, fmtUsd, todayISO } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/registrar")({ component: RegistrarPage });

const CENTROS = ["YV", "Bocu", "YV_Market", "Administracion", "Compartido"];
const METODOS = ["tarjeta", "transferencia", "pago_movil", "zelle", "efectivo_usd", "efectivo_bs", "pendiente"];

function RegistrarPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [fecha, setFecha] = useState(todayISO());
  const [cuenta, setCuenta] = useState("");
  const [centro, setCentro] = useState("YV");
  const [montoBs, setMontoBs] = useState("");
  const [tasaInput, setTasaInput] = useState("");
  const [metodo, setMetodo] = useState<string>("transferencia");
  const [referencia, setReferencia] = useState("");
  const [terceroId, setTerceroId] = useState<string>("");
  const [notas, setNotas] = useState("");
  const [offBalance, setOffBalance] = useState(false);
  const [esCredito, setEsCredito] = useState(false);
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: cuentas } = useQuery({
    queryKey: ["plan-cuentas"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_de_cuentas").select("*").eq("activa", true).order("orden");
      return data ?? [];
    },
  });
  const { data: tasaHoy } = useQuery({
    queryKey: ["tasa-hoy", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_bcv").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });
  const { data: terceros } = useQuery({
    queryKey: ["terceros-list"],
    queryFn: async () => {
      const { data } = await supabase.from("terceros").select("*").order("razon_social");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (tasaHoy && !tasaInput) setTasaInput(String(tasaHoy.tasa));
  }, [tasaHoy]);

  const grupos = useMemo(() => {
    const g: Record<string, any[]> = {};
    (cuentas ?? []).forEach((c: any) => { (g[c.grupo] ||= []).push(c); });
    return g;
  }, [cuentas]);

  const tasaNum = Number(tasaInput) || 0;
  const bsNum = Number(montoBs) || 0;
  const usdCalc = tasaNum > 0 ? bsNum / tasaNum : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!cuenta) return toast.error("Selecciona una cuenta");
    if (!tasaNum) return toast.error("Falta la tasa BCV");
    setBusy(true);

    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha,
      cuenta_codigo: cuenta,
      centro_costo: centro as any,
      monto_bs: bsNum,
      monto_usd: usdCalc,
      tasa_bcv: tasaNum,
      metodo_pago: metodo as any,
      referencia: referencia || null,
      tercero_id: terceroId || null,
      notas: notas || null,
      modo: offBalance ? "off_balance" : "on_balance",
      created_by: user.id,
    }).select().single();

    if (error) { setBusy(false); return toast.error(error.message); }

    if (esCredito && cuenta === "1.4") {
      await supabase.from("cuentas_por_cobrar").insert({
        cliente: terceros?.find((t: any) => t.id === terceroId)?.razon_social ?? "Cliente",
        centro_costo: centro as any,
        monto_bs: bsNum,
        monto_usd: usdCalc,
        fecha_vencimiento: fechaVencimiento || null,
        transaccion_id: tx.id,
        estado: "vigente",
      });
    }

    setBusy(false);
    toast.success("Movimiento registrado");
    qc.invalidateQueries();
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Registrar movimiento</h1>
        <p className="text-sm text-muted-foreground">Todos los montos en bolívares. La conversión a USD es automática.</p>
      </div>

      <form onSubmit={submit}>
        <Card>
          <CardHeader><CardTitle className="text-base">Datos del movimiento</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div>
              <Label>Centro de costo</Label>
              <Select value={centro} onValueChange={setCentro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CENTROS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Cuenta</Label>
              <Select value={cuenta} onValueChange={setCuenta}>
                <SelectTrigger><SelectValue placeholder="Selecciona una cuenta" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(grupos).map(([g, items]) => (
                    <div key={g}>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{g}</div>
                      {items.map((c) => <SelectItem key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</SelectItem>)}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Monto en Bs</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} required className="mono" /></div>
            <div>
              <Label>Tasa BCV</Label>
              <Input type="number" step="0.0001" value={tasaInput} onChange={(e) => setTasaInput(e.target.value)} required className="mono" />
              {tasaHoy && <p className="text-xs text-muted-foreground mt-1">Última: {Number(tasaHoy.tasa).toFixed(4)} ({tasaHoy.fecha})</p>}
            </div>
            <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Equivalente USD</span>
              <span className="text-lg font-bold mono">{fmtUsd(usdCalc)}</span>
            </div>
            <div>
              <Label>Método de pago</Label>
              <Select value={metodo} onValueChange={setMetodo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{METODOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Referencia</Label><Input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N° comprobante" /></div>
            <div className="md:col-span-2">
              <Label>Tercero (opcional)</Label>
              <Select value={terceroId} onValueChange={setTerceroId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {terceros?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.razon_social} ({t.tipo})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>

            <div className="md:col-span-2 flex items-center justify-between border-t pt-4">
              <div>
                <Label>Off-balance</Label>
                <p className="text-xs text-muted-foreground">Movimiento no sincronizado (cuentas fuera del flujo principal)</p>
              </div>
              <Switch checked={offBalance} onCheckedChange={setOffBalance} />
            </div>

            {cuenta === "1.4" && (
              <div className="md:col-span-2 border-t pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Crear cuenta por cobrar</Label>
                  <Switch checked={esCredito} onCheckedChange={setEsCredito} />
                </div>
                {esCredito && (
                  <div><Label>Fecha de vencimiento</Label><Input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} /></div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-muted-foreground">
            {montoBs && <>Registrando <span className="mono font-semibold">{fmtBs(bsNum)}</span> ≈ <span className="mono font-semibold">{fmtUsd(usdCalc)}</span></>}
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Guardando..." : "Registrar movimiento"}</Button>
        </div>
      </form>
    </div>
  );
}
