import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useMesCerradoGuard } from "@/lib/mes-cerrado-guard";
import { logAudit } from "@/lib/audit";
import { tasaBcvQuery } from "@/lib/tasas";
import { useCuentasBancarias } from "@/components/bank-account-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtBs, fmtUsd, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { CUENTA_CAMBIO, TIPO_CAMBIO_LABEL, tasaImplicita, type TipoCambio } from "@/lib/operaciones-cambio";

function useTasasDia(fecha: string) {
  return useQuery({
    queryKey: ["tasas-dia-cambio", fecha],
    queryFn: async () => {
      const [{ data: bcv }, { data: par }] = await Promise.all([
        tasaBcvQuery(fecha, "tasa"),
        supabase
          .from("tasas_paralela")
          .select("tasa")
          .lte("fecha", fecha)
          .order("fecha", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return { bcv: Number((bcv as any)?.tasa) || 0, paralela: Number((par as any)?.tasa) || 0 };
    },
  });
}

export function OperacionesCambioForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const ensurePeriodoAbierto = useMesCerradoGuard();
  const { data: bancos } = useCuentasBancarias();

  const [tipo, setTipo] = useState<TipoCambio>("compra");
  const [fecha, setFecha] = useState(todayISO());
  const [bancoOrigen, setBancoOrigen] = useState("");
  const [bancoDestino, setBancoDestino] = useState("");
  const [entregado, setEntregado] = useState("");
  const [recibido, setRecibido] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [recibidoTocado, setRecibidoTocado] = useState(false);

  const { data: tasas } = useTasasDia(fecha);
  const tasaBcv = tasas?.bcv ?? 0;
  const tasaParalela = tasas?.paralela ?? 0;

  const monedaEntregada = tipo === "compra" ? "Bs" : "USD";
  const monedaRecibida = tipo === "compra" ? "USD" : "Bs";

  const nEntregado = Math.abs(Number(entregado) || 0);
  const nRecibido = Math.abs(Number(recibido) || 0);

  // Montos de la operación: siempre un par (Bs, USD)
  const montoBs = tipo === "compra" ? nEntregado : nRecibido;
  const montoUsd = tipo === "compra" ? nRecibido : nEntregado;

  // Compra USD: el monto recibido en USD se sugiere a tasa paralela del día.
  useEffect(() => {
    if (tipo !== "compra" || recibidoTocado) return;
    if (!tasaParalela || !nEntregado) return;
    setRecibido((nEntregado / tasaParalela).toFixed(2));
  }, [tipo, recibidoTocado, tasaParalela, nEntregado]);

  const implicita = tasaImplicita(montoBs, montoUsd);
  const diferencia = implicita && tasaParalela ? +(implicita - tasaParalela).toFixed(4) : 0;
  // Comprar más barato que el paralelo (o vender más caro) es favorable.
  const favorable = tipo === "compra" ? diferencia <= 0 : diferencia >= 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!montoBs || !montoUsd) return toast.error("Indica el monto entregado y el recibido");
    if (!bancoOrigen) return toast.error("Selecciona el banco origen");
    if (!(await ensurePeriodoAbierto(fecha))) return;

    setBusy(true);
    try {
      const grupo = crypto.randomUUID();
      const etiqueta = TIPO_CAMBIO_LABEL[tipo];
      const notaBase =
        `${etiqueta} · Entregado ${monedaEntregada === "Bs" ? fmtBs(nEntregado) : fmtUsd(nEntregado)} · ` +
        `Recibido ${monedaRecibida === "Bs" ? fmtBs(nRecibido) : fmtUsd(nRecibido)} · Tasa ${implicita}` +
        (notas ? ` · ${notas}` : "");

      const base = (signo: 1 | -1, cuentaBancariaId: string | null) => ({
        fecha,
        cuenta_codigo: CUENTA_CAMBIO,
        centro_costo: "Compartido" as any,
        monto_bs: +(signo * montoBs).toFixed(2),
        monto_base_bs: +(signo * montoBs).toFixed(2),
        iva_bs: 0,
        iva_aplica: false,
        monto_usd: +(signo * montoUsd).toFixed(2),
        tasa_bcv: tasaBcv || implicita,
        tasa_paralela: tasaParalela || implicita,
        metodo_pago: "transferencia" as any,
        detalle: `${etiqueta} — ${signo < 0 ? "salida" : "entrada"}`,
        notas: notaBase.slice(0, 255),
        modo: "on_balance" as any,
        cuenta_bancaria_id: cuentaBancariaId,
        grupo_transaccion_id: grupo,
        created_by: user.id,
      });

      const { data, error } = await supabase
        .from("transacciones")
        .insert([base(-1, bancoOrigen), base(1, bancoDestino || null)] as any)
        .select();
      if (error) throw error;
      for (const tx of data ?? []) await logAudit("transacciones", "INSERT", (tx as any).id, null, tx);

      toast.success("Operación de cambio registrada (dos patas en cuenta 98)");
      qc.invalidateQueries();
      setEntregado("");
      setRecibido("");
      setNotas("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Operaciones de Cambio</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Se registran dos transacciones en la cuenta <strong>98 — Operaciones Cambio</strong> (salida y entrada) con el
          mismo grupo. No afectan G&amp;P ni Flujo de caja: el efecto neto es cero.
        </p>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Tipo de operación</Label>
            <Select
              value={tipo}
              onValueChange={(v) => {
                setTipo(v as TipoCambio);
                setEntregado("");
                setRecibido("");
                setRecibidoTocado(false);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="compra">Compra USD (entrego Bs, recibo USD)</SelectItem>
                <SelectItem value="venta">Venta USD (entrego USD, recibo Bs)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fecha</Label>
            <Input
              type="date"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value);
                setRecibidoTocado(false);
              }}
              required
            />
          </div>

          <div>
            <Label>Banco origen (de donde sale)</Label>
            <Select value={bancoOrigen} onValueChange={setBancoOrigen}>
              <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                {(bancos ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nombre} — {b.banco} ({b.moneda})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Banco destino (opcional — puede ser efectivo)</Label>
            <Select value={bancoDestino || "_none_"} onValueChange={(v) => setBancoDestino(v === "_none_" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Sin cuenta / efectivo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_">— Efectivo / sin cuenta —</SelectItem>
                {(bancos ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nombre} — {b.banco} ({b.moneda})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Monto entregado ({monedaEntregada})</Label>
            <Input type="number" step="0.01" value={entregado} onChange={(e) => setEntregado(e.target.value)} required />
          </div>
          <div>
            <Label>Monto recibido ({monedaRecibida})</Label>
            <Input
              type="number"
              step="0.01"
              value={recibido}
              onChange={(e) => {
                setRecibidoTocado(true);
                setRecibido(e.target.value);
              }}
              required
            />
            {tipo === "compra" && (
              <p className="text-xs text-muted-foreground mt-1">
                {tasaParalela
                  ? "Calculado a tasa paralela del día — puedes ajustarlo"
                  : "Sin tasa paralela para esta fecha — ingrésalo manualmente"}
              </p>
            )}
          </div>

          <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border p-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Tasa implícita (Bs/USD)</div>
              <div className="mono font-semibold">{implicita ? implicita.toLocaleString("es-VE") : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Tasa BCV del día</div>
              <div className="mono">{tasaBcv ? tasaBcv.toLocaleString("es-VE") : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Tasa paralela del día</div>
              <div className="mono">{tasaParalela ? tasaParalela.toLocaleString("es-VE") : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Diferencia vs paralela</div>
              <div className={`mono font-semibold ${!diferencia ? "" : favorable ? "positive" : "negative"}`}>
                {diferencia ? diferencia.toLocaleString("es-VE") : "—"}
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>

          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>{busy ? "Registrando..." : "Registrar operación de cambio"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
