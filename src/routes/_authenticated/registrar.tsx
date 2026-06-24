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
import { CENTROS, METODOS, cuentaVenta, cuentaNomina, FINANCIAMIENTO, CAPEX_CATEGORIAS, type Centro } from "@/lib/account-helpers";
import { BankAccountSelect } from "@/components/bank-account-select";
import { TerceroSelect } from "@/components/tercero-select";
import { useGastosSugerencias } from "@/lib/autocomplete-hooks";
import { CierrePendienteBanner } from "@/components/cierre-pendiente-banner";
import { AnticipoProveedorBanner, type AplicacionSel } from "@/components/anticipo-proveedor-banner";
import { aplicarAnticiposContraFactura } from "@/lib/anticipos-proveedor";
import { PagarCxPInline } from "@/components/pagar-cxp-inline";

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

function useParalelaForDate(fecha: string) {
  return useQuery({
    queryKey: ["paralela-for", fecha],
    queryFn: async () => {
      const { data } = await supabase.from("tasas_paralela").select("*").lte("fecha", fecha).order("fecha", { ascending: false }).limit(1).maybeSingle();
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
      <CierrePendienteBanner />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Registrar movimiento</h1>
        <p className="text-sm text-muted-foreground">Elige el tipo de transacción</p>
      </div>
      <Tabs value={current} onValueChange={(v) => navigate({ to: "/registrar", search: { tab: v } })}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 w-full h-auto gap-1 p-1">
          <TabsTrigger value="ventas" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Ventas</TabsTrigger>
          <TabsTrigger value="gastos" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Gastos / Facturas</TabsTrigger>
          <TabsTrigger value="cierre" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">COGS e Inventario</TabsTrigger>
          <TabsTrigger value="nomina" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Nómina</TabsTrigger>
          <TabsTrigger value="liquidaciones" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Liquidaciones</TabsTrigger>
          <TabsTrigger value="ops-iva" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Ops IVA</TabsTrigger>
          <TabsTrigger value="financiamiento" className="text-xs sm:text-sm whitespace-normal h-auto py-1.5">Financiamiento</TabsTrigger>
        </TabsList>
        <TabsContent value="ventas"><VentasForm /></TabsContent>
        <TabsContent value="gastos"><GastosForm /></TabsContent>
        <TabsContent value="cierre"><CierreForm /></TabsContent>
        <TabsContent value="nomina"><NominaForm /></TabsContent>
        <TabsContent value="liquidaciones"><LiquidacionesForm /></TabsContent>
        <TabsContent value="ops-iva"><OpsIvaForm /></TabsContent>
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
  const [tipo, setTipo] = useState<"contado" | "credito" | "cobro" | "ajuste_off">("contado");
  // Ajuste off-balance: factura origen + montos
  const [facturaQuery, setFacturaQuery] = useState("");
  const [facturaTx, setFacturaTx] = useState<any | null>(null);
  const [facturaCliente, setFacturaCliente] = useState<string>("");
  const [buscandoFactura, setBuscandoFactura] = useState(false);
  const [montoOffUsd, setMontoOffUsd] = useState("");
  const [bonoUsd, setBonoUsd] = useState("");
  const [bonoTouched, setBonoTouched] = useState(false);
  const [offFiar, setOffFiar] = useState(false);                 // #9: ajuste off-balance a crédito
  const [offClienteFiar, setOffClienteFiar] = useState("");
  const [offFechaVenc, setOffFechaVenc] = useState("");

  // #6: desglose manual ventas (contado/credito)
  const [bonoServUsd, setBonoServUsd] = useState("");
  const [bonoServTouched, setBonoServTouched] = useState(false);
  const [propinaUsd, setPropinaUsd] = useState("");

  const [cliente, setCliente] = useState("");
  const [fechaVenc, setFechaVenc] = useState("");
  const [ivaAplica, setIvaAplica] = useState(true);
  const [montoTotal, setMontoTotal] = useState("");
  const [ivaMonto, setIvaMonto] = useState("");
  const [ivaTouched, setIvaTouched] = useState(false);
  const [tasa, setTasa] = useState("");
  // Moneda de registro para contado/credito (mismo patrón que GastosFacturaForm).
  // "Cobro de credito anterior" mantiene su lógica previa basada en método de pago, sin cambios.
  const [moneda, setMoneda] = useState<"BS" | "USD">("BS");
  const [metodo, setMetodo] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [numOrden, setNumOrden] = useState("");
  const [notas, setNotas] = useState("");
  const [offBalance, setOffBalance] = useState(false);
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [cxcId, setCxcId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSugerida } = useTasaForDate(fecha);
  const { data: paralelaSugerida } = useParalelaForDate(fecha);
  // Crédito (fiar) y Cobro de crédito anterior se contabilizan a tasa BCV. Contado va a paralela.
  const usaBCV = tipo === "credito" || tipo === "cobro";
  useEffect(() => {
    const sug = usaBCV ? tasaSugerida : paralelaSugerida;
    if (sug) setTasa(String(sug.tasa));
  }, [paralelaSugerida?.tasa, tasaSugerida?.tasa, usaBCV]);

  const { data: cxcVigentes } = useQuery({
    queryKey: ["cxc-vigentes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cuentas_por_cobrar")
        .select("*")
        .eq("estado", "vigente")
        .order("fecha_vencimiento", { ascending: true });
      return data ?? [];
    },
  });

  const cxcSel: any = (cxcVigentes ?? []).find((x: any) => x.id === cxcId);
  const pendienteUsdCxc = Number(cxcSel?.monto_pendiente_usd ?? cxcSel?.monto_usd ?? 0);
  const tasaOrigCxc = cxcSel && Number(cxcSel.monto_usd) > 0
    ? Number(cxcSel.monto_bs) / Number(cxcSel.monto_usd)
    : 0;

  // Cuando seleccionas una CxC para cobrar, prellena con el equivalente en Bs a la tasa BCV de hoy
  useEffect(() => {
    if (tipo !== "cobro" || !cxcId || !cxcSel) return;
    setCliente(cxcSel.cliente ?? "");
    setCentro(cxcSel.centro_costo as Centro);
    const enUsd = metodo === "zelle" || metodo === "efectivo_usd";
    if (enUsd) {
      setMontoTotal(pendienteUsdCxc.toFixed(2));
    } else {
      const tasaHoy = Number(tasaSugerida?.tasa) || Number(tasa) || 0;
      if (tasaHoy > 0) setMontoTotal((pendienteUsdCxc * tasaHoy).toFixed(2));
    }
    setIvaAplica(false); // el IVA ya se causó al emitir la venta a crédito
  }, [cxcId, tipo, cxcSel?.id, tasaSugerida?.tasa, metodo]);


  // Pago en divisas: el monto total se ingresa directamente en USD.
  // Contado y crédito usan el selector explícito de moneda. Cobro de crédito anterior
  // conserva el comportamiento previo (USD si el método es zelle/efectivo_usd).
  const pagoEnUsd = (tipo === "contado" || tipo === "credito")
    ? moneda === "USD"
    : (metodo === "zelle" || metodo === "efectivo_usd");
  const montoN = Number(montoTotal) || 0;
  const tasaN = Number(tasa) || 0;
  // Contado: Bs→USD a tasa paralela. Crédito y Cobro: a tasa BCV.
  const tasaParalelaN = Number(paralelaSugerida?.tasa) || 0;
  const tasaBcvN = Number(tasaSugerida?.tasa) || 0;
  const tasaConvN = usaBCV ? (tasaN || tasaBcvN) : (tasaParalelaN || tasaN);
  // Ventas (contado/credito) registradas en USD: el monto digitado es "dolares a tasa BCV",
  // igual convencion que usan los reportes de Xetux. Para contabilizar: primero se pasa a Bs
  // con la tasa BCV, y ese monto en Bs se reexpresa en USD a la tasa paralela, que es el
  // dolar contable real. "Cobro de credito anterior" conserva su comportamiento previo.
  const esVentaEnUsdBcv = (tipo === "contado" || tipo === "credito") && pagoEnUsd;
  const total = esVentaEnUsdBcv
    ? montoN * tasaBcvN
    : (pagoEnUsd ? montoN * tasaConvN : montoN);
  const totalUsd = esVentaEnUsdBcv
    ? (tasaParalelaN ? total / tasaParalelaN : (tasaBcvN ? montoN : 0))
    : (pagoEnUsd ? montoN : (tasaConvN ? montoN / tasaConvN : 0));
  const base = ivaAplica ? total / 1.16 : total;
  const iva = ivaAplica ? total - base : 0;
  const baseUsd = ivaAplica ? totalUsd / 1.16 : totalUsd;
  const ivaUsd = ivaAplica ? totalUsd - baseUsd : 0;
  const cuenta = tipo === "ajuste_off" ? cuentaVenta(centro, "contado") : cuentaVenta(centro, tipo);
  // Para cobros: USD que se está cancelando con este pago
  const usdCobrado = tipo === "cobro" ? totalUsd : 0;

  // #6: bono servicio 10% y propina (manual ventas contado/credito)
  // Se sugieren y se capturan en la misma moneda elegida para la venta (Bs o USD a tasa BCV).
  const bonoServAuto = pagoEnUsd
    ? (tasaBcvN ? Number(((base * 0.1) / tasaBcvN).toFixed(2)) : 0)
    : Number((base * 0.1).toFixed(2));
  const bonoServInputN = Number(bonoServUsd) || 0;
  const bonoServBsN = pagoEnUsd ? bonoServInputN * tasaBcvN : bonoServInputN;
  const bonoServUsdN = pagoEnUsd
    ? (tasaParalelaN ? bonoServBsN / tasaParalelaN : (tasaBcvN ? bonoServInputN : 0))
    : (tasaConvN ? bonoServInputN / tasaConvN : 0);
  // La propina sigue la misma convención: en USD es "dolares a tasa BCV", se pasa a Bs con
  // BCV y ese Bs se reexpresa en USD a tasa paralela para guardar el dato contable real.
  const propinaInputN = Number(propinaUsd) || 0;
  const propinaBsN = pagoEnUsd ? propinaInputN * tasaBcvN : propinaInputN;
  const propinaUsdN = pagoEnUsd
    ? (tasaParalelaN ? propinaBsN / tasaParalelaN : (tasaBcvN ? propinaInputN : 0))
    : (tasaConvN ? propinaInputN / tasaConvN : 0);
  useEffect(() => {
    if (tipo !== "contado" && tipo !== "credito") return;
    if (bonoServTouched) return;
    setBonoServUsd(bonoServAuto > 0 ? bonoServAuto.toFixed(2) : "");
  }, [tipo, bonoServAuto, bonoServTouched]);

  // ====== Ajuste off-balance: cálculos derivados ======
  const montoOffUsdN = Number(montoOffUsd) || 0;
  const bonoUsdN = Number(bonoUsd) || 0;
  const bonoAuto = Number((montoOffUsdN * 0.1).toFixed(2));
  // tasa para convertir el ajuste off-balance: SIEMPRE tasa paralela (nunca BCV).
  // Prioridad: paralela de la factura origen → paralela de hoy → BCV solo si no hay paralela disponible.
  const tasaOffParalela = facturaTx ? (Number(facturaTx.tasa_paralela) || tasaParalelaN) : tasaParalelaN;
  const tasaOffN = tasaOffParalela || (facturaTx ? (Number(facturaTx.tasa_bcv) || tasaBcvN) : tasaBcvN);
  const tasaOffEsParalela = !!tasaOffParalela;
  const cuentaBonoOff = centro === "YV" ? "3.10" : centro === "Bocu" ? "3.5" : "3.14";

  // Autollenar bono = 10% del monto off si la persona no lo ha tocado
  useEffect(() => {
    if (tipo !== "ajuste_off") return;
    if (bonoTouched) return;
    setBonoUsd(bonoAuto > 0 ? bonoAuto.toFixed(2) : "");
  }, [tipo, bonoAuto, bonoTouched]);

  // Sincronizar centro con la factura origen
  useEffect(() => {
    if (tipo !== "ajuste_off" || !facturaTx) return;
    if (facturaTx.centro_costo && facturaTx.centro_costo !== centro) {
      setCentro(facturaTx.centro_costo as Centro);
    }
  }, [facturaTx?.id, tipo]);

  const buscarFactura = async () => {
    const q = facturaQuery.trim();
    if (!q) return toast.error("Ingresa el número de factura");
    setBuscandoFactura(true);
    try {
      // Busca venta on-balance previa (cuentas 1.1, 1.2, 1.4) por numero_factura o numero_orden
      const { data, error } = await supabase
        .from("transacciones")
        .select("*")
        .in("cuenta_codigo", ["1.1", "1.2", "1.4"])
        .or(`numero_factura.eq.${q},numero_orden.eq.${q}`)
        .order("fecha", { ascending: false })
        .limit(1);
      if (error) throw error;
      const tx = data?.[0];
      if (!tx) { setFacturaTx(null); setFacturaCliente(""); return toast.error("No se encontró ninguna factura con ese número"); }
      setFacturaTx(tx);
      // Intentar resolver nombre del cliente
      let cli = "";
      const { data: cxc } = await supabase
        .from("cuentas_por_cobrar")
        .select("cliente")
        .eq("transaccion_id", tx.id)
        .maybeSingle();
      if (cxc?.cliente) cli = cxc.cliente;
      if (!cli && tx.tercero_id) {
        const { data: ter } = await supabase.from("terceros").select("razon_social, nombre_comercial").eq("id", tx.tercero_id).maybeSingle();
        if (ter) cli = (ter.nombre_comercial || ter.razon_social) ?? "";
      }

      if (!cli && tx.notas) {
        const m = String(tx.notas).match(/cliente\s*[:\-]\s*([^|\n]+)/i);
        if (m) cli = m[1].trim();
      }
      setFacturaCliente(cli);
      toast.success("Factura cargada");
    } catch (e: any) {
      toast.error(e.message ?? "Error buscando factura");
    } finally {
      setBuscandoFactura(false);
    }
  };



  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // ====== Rama especial: Ajuste off-balance ======
    if (tipo === "ajuste_off") {
      if (!facturaTx) return toast.error("Busca primero la factura origen");
      if (montoOffUsdN <= 0) return toast.error("Indica el monto off-balance a registrar ($)");
      if (bonoUsdN < 0) return toast.error("El bono no puede ser negativo");
      if (!tasaOffN) return toast.error("Falta la tasa para convertir el monto");
      if (offFiar && !(offClienteFiar.trim() || facturaCliente.trim())) return toast.error("Indica el cliente para la CxC off-balance");
      setBusy(true);
      try {
        const fechaOff = facturaTx.fecha || fecha;
        const centroOff = (facturaTx.centro_costo as Centro) || centro;
        const montoOffBs = montoOffUsdN * tasaOffN;
        const bonoBs = bonoUsdN * tasaOffN;
        const refFactura = facturaTx.numero_factura || facturaTx.numero_orden || "";
        const cuentaOffVenta = cuentaVenta(centroOff, "contado");

        // 1) Insert venta off-balance
        const { data: txVenta, error: e1 } = await supabase.from("transacciones").insert({
          fecha: fechaOff,
          cuenta_codigo: cuentaOffVenta,
          centro_costo: centroOff as any,
          monto_bs: montoOffBs, monto_base_bs: montoOffBs, iva_bs: 0,
          iva_aplica: false, tipo_iva: null,
          tasa_bcv: Number(facturaTx.tasa_bcv) || tasaBcvN || tasaOffN,
          tasa_paralela: Number(facturaTx.tasa_paralela) || tasaParalelaN || tasaOffN,
          monto_usd: montoOffUsdN,
          metodo_pago: (offFiar ? "pendiente" : "efectivo_usd") as any,
          referencia: null,
          numero_factura: facturaTx.numero_factura || null,
          numero_orden: facturaTx.numero_orden || null,
          notas: `${offFiar ? "Ajuste off-balance A CRÉDITO" : "Ajuste off-balance"} de factura ${refFactura}${facturaCliente ? ` · ${facturaCliente}` : ""}${notas ? ` · ${notas}` : ""}`,
          modo: "off_balance" as any,
          created_by: user.id,
        } as any).select().single();
        if (e1 || !txVenta) throw new Error(e1?.message ?? "No se pudo registrar la venta off-balance");
        await logAudit("transacciones", "INSERT", txVenta.id, null, txVenta);

        // 2) Insert costo (bono 10%) off-balance — sólo si hay monto
        let txBono: any = null;
        if (bonoUsdN > 0) {
          const { data: txB, error: e2 } = await supabase.from("transacciones").insert({
            fecha: fechaOff,
            cuenta_codigo: cuentaBonoOff,
            centro_costo: centroOff as any,
            monto_bs: bonoBs, monto_base_bs: bonoBs, iva_bs: 0,
            iva_aplica: false, tipo_iva: null,
            tasa_bcv: Number(facturaTx.tasa_bcv) || tasaBcvN || tasaOffN,
            tasa_paralela: Number(facturaTx.tasa_paralela) || tasaParalelaN || tasaOffN,
            monto_usd: bonoUsdN,
            metodo_pago: "efectivo_usd" as any,
            referencia: null,
            numero_factura: facturaTx.numero_factura || null,
            numero_orden: facturaTx.numero_orden || null,
            notas: `Bono ${centroOff} (off-balance) por factura ${refFactura}${facturaCliente ? ` · ${facturaCliente}` : ""}`,
            modo: "off_balance" as any,
            pareja_off_balance_id: txVenta.id,
            created_by: user.id,
          } as any).select().single();
          if (e2 || !txB) {
            // Rollback de la venta para no dejar huérfanos
            await supabase.from("transacciones").delete().eq("id", txVenta.id);
            throw new Error(e2?.message ?? "No se pudo registrar el bono off-balance");
          }
          txBono = txB;
          await logAudit("transacciones", "INSERT", txBono.id, null, txBono);
          // Enlace de vuelta venta → bono
          await supabase.from("transacciones").update({ pareja_off_balance_id: txBono.id } as any).eq("id", txVenta.id);
        }

        // #9: CxC off-balance ("fiar" off-balance)
        if (offFiar) {
          const clienteCxC = (offClienteFiar.trim() || facturaCliente.trim() || "Cliente off-balance");
          const { error: eCxc } = await supabase.from("cuentas_por_cobrar").insert({
            cliente: clienteCxC,
            centro_costo: centroOff as any,
            monto_bs: montoOffBs, monto_usd: montoOffUsdN,
            monto_pendiente_bs: montoOffBs, monto_pendiente_usd: montoOffUsdN,
            fecha_vencimiento: offFechaVenc || null,
            transaccion_id: txVenta.id, estado: "vigente",
          } as any);
          if (eCxc) toast.error("Ajuste OK, pero falló crear CxC off-balance: " + eCxc.message);
        }

        toast.success(
          (offFiar ? "Ajuste off-balance a crédito registrado" : "Ajuste off-balance registrado") +
          ` · venta ${fmtUsd(montoOffUsdN)}` +
          (bonoUsdN > 0 ? ` + bono ${fmtUsd(bonoUsdN)}` : "")
        );
        qc.invalidateQueries();
        setFacturaQuery(""); setFacturaTx(null); setFacturaCliente("");
        setMontoOffUsd(""); setBonoUsd(""); setBonoTouched(false); setNotas("");
        setOffFiar(false); setOffClienteFiar(""); setOffFechaVenc("");
      } catch (err: any) {
        toast.error(err.message ?? "Error al registrar ajuste off-balance");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!tasaN) return toast.error("Falta tasa BCV");

    if (tipo === "credito" && !cliente) return toast.error("Indica el cliente");
    if (tipo === "cobro" && !cxcId) return toast.error("Selecciona la cuenta por cobrar a cancelar");
    if (tipo === "cobro" && usdCobrado > pendienteUsdCxc + 0.01) return toast.error(`El cobro no puede exceder el saldo pendiente (${fmtUsd(pendienteUsdCxc)})`);
    if (tipo !== "credito" && !cuentaBancariaId) return toast.error("Selecciona la cuenta bancaria");
    setBusy(true);
    const grupoId = crypto.randomUUID();
    const ivaUsd = ivaAplica && tasaN > 0 ? +(iva / tasaN).toFixed(2) : 0;
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha, cuenta_codigo: cuenta, centro_costo: centro as any,
      monto_bs: base, monto_base_bs: base, iva_bs: 0,
      iva_aplica: false, tipo_iva: null,
      tasa_bcv: tasaN, tasa_paralela: paralelaSugerida?.tasa ?? null, monto_usd: baseUsd,
      metodo_pago: tipo === "credito" ? "pendiente" : (metodo as any),
      referencia: tipo === "credito" ? null : (ref || null),
      numero_orden: numOrden || null,
      notas: notas || null,
      modo: offBalance ? "off_balance" : "on_balance",
      cuenta_bancaria_id: tipo !== "credito" && cuentaBancariaId ? cuentaBancariaId : null,
      created_by: user.id,
      grupo_transaccion_id: ivaAplica ? grupoId : null,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    if (ivaAplica && iva > 0 && tx) {
      const { insertIvaLeg } = await import("@/lib/iva-helpers");
      await insertIvaLeg({
        fecha, centro_costo: centro as any,
        modo: offBalance ? "off_balance" : "on_balance",
        monto_bs_iva: iva, monto_usd_iva: ivaUsd,
        tasa_bcv: tasaN, tasa_paralela: paralelaSugerida?.tasa ?? null,
        numero_orden: numOrden || null,
        notas: notas || null,
        created_by: user.id,
        grupo_transaccion_id: grupoId,
        tipo: "debito",
      });
    }
    if (tipo === "credito" && tx) {
      await supabase.from("cuentas_por_cobrar").insert({
        cliente, centro_costo: centro as any, monto_bs: total, monto_usd: baseUsd,
        monto_pendiente_bs: total, monto_pendiente_usd: baseUsd,
        fecha_vencimiento: fechaVenc || null, transaccion_id: tx.id, estado: "vigente",
      } as any);
    }
    if (tipo === "cobro" && tx && cxcId && cxcSel) {
      const nuevoPendienteUsd = Math.max(0, pendienteUsdCxc - usdCobrado);
      const completaCobrada = nuevoPendienteUsd < 0.01;
      const nuevoPendienteBs = nuevoPendienteUsd * tasaConvN; // referencia en Bs al paralelo de hoy
      await supabase.from("cuentas_por_cobrar").update({
        monto_pendiente_usd: nuevoPendienteUsd,
        monto_pendiente_bs: nuevoPendienteBs,
        estado: completaCobrada ? "cobrada" : "vigente",
        cobrada_at: completaCobrada ? new Date().toISOString() : null,
        transaccion_cobro_id: completaCobrada ? tx.id : cxcSel.transaccion_cobro_id ?? null,
      } as any).eq("id", cxcId);

      // Diferencia cambiaria sobre la porción cobrada: solo GANANCIA (cuenta 11.1).
      // La cuenta 11.2 (pérdida) fue eliminada; las pérdidas se ignoran.
      if (tasaOrigCxc > 0 && tasaConvN > 0) {
        const fxBs = usdCobrado * (tasaConvN - tasaOrigCxc);
        const fxUsd = tasaConvN > 0 ? fxBs / tasaConvN : 0;
        if (fxUsd >= 0.01) {
          const absUsd = fxUsd;
          const absBs = Math.abs(fxBs);
          const { data: txFx, error: errFx } = await supabase.from("transacciones").insert({
            fecha,
            cuenta_codigo: "11.1",
            centro_costo: centro as any,
            monto_bs: absBs, monto_base_bs: absBs, iva_bs: 0,
            tasa_bcv: tasaN, tasa_paralela: tasaParalelaN || null, monto_usd: absUsd,
            metodo_pago: "transferencia" as any,
            notas: `Dif. cambiaria cobro CxC ${cxcSel.cliente} — paralela orig ${tasaOrigCxc.toFixed(4)} → hoy ${tasaConvN.toFixed(4)}`,
            modo: "on_balance" as any, created_by: user.id,
          } as any).select().single();
          if (errFx) toast.error("Cobro OK, pero falló el ajuste cambiario: " + errFx.message);
          else if (txFx) await logAudit("transacciones", "INSERT", txFx.id, null, txFx);
        } else if (fxUsd <= -0.01) {
          toast.info(`Pérdida cambiaria de ${Math.abs(fxUsd).toFixed(2)} USD no se contabiliza (cuenta 11.2 fue eliminada)`);
        }
      }

    }

    // #6: bono servicio 10% (costo) y propina (tabla propinas) — solo contado/credito
    if ((tipo === "contado" || tipo === "credito") && tx) {
      if (bonoServUsdN > 0) {
        const cuentaBono = centro === "YV" ? "3.10" : centro === "Bocu" ? "3.5" : "3.14";
        const { data: txBs, error: eBs } = await supabase.from("transacciones").insert({
          fecha, cuenta_codigo: cuentaBono, centro_costo: centro as any,
          monto_bs: bonoServBsN, monto_base_bs: bonoServBsN, iva_bs: 0,
          iva_aplica: false, tipo_iva: null,
          tasa_bcv: tasaN, tasa_paralela: paralelaSugerida?.tasa ?? null, monto_usd: bonoServUsdN,
          metodo_pago: "pendiente" as any,
          numero_orden: numOrden || null,
          notas: `Bono servicio 10% por venta ${tipo === "credito" ? "a crédito" : "contado"}${cliente ? ` · ${cliente}` : ""}`,
          modo: offBalance ? "off_balance" : "on_balance",
          created_by: user.id,
        } as any).select().single();
        if (eBs) toast.error("Venta OK, pero falló registrar bono servicio: " + eBs.message);
        else if (txBs) await logAudit("transacciones", "INSERT", txBs.id, null, txBs);
      }
      if (propinaUsdN > 0) {
        // 1) 13.1 entry transaction (propina recibida), afecta FC, no G&P
        const grupoPropina = crypto.randomUUID();
        let entradaId: string | null = null;
        const { data: txProp, error: eTxProp } = await supabase.from("transacciones").insert({
          fecha, cuenta_codigo: "13.1", centro_costo: centro as any,
          monto_bs: propinaBsN, monto_base_bs: propinaBsN, iva_bs: 0,
          iva_aplica: false, tipo_iva: null,
          tasa_bcv: tasaN, tasa_paralela: paralelaSugerida?.tasa ?? null,
          monto_usd: propinaUsdN,
          metodo_pago: tipo === "credito" ? "pendiente" : (metodo as any),
          cuenta_bancaria_id: tipo !== "credito" && cuentaBancariaId ? cuentaBancariaId : null,
          numero_orden: numOrden || null,
          notas: `Propina recibida, ${fecha}, ${centro}`,
          modo: "on_balance" as any,
          grupo_transaccion_id: grupoPropina,
          created_by: user.id,
        } as any).select().single();
        if (eTxProp) toast.error("Venta OK, pero falló registrar entrada de propina (13.1): " + eTxProp.message);
        else if (txProp) { entradaId = txProp.id; await logAudit("transacciones", "INSERT", txProp.id, null, txProp); }

        // 2) Propina row linked to entry tx
        const { error: ePr } = await supabase.from("propinas").insert({
          transaccion_id: tx.id, fecha, centro_costo: centro as any,
          monto_usd: propinaUsdN, monto_bs: propinaBsN,
          tasa_paralela: paralelaSugerida?.tasa ?? null,
          concepto: "Propina venta manual",
          numero_orden: numOrden || null,
          notas: notas || null,
          transaccion_entrada_id: entradaId,
          created_by: user.id,
        } as any);
        if (ePr) toast.error("Venta OK, pero falló registrar propina: " + ePr.message);
      }
    }

    setBusy(false);
    const msg = tipo === "credito"
      ? "Venta a crédito registrada (CxC creada)"
      : tipo === "cobro"
        ? (usdCobrado >= pendienteUsdCxc - 0.01 ? "Cobro registrado y CxC cerrada" : `Cobro parcial registrado · saldo restante ${fmtUsd(pendienteUsdCxc - usdCobrado)}`)
        : "Venta registrada";
    toast.success(msg);
    qc.invalidateQueries();
    setMontoTotal(""); setRef(""); setNotas(""); setCliente(""); setCxcId(""); setNumOrden("");
    setBonoServUsd(""); setBonoServTouched(false); setPropinaUsd("");
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
                <SelectItem value="ajuste_off">Ajuste off-balance</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Cuenta: <span className="font-semibold">{cuenta}</span>
              {tipo === "ajuste_off" && <> · Bono off: <span className="font-semibold">{cuentaBonoOff}</span></>}
            </p>
          </div>

          {tipo === "ajuste_off" && (
            <div className="md:col-span-2 space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium">Factura origen</div>
              <div className="flex gap-2">
                <Input
                  value={facturaQuery}
                  onChange={(e) => setFacturaQuery(e.target.value)}
                  placeholder="N° de factura ya registrada (on-balance)"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarFactura(); } }}
                />
                <Button type="button" variant="secondary" onClick={buscarFactura} disabled={buscandoFactura}>
                  {buscandoFactura ? "Buscando…" : "Buscar"}
                </Button>
              </div>
              {facturaTx && (
                <div className="grid grid-cols-2 gap-2 text-sm rounded bg-background p-3 border">
                  <div><span className="text-muted-foreground">Factura:</span> <span className="mono font-semibold">{facturaTx.numero_factura || facturaTx.numero_orden || "—"}</span></div>
                  <div><span className="text-muted-foreground">Fecha:</span> <span className="mono">{facturaTx.fecha}</span></div>
                  <div><span className="text-muted-foreground">Centro:</span> <span className="font-semibold">{facturaTx.centro_costo}</span></div>
                  <div><span className="text-muted-foreground">Monto factura:</span> <span className="mono">{fmtUsd(facturaTx.monto_usd)} · {fmtBs(facturaTx.monto_bs)}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Cliente:</span> <span className="font-semibold">{facturaCliente || "—"}</span></div>
                </div>
              )}

              {facturaTx && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div>
                    <Label>Monto off-balance a registrar ($)</Label>
                    <Input
                      type="number" step="0.01" min="0"
                      value={montoOffUsd}
                      onChange={(e) => setMontoOffUsd(e.target.value)}
                      required
                      className="mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Equivale a {fmtBs(montoOffUsdN * tasaOffN)} ({tasaOffEsParalela ? "tasa paralela" : "tasa BCV (sin paralela del día)"} {tasaOffN ? tasaOffN.toFixed(2) : "—"})
                    </p>
                  </div>
                  <div>
                    <Label>Bono {centro === "Bocu" ? "Bocú" : centro} 10% ($)</Label>
                    <Input
                      type="number" step="0.01" min="0"
                      value={bonoUsd}
                      onChange={(e) => { setBonoUsd(e.target.value); setBonoTouched(true); }}
                      className="mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Sugerido: {fmtUsd(bonoAuto)} (10% del monto off). Cuenta {cuentaBonoOff}.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <Label>Notas (opcional)</Label>
                <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
              </div>

              {/* #9: Off-balance a crédito */}
              {facturaTx && (
                <div className="rounded-md border bg-background p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Registrar como CxC off-balance (fiar)</Label>
                    <Switch checked={offFiar} onCheckedChange={setOffFiar} />
                  </div>
                  {offFiar && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label>Cliente</Label>
                        <Input
                          value={offClienteFiar}
                          onChange={(e) => setOffClienteFiar(e.target.value)}
                          placeholder={facturaCliente || "Cliente off-balance"}
                        />
                      </div>
                      <div>
                        <Label>Fecha esperada cobro</Label>
                        <Input type="date" value={offFechaVenc} onChange={(e) => setOffFechaVenc(e.target.value)} />
                      </div>
                      <p className="md:col-span-2 text-xs text-muted-foreground">
                        Se creará una CxC en {fmtUsd(montoOffUsdN)} ligada a la venta off-balance. El bono 10% (si lo hay) sigue siendo costo off-balance inmediato.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground rounded border border-dashed p-2">
                Al guardar se crean <span className="font-semibold">dos transacciones off-balance enlazadas</span>: la venta y el costo del bono. Si luego eliminas una, la otra también se eliminará (con confirmación).
              </div>
            </div>
          )}


          {tipo === "credito" && (
            <>
              <div><Label>Cliente</Label><Input value={cliente} onChange={(e) => setCliente(e.target.value)} required /></div>
              <div><Label>Fecha esperada cobro</Label><Input type="date" value={fechaVenc} onChange={(e) => setFechaVenc(e.target.value)} /></div>
            </>
          )}

          {tipo === "cobro" && (
            <div className="md:col-span-2">
              <Label>Cuenta por cobrar a cancelar</Label>
              <Select value={cxcId} onValueChange={setCxcId}>
                <SelectTrigger><SelectValue placeholder="Selecciona la venta a crédito que se está cobrando" /></SelectTrigger>
                <SelectContent>
                  {(cxcVigentes ?? []).length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No hay cuentas por cobrar vigentes</div>
                  )}
                  {(cxcVigentes ?? []).map((c: any) => {
                    const pendUsd = Number(c.monto_pendiente_usd ?? c.monto_usd);
                    const parcial = pendUsd < Number(c.monto_usd) - 0.01;
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {c.cliente} — {c.centro_costo} — pendiente {fmtUsd(pendUsd)}{parcial ? ` (de ${fmtUsd(c.monto_usd)})` : ""}{c.fecha_vencimiento ? ` · vence ${c.fecha_vencimiento}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {cxcSel
                  ? `Saldo pendiente: ${fmtUsd(pendienteUsdCxc)} (equivalente hoy a ${fmtBs(pendienteUsdCxc * tasaConvN)} a tasa BCV ${tasaConvN.toFixed(2)}). Este cobro cancela ${fmtUsd(usdCobrado)} de la deuda. La dif. cambiaria vs la tasa original (${tasaOrigCxc.toFixed(2)}) se registra automáticamente.`
                  : "Al guardar, se descuenta del saldo en USD el equivalente del monto cobrado a la tasa BCV de hoy."}

              </p>
            </div>
          )}

          {tipo !== "ajuste_off" && tipo !== "credito" && (
            <>
              <div>
                <Label>Método de pago</Label>
                <Select value={metodo} onValueChange={setMetodo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>N° referencia</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
              <div className="md:col-span-2">
                <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
              </div>
            </>
          )}
          {tipo === "credito" && (
            <div className="md:col-span-2 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              Esta venta queda <span className="font-semibold">pendiente de cobro</span>. No requiere método de pago ni cuenta bancaria — se registrarán cuando se cobre desde "Cobro de crédito anterior".
            </div>
          )}

          {tipo !== "ajuste_off" && (
            <>
              {(tipo === "contado" || tipo === "credito") && (
                <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
                  <Label>Moneda de registro</Label>
                  <div className="inline-flex rounded-lg border p-1">
                    <button type="button" onClick={() => setMoneda("BS")} className={`px-3 py-1 text-xs rounded-md ${moneda !== "USD" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Bolívares (Bs)</button>
                    <button type="button" onClick={() => setMoneda("USD")} className={`px-3 py-1 text-xs rounded-md ${moneda === "USD" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Dólares (USD)</button>
                  </div>
                </div>
              )}
              <div className="md:col-span-2 border-t pt-3 flex items-center justify-between">
                <Label>¿Aplica IVA 16%?</Label>
                <Switch checked={ivaAplica} onCheckedChange={setIvaAplica} />
              </div>
              <div className={pagoEnUsd ? "md:col-span-2" : ""}>
                <Label>{pagoEnUsd ? (esVentaEnUsdBcv ? (ivaAplica ? "Monto total USD a tasa BCV (IVA incluido)" : "Monto USD a tasa BCV") : (ivaAplica ? "Monto total $ (IVA incluido)" : "Monto total $")) : (ivaAplica ? "Monto total Bs (IVA incluido)" : "Monto Bs")}</Label>
                <Input type="number" step="0.01" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} required className="mono" />
              </div>
              {!pagoEnUsd && (
                <div>
                  <Label>{usaBCV ? "Tasa BCV" : "Tasa paralela"}</Label>
                  <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
                  {tipo === "contado" && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Tasa BCV de referencia: <span className="mono font-semibold">{tasaBcvN ? tasaBcvN.toFixed(4) : "—"}</span>
                    </div>
                  )}
                </div>
              )}
              {esVentaEnUsdBcv && (
                <div className="md:col-span-2 grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
                  <div>Tasa BCV usada: <span className="mono font-semibold">{tasaBcvN ? tasaBcvN.toFixed(4) : "—"}</span></div>
                  <div>Tasa paralela usada: <span className="mono font-semibold">{tasaParalelaN ? tasaParalelaN.toFixed(4) : "—"}</span></div>
                  <div className="col-span-2 text-muted-foreground">
                    El monto digitado es en USD a tasa BCV. Para la contabilidad se convierte a Bs ({fmtBs(total)}) y luego a dólar paralelo, que es el valor que se registra: <span className="mono font-semibold">{fmtUsd(totalUsd)}</span>.
                  </div>
                </div>
              )}
              {ivaAplica && tipo === "contado" && (
                <div className="md:col-span-2 grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
                  <div>Base: <span className="mono font-semibold">{fmtBs(base)}</span></div>
                  <div>IVA débito: <span className="mono font-semibold">{fmtBs(iva)}</span></div>
                  <div>Base USD paralelo: <span className="mono">{fmtUsd(baseUsd)}</span></div>
                  <div>IVA USD paralelo: <span className="mono">{fmtUsd(ivaUsd)}</span></div>
                  <div>Base USD BCV: <span className="mono">{fmtUsd(tasaBcvN ? base / tasaBcvN : 0)}</span></div>
                  <div>IVA USD BCV: <span className="mono">{fmtUsd(tasaBcvN ? iva / tasaBcvN : 0)}</span></div>
                </div>
              )}
              <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
                <span className="text-sm text-muted-foreground">G&P: base USD</span>
                <span className="text-lg font-bold mono">{fmtUsd(baseUsd)}</span>
              </div>
              {(tipo === "contado" || tipo === "credito") && (
                <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 space-y-3">
                  <div className="text-sm font-medium">Desglose adicional (opcional)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>{pagoEnUsd ? "Bono servicio 10% (USD a tasa BCV)" : "Bono servicio 10% (Bs)"}</Label>
                      <Input
                        type="number" step="0.01" min="0"
                        value={bonoServUsd}
                        onChange={(e) => { setBonoServUsd(e.target.value); setBonoServTouched(true); }}
                        className="mono"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Sugerido: {pagoEnUsd ? fmtUsd(bonoServAuto) : fmtBs(bonoServAuto)} (10% de la base). Se contabiliza como costo en cuenta {centro === "YV" ? "3.10" : centro === "Bocu" ? "3.5" : "3.14"}.
                      </p>
                    </div>
                    <div>
                      <Label>{pagoEnUsd ? "Propina (USD a tasa BCV)" : "Propina (Bs)"}</Label>
                      <Input
                        type="number" step="0.01" min="0"
                        value={propinaUsd}
                        onChange={(e) => setPropinaUsd(e.target.value)}
                        className="mono"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Se captura en la misma moneda elegida arriba ({pagoEnUsd ? "USD" : "Bs"}). Va a la tabla de propinas. No afecta G&amp;P ni FC.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div><Label>N° de orden (opcional)</Label><Input value={numOrden} onChange={(e) => setNumOrden(e.target.value)} placeholder="Si aplica" /></div>
              <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
              <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
                <Label>Off-balance</Label>
                <Switch checked={offBalance} onCheckedChange={setOffBalance} />
              </div>
            </>
          )}
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : (tipo === "ajuste_off" ? "Registrar ajuste off-balance" : "Registrar ingreso")}</Button>
          </div>

        </form>
      </CardContent>
    </Card>
  );
}

/* ---------------- GASTOS ---------------- */
function GastosForm() {
  const [modo, setModo] = useState<"factura" | "anticipo" | "pagar">("factura");
  const { data: terceros = [] } = useTerceros();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 rounded border p-1 bg-muted/30 text-xs">
        <button type="button" onClick={() => setModo("factura")} className={`px-3 py-1.5 rounded flex-1 ${modo === "factura" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Nueva factura</button>
        <button type="button" onClick={() => setModo("anticipo")} className={`px-3 py-1.5 rounded flex-1 ${modo === "anticipo" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Anticipo a proveedor</button>
        <button type="button" onClick={() => setModo("pagar")} className={`px-3 py-1.5 rounded flex-1 ${modo === "pagar" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Pagar factura pendiente (CxP)</button>
      </div>
      {modo === "factura" && <GastosFacturaForm />}
      {modo === "anticipo" && <AnticipoProveedorRegisterForm onDone={() => setModo("factura")} />}
      {modo === "pagar" && <PagarCxPInline grupo="gastos" terceros={terceros as any} />}
    </div>
  );
}


function AnticipoProveedorRegisterForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: terceros } = useTerceros();
  const [fecha, setFecha] = useState(todayISO());
  const [terceroId, setTerceroId] = useState("");
  const [centro, setCentro] = useState<Centro>("YV");
  const [montoBs, setMontoBs] = useState("");
  const [tasa, setTasa] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: paralelaSug } = useParalelaForDate(fecha);
  const { data: bcvSug } = useTasaForDate(fecha);
  // Egresos: tasa principal es BCV
  useEffect(() => { if (bcvSug?.tasa) setTasa(String(bcvSug.tasa)); }, [bcvSug?.tasa]);

  const montoBsN = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0;
  const montoUsd = tasaN > 0 ? montoBsN / tasaN : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!terceroId) return toast.error("Selecciona proveedor");
    if (!montoBsN) return toast.error("Falta monto Bs");
    if (!tasaN) return toast.error("Falta tasa BCV");
    if (!cuentaBancariaId) return toast.error("Selecciona cuenta bancaria");
    setBusy(true);
    const prov = (terceros ?? []).find((t: any) => t.id === terceroId);
    const nota = `Anticipo a ${prov?.razon_social ?? "proveedor"} — ${fecha}${notas ? ` · ${notas}` : ""}`;
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha, cuenta_codigo: "14.2", centro_costo: centro as any,
      monto_bs: montoBsN, monto_base_bs: montoBsN, iva_bs: 0, iva_aplica: false,
      tasa_bcv: tasaN, tasa_paralela: paralelaSug?.tasa ?? null,
      monto_usd: +montoUsd.toFixed(2),
      metodo_pago: "transferencia" as any,
      tercero_id: terceroId,
      cuenta_bancaria_id: cuentaBancariaId,
      notas: nota,
      anticipo_estado: "abierto",
      anticipo_aplicado_usd: 0,
      created_by: user.id,
    } as any).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    toast.success("Anticipo registrado");
    qc.invalidateQueries();
    setMontoBs(""); setNotas("");
    onDone();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Registrar anticipo a proveedor (14.2)</CardTitle></CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">Salida de FC al activo transitorio 14.2. Sin impacto en G&P. Se podrá aplicar más tarde cuando llegue la factura.</p>
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
            <TerceroSelect value={terceroId} onChange={setTerceroId} terceros={(terceros ?? []) as any} />
          </div>
          <div><Label>Monto Bs</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} required className="mono" /></div>
          <div><Label>Tasa BCV</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" /></div>
          <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">Equivalente</span>
            <span className="text-lg font-bold mono">{fmtUsd(montoUsd)}</span>
          </div>
          <div className="md:col-span-2"><BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required /></div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar anticipo"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function GastosFacturaForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: cuentas } = useCuentas();
  const { data: terceros } = useTerceros();
  const [fecha, setFecha] = useState(todayISO());
  const [terceroId, setTerceroId] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [centro, setCentro] = useState<Centro>("YV");
  const [ivaAplica, setIvaAplica] = useState(true);
  const [montoTotal, setMontoTotal] = useState("");
  const [tasa, setTasa] = useState("");
  const [moneda, setMoneda] = useState<"BS" | "USD">("BS");
  const [metodo, setMetodo] = useState("transferencia");
  const [pendiente, setPendiente] = useState(false);
  const [fechaVenc, setFechaVenc] = useState("");
  const [numFactura, setNumFactura] = useState("");
  const [notas, setNotas] = useState("");
  const [offBalance, setOffBalance] = useState(false);
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);
  const [aplicaciones, setAplicaciones] = useState<AplicacionSel[]>([]);

  const { data: tasaSugerida } = useTasaForDate(fecha);
  const { data: paralelaSugerida } = useParalelaForDate(fecha);
  useEffect(() => { if (tasaSugerida) setTasa(String(tasaSugerida.tasa)); }, [tasaSugerida?.tasa]);

  // Autocomplete por tercero: cuenta + método + notas recientes
  const { data: sugerencias } = useGastosSugerencias(terceroId, centro);
  const [autoAplicado, setAutoAplicado] = useState<string | null>(null);
  useEffect(() => {
    if (!terceroId || !sugerencias) return;
    if (autoAplicado === terceroId) return;
    let aplicado = false;
    if (sugerencias.cuentaTop && !cuenta) {
      const valida = (cuentas ?? []).find((c: any) => c.codigo === sugerencias.cuentaTop);
      const permitida = !valida?.centros_permitidos || valida.centros_permitidos.includes(centro);
      if (valida && permitida) { setCuenta(sugerencias.cuentaTop); aplicado = true; }
    }
    if (sugerencias.metodoTop && sugerencias.metodoTop !== "pendiente" && metodo === "transferencia") {
      setMetodo(sugerencias.metodoTop);
      aplicado = true;
    }
    if (aplicado) setAutoAplicado(terceroId);
  }, [terceroId, sugerencias?.cuentaTop, sugerencias?.metodoTop]);
  useEffect(() => { if (!terceroId) setAutoAplicado(null); }, [terceroId]);

  const esUSD = moneda === "USD";
  const totalInput = Number(montoTotal) || 0;
  const tasaN = Number(tasa) || 0;
  // Conversión Bs→USD a tasa BCV (egresos). Paralela sólo para ingresos.
  const tasaParalelaN = Number(paralelaSugerida?.tasa) || 0;
  const tasaConvN = tasaN || tasaParalelaN;
  const total = esUSD ? totalInput * tasaConvN : totalInput;
  const base = ivaAplica ? total / 1.16 : total;
  const iva = ivaAplica ? total - base : 0;
  const totalUsd = esUSD ? totalInput : (tasaConvN ? totalInput / tasaConvN : 0);
  const baseUsd = ivaAplica ? totalUsd / 1.16 : totalUsd;

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
    if (!pendiente && !cuentaBancariaId) return toast.error("Selecciona la cuenta bancaria");
    setBusy(true);
    const grupoIdGasto = crypto.randomUUID();
    const ivaUsdGasto = ivaAplica && tasaN > 0 ? +(iva / tasaN).toFixed(2) : 0;
    const grupoTransaccionGasto = aplicaciones.length > 0 || ivaAplica ? grupoIdGasto : null;
    const aplicadoUsdFactura = +(aplicaciones.reduce((s, a) => s + a.aplicarUsd, 0)).toFixed(2);
    const aplicadoBsFactura = +(aplicadoUsdFactura * tasaN).toFixed(2);
    const cxpSaldoBs = Math.max(0, +(total - aplicadoBsFactura).toFixed(2));
    const cxpSaldoUsd = Math.max(0, +(totalUsd - aplicadoUsdFactura).toFixed(2));
    // Si hay anticipo aplicado, la factura se trata como pendiente para que la CxP
    // refleje el neto y la aplicación descuente correctamente. Si el usuario NO eligió
    // "pendiente", se liquida el remanente en efectivo justo después.
    const tieneAnticipo = aplicaciones.length > 0;
    const efectivoTrasAnticipo = !pendiente && tieneAnticipo && cxpSaldoBs > 0.01;
    const facturaPendienteEfectiva = pendiente || tieneAnticipo; // siempre crear CxP cuando hay anticipo
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha, cuenta_codigo: cuenta, centro_costo: centro as any,
      monto_bs: base, monto_base_bs: base, iva_bs: 0,
      iva_aplica: false, tipo_iva: null,
      tasa_bcv: tasaN, tasa_paralela: paralelaSugerida?.tasa ?? null, monto_usd: baseUsd,
      metodo_pago: facturaPendienteEfectiva ? "pendiente" : (metodo as any),
      tercero_id: terceroId || null, numero_factura: numFactura, notas: notas || null,
      modo: offBalance ? "off_balance" : "on_balance",
      cuenta_bancaria_id: !facturaPendienteEfectiva && cuentaBancariaId ? cuentaBancariaId : null,
      created_by: user.id,
      grupo_transaccion_id: grupoTransaccionGasto,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    if (ivaAplica && iva > 0 && tx) {
      const { insertIvaLeg } = await import("@/lib/iva-helpers");
      await insertIvaLeg({
        fecha, centro_costo: centro as any,
        modo: offBalance ? "off_balance" : "on_balance",
        monto_bs_iva: iva, monto_usd_iva: ivaUsdGasto,
        tasa_bcv: tasaN, tasa_paralela: paralelaSugerida?.tasa ?? null,
        tercero_id: terceroId || null,
        numero_factura: numFactura,
        notas: notas || null,
        created_by: user.id,
        grupo_transaccion_id: grupoIdGasto,
        tipo: "credito",
      });
    }
    // Crear CxP por el saldo (neto del anticipo) cuando aplique
    let cxpId: string | null = null;
    if (facturaPendienteEfectiva && tx && cxpSaldoBs > 0.01) {
      const prov = (terceros ?? []).find((t: any) => t.id === terceroId);
      const { data: cxpRow, error: eCxp } = await supabase.from("cuentas_por_pagar").insert({
        proveedor: prov?.razon_social ?? "Proveedor",
        numero_factura: numFactura,
        tercero_id: terceroId || null,
        centro_costo: centro as any,
        monto_bs: cxpSaldoBs, monto_usd: cxpSaldoUsd,
        monto_pendiente_bs: cxpSaldoBs,
        fecha_vencimiento: fechaVenc || null,
        transaccion_id: tx.id, estado: "pendiente",
      } as any).select().single();
      if (eCxp) { setBusy(false); return toast.error(eCxp.message); }
      cxpId = cxpRow?.id ?? null;
    }
    // Aplicar anticipos a proveedor seleccionados
    if (tieneAnticipo && tx) {
      const prov = (terceros ?? []).find((t: any) => t.id === terceroId);
      const res = await aplicarAnticiposContraFactura({
        aplicaciones,
        grupoId: grupoIdGasto,
        facturaFecha: fecha,
        facturaProveedorNombre: prov?.razon_social ?? "Proveedor",
        facturaNumero: numFactura,
        created_by: user.id,
        centro,
      });
      if (!res.ok) { setBusy(false); return toast.error(`Anticipo: ${res.error}`); }
    }
    // Si NO era pendiente original y queda remanente, pagarlo de inmediato
    if (efectivoTrasAnticipo && tx && cxpId) {
      const usdPago = tasaN > 0 ? +(cxpSaldoBs / tasaN).toFixed(2) : cxpSaldoUsd;
      const { data: txPago, error: ePago } = await supabase.from("transacciones").insert({
        fecha, cuenta_codigo: cuenta, centro_costo: centro as any,
        monto_bs: cxpSaldoBs, monto_base_bs: cxpSaldoBs, iva_bs: 0,
        tasa_bcv: tasaN, tasa_paralela: paralelaSugerida?.tasa ?? null, monto_usd: usdPago,
        metodo_pago: metodo as any,
        cuenta_bancaria_id: cuentaBancariaId || null,
        tercero_id: terceroId || null,
        notas: `Pago inmediato de factura ${numFactura} (remanente tras anticipo)`,
        modo: offBalance ? "off_balance" : "on_balance",
        grupo_transaccion_id: grupoIdGasto,
        created_by: user.id,
      } as any).select().single();
      if (ePago) { setBusy(false); return toast.error(ePago.message); }
      if (txPago) await logAudit("transacciones", "INSERT", txPago.id, null, txPago);
      await supabase.from("cuentas_por_pagar").update({
        estado: "pagada",
        pagada_at: new Date().toISOString(),
        monto_pendiente_bs: 0,
      }).eq("id", cxpId);
    }
    setBusy(false);
    const msg = tieneAnticipo
      ? (cxpSaldoBs <= 0.01
          ? `Factura cubierta totalmente con anticipo (${fmtUsd(aplicadoUsdFactura)})`
          : (pendiente
              ? `Factura registrada · anticipo ${fmtUsd(aplicadoUsdFactura)} aplicado · CxP por ${fmtUsd(cxpSaldoUsd)}`
              : `Factura registrada · anticipo ${fmtUsd(aplicadoUsdFactura)} aplicado · pago en efectivo ${fmtUsd(cxpSaldoUsd)}`))
      : (pendiente ? "Factura registrada (CxP creada)" : "Gasto registrado");
    toast.success(msg);
    qc.invalidateQueries();
    setMontoTotal(""); setNumFactura(""); setNotas("");
    setAplicaciones([]);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Gastos / Facturas</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2 font-medium">
          ⚠ CUIDADO: No incluyas aquí COGS (comida, mercancía o productos para revender). Esas compras se registran en la pestaña <span className="font-bold">"COGS e Inventario"</span> para evitar contarlas dos veces.
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
          {terceroId && (
            <div className="md:col-span-2">
              <AnticipoProveedorBanner
                terceroId={terceroId}
                facturaTotalUsd={baseUsd}
                onAplicacionesChange={setAplicaciones}
              />
              {aplicaciones.length > 0 && (
                <div className="mt-2 rounded-md bg-green-50 border border-green-300 text-green-900 text-xs p-2 flex justify-between">
                  <span>Anticipo a aplicar: <strong className="mono">{fmtUsd(aplicaciones.reduce((s, a) => s + a.aplicarUsd, 0))}</strong></span>
                  <span>Diferencia a pagar: <strong className="mono">{fmtUsd(Math.max(0, baseUsd - aplicaciones.reduce((s, a) => s + a.aplicarUsd, 0)))}</strong></span>
                </div>
              )}
            </div>
          )}
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
                <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
              </div>
            </>
          )}

          <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
            <Label>¿Factura con IVA 16%?</Label>
            <Switch checked={ivaAplica} onCheckedChange={setIvaAplica} />
          </div>
          <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
            <Label>Moneda de registro</Label>
            <div className="inline-flex rounded-lg border p-1">
              <button type="button" onClick={() => setMoneda("BS")} className={`px-3 py-1 text-xs rounded-md ${!esUSD ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Bolívares (Bs)</button>
              <button type="button" onClick={() => setMoneda("USD")} className={`px-3 py-1 text-xs rounded-md ${esUSD ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Dólares (USD)</button>
            </div>
          </div>
          <div>
            <Label>{esUSD ? (ivaAplica ? "Monto total USD (IVA incluido)" : "Monto USD") : (ivaAplica ? "Monto total Bs (IVA incluido)" : "Monto Bs")}</Label>
            <Input type="number" step="0.01" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>Tasa BCV</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          {tasaN > 0 && totalInput > 0 && (
            <div className="md:col-span-2 grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
              <div>Tasa BCV usada: <span className="mono font-semibold">{tasaN.toFixed(4)}</span></div>
              <div>Equivalente: <span className="mono font-semibold">{esUSD ? fmtBs(total) : fmtUsd(totalUsd)}</span></div>
              <div className="col-span-2 text-muted-foreground text-xs">
                El monto digitado está en {esUSD ? "USD" : "Bs"}. Para la contabilidad (egresos) se usa la tasa BCV del día: {esUSD ? `${fmtUsd(totalInput)} × ${tasaN.toFixed(4)} = ${fmtBs(total)}` : `${fmtBs(totalInput)} ÷ ${tasaN.toFixed(4)} = ${fmtUsd(totalUsd)}`}.
              </div>
            </div>
          )}
          {ivaAplica && (
            <div className="md:col-span-2 grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
              <div>Base: <span className="mono font-semibold">{fmtBs(base)}</span></div>
              <div>IVA crédito: <span className="mono font-semibold">{fmtBs(iva)}</span></div>
            </div>
          )}
          <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">Equivalente · Total {fmtBs(total)}</span>
            <span className="text-lg font-bold mono">G&P base: {fmtUsd(baseUsd)}</span>
          </div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
            {sugerencias?.notasRecientes && sugerencias.notasRecientes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground self-center">Recientes:</span>
                {sugerencias.notasRecientes.map((n, i) => (
                  <button key={i} type="button" onClick={() => setNotas(n)}
                    className="text-xs px-2 py-0.5 rounded border bg-muted/40 hover:bg-muted truncate max-w-[260px]"
                    title={n}>{n}</button>
                ))}
              </div>
            )}
          </div>
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
type NominaSeccion = "BYV" | "BOCU" | "BYV-BOCU";
type NominaCampos = { salario: string; alimentacion: string; compensatorio: string; parafiscales: string };
const NOMINA_CAMPOS_INIT: NominaCampos = { salario: "", alimentacion: "", compensatorio: "", parafiscales: "" };
const NOMINA_MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function lastDayOfMonth(year: number, monthIdx: number) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

// Subcomponente extraído fuera del padre — antes estaba inline y perdía foco en cada keystroke.
function NominaSeccionBlock({
  title, campos, open, onToggle, onChange, totalLabel, moneda,
}: {
  title: string;
  campos: NominaCampos;
  open: boolean;
  onToggle: () => void;
  onChange: (k: keyof NominaCampos, v: string) => void;
  totalLabel: string;
  moneda: "Bs" | "USD";
}) {
  return (
    <div className="border rounded-lg">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50">
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-xs mono text-muted-foreground">{totalLabel} {open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 border-t">
          <div>
            <Label className="text-xs">Salario base ({moneda})</Label>
            <Input type="number" step="0.01" value={campos.salario} onChange={(e) => onChange("salario", e.target.value)} className="mono" />
          </div>
          <div>
            <Label className="text-xs">Bono alimentación ({moneda})</Label>
            <Input type="number" step="0.01" value={campos.alimentacion} onChange={(e) => onChange("alimentacion", e.target.value)} className="mono" />
          </div>
          <div>
            <Label className="text-xs">Bono compensatorio ({moneda})</Label>
            <Input type="number" step="0.01" value={campos.compensatorio} onChange={(e) => onChange("compensatorio", e.target.value)} className="mono" />
          </div>
          <div>
            <Label className="text-xs">Parafiscales ({moneda})</Label>
            <Input type="number" step="0.01" value={campos.parafiscales} onChange={(e) => onChange("parafiscales", e.target.value)} className="mono" />
          </div>
        </div>
      )}
    </div>
  );
}

function NominaForm() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Nómina</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue="regular">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="regular">Nómina regular (Bs)</TabsTrigger>
            <TabsTrigger value="chef">Chef Ejecutivo (USD)</TabsTrigger>
          </TabsList>
          <TabsContent value="regular"><NominaRegularForm /></TabsContent>
          <TabsContent value="chef"><NominaChefForm /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function NominaRegularForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = new Date();
  const [quincena, setQuincena] = useState<"Q1" | "Q2">(today.getDate() <= 15 ? "Q1" : "Q2");
  const [mes, setMes] = useState<number>(today.getMonth());
  const [anio, setAnio] = useState<number>(today.getFullYear());
  const [openSec, setOpenSec] = useState<Record<NominaSeccion, boolean>>({ "BYV": true, "BOCU": true, "BYV-BOCU": false });
  const [secciones, setSecciones] = useState<Record<NominaSeccion, NominaCampos>>({
    "BYV": { ...NOMINA_CAMPOS_INIT },
    "BOCU": { ...NOMINA_CAMPOS_INIT },
    "BYV-BOCU": { ...NOMINA_CAMPOS_INIT },
  });
  const [metodo, setMetodo] = useState("transferencia");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const dia = quincena === "Q1" ? 15 : lastDayOfMonth(anio, mes);
  const fecha = `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const { data: tasaSugerida } = useTasaForDate(fecha);
  const { data: paralelaSugerida } = useParalelaForDate(fecha);
  const tasaBcvN = Number(tasaSugerida?.tasa) || 0;
  const tasaParN = Number(paralelaSugerida?.tasa) || 0;
  const tasaConvN = tasaParN || tasaBcvN;

  const setCampo = (sec: NominaSeccion, k: keyof NominaCampos, v: string) =>
    setSecciones((s) => ({ ...s, [sec]: { ...s[sec], [k]: v } }));

  const totalSecBs = (sec: NominaSeccion) => {
    const c = secciones[sec];
    return Number(c.salario || 0) + Number(c.alimentacion || 0) + Number(c.compensatorio || 0) + Number(c.parafiscales || 0);
  };
  const totalBs = (["BYV","BOCU","BYV-BOCU"] as NominaSeccion[]).reduce((s, x) => s + totalSecBs(x), 0);
  const totalUsd = tasaConvN ? totalBs / tasaConvN : 0;

  const tag = `Nómina ${quincena === "Q1" ? "Quincena 1" : "Quincena 2"} ${NOMINA_MESES[mes]} ${anio}`;

  const buildLineas = () => {
    type L = { cuenta: string; centro: Centro; bs: number; concepto: string };
    const out: L[] = [];
    const pushIf = (cuenta: string, centro: Centro, bs: number, concepto: string) => {
      if (bs > 0.01) out.push({ cuenta, centro, bs: +bs.toFixed(2), concepto });
    };
    {
      const c = secciones["BYV"];
      pushIf("3.9", "YV", Number(c.salario || 0), "Salario base");
      pushIf("3.20", "YV", Number(c.alimentacion || 0), "Bono alimentación");
      pushIf("3.14", "YV", Number(c.compensatorio || 0), "Bono compensatorio");
      pushIf("3.15", "YV", Number(c.parafiscales || 0), "Parafiscales");
    }
    {
      const c = secciones["BOCU"];
      pushIf("3.4", "Bocu", Number(c.salario || 0), "Salario base");
      pushIf("3.20", "Bocu", Number(c.alimentacion || 0), "Bono alimentación");
      pushIf("3.14", "Bocu", Number(c.compensatorio || 0), "Bono compensatorio");
      pushIf("3.15", "Bocu", Number(c.parafiscales || 0), "Parafiscales");
    }
    {
      const c = secciones["BYV-BOCU"];
      const split = (bs: number, cuentaYV: string, cuentaBocu: string, concepto: string) => {
        if (bs <= 0) return;
        const yv = bs * 0.20;
        const bocu = bs - yv;
        pushIf(cuentaYV, "YV", yv, `${concepto} (compartido 20%)`);
        pushIf(cuentaBocu, "Bocu", bocu, `${concepto} (compartido 80%)`);
      };

      split(Number(c.salario || 0), "3.9", "3.4", "Salario base");
      split(Number(c.alimentacion || 0), "3.20", "3.20", "Bono alimentación");
      split(Number(c.compensatorio || 0), "3.14", "3.14", "Bono compensatorio");
      split(Number(c.parafiscales || 0), "3.15", "3.15", "Parafiscales");
    }
    return out;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!tasaConvN) return toast.error("No hay tasa paralela ni BCV para esa fecha");
    if (!cuentaBancariaId) return toast.error("Selecciona la cuenta bancaria de pago");
    const lineas = buildLineas();
    if (!lineas.length) return toast.error("Ingresa al menos un monto");
    setBusy(true);
    const grupoId = (crypto as any).randomUUID();
    let ok = 0;
    for (const l of lineas) {
      const usd = +(l.bs / tasaConvN).toFixed(2);
      const { data: tx, error } = await supabase.from("transacciones").insert({
        fecha, cuenta_codigo: l.cuenta, centro_costo: l.centro as any,
        monto_bs: l.bs, monto_base_bs: l.bs, iva_bs: 0,
        tasa_bcv: tasaBcvN || null, tasa_paralela: tasaParN || null, monto_usd: usd,
        metodo_pago: metodo as any,
        notas: `${tag} · ${l.concepto}${notas ? ` · ${notas}` : ""}`,
        modo: "on_balance",
        cuenta_bancaria_id: cuentaBancariaId,
        grupo_transaccion_id: grupoId,
        created_by: user.id,
      } as any).select().single();
      if (error) { setBusy(false); return toast.error(`${l.cuenta} ${l.centro}: ${error.message}`); }
      if (tx) { await logAudit("transacciones", "INSERT", tx.id, null, tx); ok++; }
    }
    setBusy(false);
    toast.success(`${tag} registrada (${ok} líneas)`);
    qc.invalidateQueries();
    setSecciones({ "BYV": { ...NOMINA_CAMPOS_INIT }, "BOCU": { ...NOMINA_CAMPOS_INIT }, "BYV-BOCU": { ...NOMINA_CAMPOS_INIT } });
    setNotas("");
  };

  return (
    <form onSubmit={submit} className="space-y-4 pt-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>Quincena</Label>
          <Select value={quincena} onValueChange={(v) => setQuincena(v as "Q1" | "Q2")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Q1">Quincena 1 (1–15)</SelectItem>
              <SelectItem value="Q2">Quincena 2 (16–fin de mes)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Mes</Label>
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{NOMINA_MESES.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Año</Label>
          <Input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value) || new Date().getFullYear())} className="mono" />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Se registra con fecha <span className="font-semibold mono">{fecha}</span> · tasa paralela <span className="mono">{tasaParN ? tasaParN.toFixed(2) : "—"}</span>
      </div>

      <div className="space-y-2">
        {(["BYV","BOCU","BYV-BOCU"] as NominaSeccion[]).map((sec) => {
          const titles: Record<NominaSeccion, string> = {
            "BYV": "BYV (centro YV)",
            "BOCU": "BOCU (centro Bocu)",
            "BYV-BOCU": "BYV-BOCU (compartido 20/80)",
          };
          const tot = totalSecBs(sec);
          return (
            <NominaSeccionBlock
              key={sec}
              title={titles[sec]}
              campos={secciones[sec]}
              open={openSec[sec]}
              onToggle={() => setOpenSec((s) => ({ ...s, [sec]: !s[sec] }))}
              onChange={(k, v) => setCampo(sec, k, v)}
              totalLabel={fmtBs(tot)}
              moneda="Bs"
            />
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Método de pago</Label>
          <Select value={metodo} onValueChange={setMetodo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
      </div>

      <div>
        <Label>Notas (opcional)</Label>
        <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-sm">
          <div className="text-muted-foreground">Total nómina</div>
          <div className="font-semibold mono">{fmtBs(totalBs)} · {fmtUsd(totalUsd)}</div>
        </div>
        <Button type="submit" disabled={busy}>{busy ? "Guardando…" : `Registrar ${tag}`}</Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        No incluye: empleados individuales, saldo PMTO, redobles, ni bonos por 10% de servicio (se registran por separado).
      </p>
    </form>
  );
}

function NominaChefForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = new Date();
  const [quincena, setQuincena] = useState<"Q1" | "Q2">(today.getDate() <= 15 ? "Q1" : "Q2");
  const [mes, setMes] = useState<number>(today.getMonth());
  const [anio, setAnio] = useState<number>(today.getFullYear());
  const [centro, setCentro] = useState<"YV" | "Bocu" | "COMPARTIDO">("COMPARTIDO");
  const [campos, setCampos] = useState<NominaCampos>({ ...NOMINA_CAMPOS_INIT });
  const [metodo, setMetodo] = useState("transferencia");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const dia = quincena === "Q1" ? 15 : lastDayOfMonth(anio, mes);
  const fecha = `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const { data: tasaSugerida } = useTasaForDate(fecha);
  const { data: paralelaSugerida } = useParalelaForDate(fecha);
  const tasaBcvN = Number(tasaSugerida?.tasa) || 0;
  const tasaParN = Number(paralelaSugerida?.tasa) || 0;
  const tasaConvN = tasaParN || tasaBcvN;

  const setCampo = (k: keyof NominaCampos, v: string) => setCampos((c) => ({ ...c, [k]: v }));

  const totalUsd = Number(campos.salario || 0) + Number(campos.alimentacion || 0) + Number(campos.compensatorio || 0) + Number(campos.parafiscales || 0);
  const totalBs = totalUsd * tasaConvN;

  const tag = `Nómina Chef Ejecutivo ${quincena === "Q1" ? "Q1" : "Q2"} ${NOMINA_MESES[mes]} ${anio}`;

  const buildLineas = () => {
    type L = { cuenta: string; centro: Centro; usd: number; concepto: string };
    const out: L[] = [];
    const pushIf = (cuenta: string, centro: Centro, usd: number, concepto: string) => {
      if (usd > 0.0001) out.push({ cuenta, centro, usd: +usd.toFixed(2), concepto });
    };
    const fields: { key: keyof NominaCampos; cuentaYV: string; cuentaBocu: string; concepto: string }[] = [
      { key: "salario", cuentaYV: "3.9", cuentaBocu: "3.4", concepto: "Salario base Chef" },
      { key: "alimentacion", cuentaYV: "3.20", cuentaBocu: "3.20", concepto: "Bono alimentación Chef" },
      { key: "compensatorio", cuentaYV: "3.14", cuentaBocu: "3.14", concepto: "Bono compensatorio Chef" },
      { key: "parafiscales", cuentaYV: "3.15", cuentaBocu: "3.15", concepto: "Parafiscales Chef" },
    ];
    for (const f of fields) {
      const usd = Number(campos[f.key] || 0);
      if (usd <= 0) continue;
      if (centro === "YV") pushIf(f.cuentaYV, "YV", usd, f.concepto);
      else if (centro === "Bocu") pushIf(f.cuentaBocu, "Bocu", usd, f.concepto);
      else {
        const yv = usd * 0.20;
        pushIf(f.cuentaYV, "YV", yv, `${f.concepto} (compartido 20%)`);
        pushIf(f.cuentaBocu, "Bocu", usd - yv, `${f.concepto} (compartido 80%)`);
      }
    }
    return out;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!tasaConvN) return toast.error("No hay tasa paralela ni BCV para esa fecha");
    if (!cuentaBancariaId) return toast.error("Selecciona la cuenta bancaria de pago");
    const lineas = buildLineas();
    if (!lineas.length) return toast.error("Ingresa al menos un monto");
    setBusy(true);
    const grupoId = (crypto as any).randomUUID();
    let ok = 0;
    for (const l of lineas) {
      const bs = +(l.usd * tasaConvN).toFixed(2);
      const { data: tx, error } = await supabase.from("transacciones").insert({
        fecha, cuenta_codigo: l.cuenta, centro_costo: l.centro as any,
        monto_bs: bs, monto_base_bs: bs, iva_bs: 0,
        tasa_bcv: tasaBcvN || null, tasa_paralela: tasaParN || null, monto_usd: l.usd,
        metodo_pago: metodo as any,
        notas: `${tag} · ${l.concepto}${notas ? ` · ${notas}` : ""}`,
        modo: "on_balance",
        cuenta_bancaria_id: cuentaBancariaId,
        grupo_transaccion_id: grupoId,
        created_by: user.id,
      } as any).select().single();
      if (error) { setBusy(false); return toast.error(`${l.cuenta} ${l.centro}: ${error.message}`); }
      if (tx) { await logAudit("transacciones", "INSERT", tx.id, null, tx); ok++; }
    }
    setBusy(false);
    toast.success(`${tag} registrada (${ok} líneas)`);
    qc.invalidateQueries();
    setCampos({ ...NOMINA_CAMPOS_INIT });
    setNotas("");
  };

  return (
    <form onSubmit={submit} className="space-y-4 pt-4">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        <strong>Solo Chef Ejecutivo.</strong> Esta pestaña registra nómina en USD (convertida a Bs a tasa paralela). En principio aplica solo al Chef Ejecutivo; acuerdos futuros podrían sumar más casos.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>Quincena</Label>
          <Select value={quincena} onValueChange={(v) => setQuincena(v as "Q1" | "Q2")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Q1">Quincena 1 (1–15)</SelectItem>
              <SelectItem value="Q2">Quincena 2 (16–fin de mes)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Mes</Label>
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{NOMINA_MESES.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Año</Label>
          <Input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value) || new Date().getFullYear())} className="mono" />
        </div>
      </div>

      <div>
        <Label>Centro de costo</Label>
        <Select value={centro} onValueChange={(v) => setCentro(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="YV">YV</SelectItem>
            <SelectItem value="Bocu">Bocu</SelectItem>
            <SelectItem value="COMPARTIDO">Compartido (20% YV / 80% Bocu)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="text-xs text-muted-foreground">
        Fecha <span className="font-semibold mono">{fecha}</span> · tasa paralela <span className="mono">{tasaParN ? tasaParN.toFixed(2) : "—"}</span>
      </div>

      <NominaSeccionBlock
        title="Chef Ejecutivo"
        campos={campos}
        open={true}
        onToggle={() => {}}
        onChange={setCampo}
        totalLabel={fmtUsd(totalUsd)}
        moneda="USD"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Método de pago</Label>
          <Select value={metodo} onValueChange={setMetodo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
      </div>

      <div>
        <Label>Notas (opcional)</Label>
        <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-sm">
          <div className="text-muted-foreground">Total Chef</div>
          <div className="font-semibold mono">{fmtUsd(totalUsd)} · {fmtBs(totalBs)}</div>
        </div>
        <Button type="submit" disabled={busy}>{busy ? "Guardando…" : `Registrar ${tag}`}</Button>
      </div>
    </form>
  );
}


/* ---------------- OPS IVA ---------------- */
function OpsIvaForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(todayISO());
  const [montoBs, setMontoBs] = useState("");
  const [tasa, setTasa] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [numOrden, setNumOrden] = useState("");
  const [notas, setNotas] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSugerida } = useTasaForDate(fecha);
  const { data: paralelaSugerida } = useParalelaForDate(fecha);
  useEffect(() => { if (paralelaSugerida) setTasa(String(paralelaSugerida.tasa)); }, [paralelaSugerida?.tasa]);

  const total = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0; // paralela (input)
  const tasaBcvN = Number(tasaSugerida?.tasa) || 0; // BCV referencia
  const tasaParalelaN = Number(paralelaSugerida?.tasa) || 0;
  const tasaConvN = tasaN || tasaParalelaN; // USD = Bs / paralela
  const usd = tasaConvN ? total / tasaConvN : 0;


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!total) return toast.error("Monto requerido");
    if (!tasaConvN) return toast.error("Falta tasa paralela");

    if (!cuentaBancariaId) return toast.error("Selecciona la cuenta bancaria");
    setBusy(true);
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha,
      cuenta_codigo: "1.8",
      centro_costo: "Compartido" as any,
      monto_bs: total,
      monto_base_bs: total,
      iva_bs: 0,
      iva_aplica: false,
      tipo_iva: null,
      tasa_bcv: tasaBcvN || tasaConvN,
      tasa_paralela: tasaConvN || null,

      monto_usd: usd,
      metodo_pago: metodo as any,
      referencia: ref || null,
      numero_orden: numOrden || null,
      notas: notas || null,
      modo: "off_balance" as any,
      cuenta_bancaria_id: cuentaBancariaId,
      created_by: user.id,
    } as any).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    toast.success("Ops IVA registrado");
    setMontoBs(""); setRef(""); setNumOrden(""); setNotas("");
    qc.invalidateQueries();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Ops IVA</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Método de pago</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METODOS.filter((m) => m !== "pendiente").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required /></div>
          <div><Label>Monto Bs</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} required className="mono" /></div>
          <div><Label>Tasa paralela</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" /></div>
          <div className="rounded-md bg-muted p-3 flex flex-col justify-center">
            <span className="text-xs text-muted-foreground">USD neto</span>
            <span className="text-base font-bold mono">{fmtUsd(usd)}</span>
          </div>
          <div><Label>Referencia</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <div><Label>N° orden / soporte</Label><Input value={numOrden} onChange={(e) => setNumOrden(e.target.value)} /></div>
          <div className="md:col-span-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Se registra como ingreso neto Ops IVA, compartido, sin IVA y fuera de balance.
          </div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar Ops IVA"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ---------------- ACTIVOS TRANSITORIOS — Personal ---------------- */
const ACT_TRANS = {
  prestamo_personal:      { cuenta: "14.1", label: "Préstamo al personal",      tasaTipo: "paralela" as const, hasEntrada: true,  entradaLabel: "Registrar recuperación", salidaLabel: "Registrar préstamo" },
  anticipo_nomina:        { cuenta: "14.3", label: "Anticipo de nómina",        tasaTipo: "paralela" as const, hasEntrada: true,  entradaLabel: "Aplicar contra nómina",   salidaLabel: "Registrar anticipo" },
  anticipo_prestaciones:  { cuenta: "3.22", label: "Anticipo de prestaciones",  tasaTipo: "bcv" as const,      hasEntrada: false, entradaLabel: "",                        salidaLabel: "Registrar anticipo de prestaciones" },
};
type ActTipo = keyof typeof ACT_TRANS;
const CCO_AT = [
  { key: "YV",             centro: "YV" as Centro },
  { key: "Bocú",           centro: "Bocu" as Centro },
  { key: "Administración", centro: "Compartido" as Centro },
  { key: "Cocina",         centro: "Compartido" as Centro },
] as const;
type CcoKey = (typeof CCO_AT)[number]["key"];

function ActivosTransitoriosForm({ tipo, setTipo }: { tipo: ActTipo; setTipo: (v: any) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const cfg = ACT_TRANS[tipo];
  const [movimiento, setMovimiento] = useState<"salida" | "entrada">("salida");
  useEffect(() => { if (!cfg.hasEntrada) setMovimiento("salida"); }, [tipo]);

  const [fecha, setFecha] = useState(todayISO());
  const [empleado, setEmpleado] = useState("");
  const [cco, setCco] = useState<CcoKey>("Bocú");
  const [montoBs, setMontoBs] = useState("");
  const [tasa, setTasa] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [periodoQ, setPeriodoQ] = useState<"Q1" | "Q2">("Q1");
  const [periodoMes, setPeriodoMes] = useState(new Date().toISOString().slice(0, 7));
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaBcvRow } = useTasaForDate(fecha);
  const { data: paralelaRow } = useParalelaForDate(fecha);
  const tasaParalela = Number((paralelaRow as any)?.tasa) || 0;
  const tasaBcv = Number((tasaBcvRow as any)?.tasa) || 0;
  const tasaPrep = movimiento === "entrada" ? tasaBcv : (cfg.tasaTipo === "paralela" ? tasaParalela : tasaBcv);
  useEffect(() => { if (tasaPrep) setTasa(String(tasaPrep)); }, [tasaPrep]);

  const montoBsN = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0;
  const montoUsd = tasaN > 0 ? montoBsN / tasaN : 0;
  const requiereBanco = movimiento === "salida";

  const { data: empleadosAbiertos } = useQuery({
    queryKey: ["act-trans-abiertos", cfg.cuenta],
    enabled: cfg.hasEntrada,
    queryFn: async () => {
      const { data } = await supabase
        .from("transacciones")
        .select("detalle, monto_usd")
        .eq("cuenta_codigo", cfg.cuenta);
      const m = new Map<string, number>();
      (data ?? []).forEach((r: any) => {
        const emp = (String(r.detalle || "").split("·")[1] || "").trim();
        if (!emp) return;
        m.set(emp, (m.get(emp) || 0) + Number(r.monto_usd || 0));
      });
      return Array.from(m.entries()).filter(([, v]) => v > 0.01).map(([k, v]) => ({ empleado: k, saldo: v }));
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!empleado.trim()) return toast.error("Falta nombre del empleado");
    if (!montoBsN) return toast.error("Falta monto en Bs");
    if (!tasaN) return toast.error("Falta tasa");
    if (requiereBanco && !cuentaBancariaId) return toast.error("Selecciona cuenta bancaria");
    setBusy(true);
    const ccoDef = CCO_AT.find((c) => c.key === cco)!;
    const signo = movimiento === "entrada" ? -1 : 1;
    const accion = movimiento === "entrada"
      ? (tipo === "prestamo_personal" ? "Recuperación préstamo" : "Aplicación anticipo nómina")
      : (tipo === "prestamo_personal" ? "Préstamo a" : tipo === "anticipo_nomina" ? "Anticipo nómina" : "Anticipo prestaciones");
    const periodoStr = tipo === "anticipo_nomina" && movimiento === "entrada" ? ` — ${periodoQ} ${periodoMes}` : ` — ${fecha}`;
    const notaCompleta = `${accion} ${empleado.trim()}${periodoStr}${notas ? ` · ${notas}` : ""}`;
    const detalle = `${cco} · ${empleado.trim()}`;

    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha,
      cuenta_codigo: cfg.cuenta,
      centro_costo: ccoDef.centro as any,
      monto_bs: signo * montoBsN,
      monto_base_bs: signo * montoBsN,
      iva_bs: 0,
      iva_aplica: false,
      tasa_bcv: tasaBcv || tasaN,
      tasa_paralela: tasaParalela || null,
      monto_usd: +(signo * montoUsd).toFixed(2),
      metodo_pago: "transferencia" as any,
      cuenta_bancaria_id: requiereBanco ? cuentaBancariaId : null,
      detalle,
      notas: notaCompleta,
      modo: "on_balance",
      created_by: user.id,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    setBusy(false);
    toast.success("Movimiento registrado");
    qc.invalidateQueries();
    setMontoBs(""); setNotas(""); if (movimiento === "salida") setEmpleado("");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Financiamiento — {cfg.label}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <SelectItem value="prestamo_personal">Préstamo al personal (14.1)</SelectItem>
                <SelectItem value="anticipo_nomina">Anticipo de nómina (14.3)</SelectItem>
                <SelectItem value="anticipo_prestaciones">Anticipo de prestaciones (3.22)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Afecta: <span className="font-semibold">FC</span></p>
          </div>

          {cfg.hasEntrada && (
            <div>
              <Label>Movimiento</Label>
              <Select value={movimiento} onValueChange={(v: any) => setMovimiento(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="salida">{cfg.salidaLabel} (salida)</SelectItem>
                  <SelectItem value="entrada">{cfg.entradaLabel} (entrada)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Centro de costo</Label>
            <Select value={cco} onValueChange={(v) => setCco(v as CcoKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CCO_AT.map((c) => <SelectItem key={c.key} value={c.key}>{c.key}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <Label>Nombre del empleado</Label>
            <Input list="empleados-abiertos-list" value={empleado} onChange={(e) => setEmpleado(e.target.value)} required />
            {cfg.hasEntrada && movimiento === "entrada" && (
              <>
                <datalist id="empleados-abiertos-list">
                  {(empleadosAbiertos ?? []).map((e) => <option key={e.empleado} value={e.empleado}>{`saldo $${e.saldo.toFixed(2)}`}</option>)}
                </datalist>
                <p className="text-[11px] text-muted-foreground mt-1">{(empleadosAbiertos ?? []).length} empleado(s) con saldo abierto</p>
              </>
            )}
          </div>

          {tipo === "anticipo_nomina" && movimiento === "entrada" && (
            <>
              <div>
                <Label>Quincena</Label>
                <Select value={periodoQ} onValueChange={(v: any) => setPeriodoQ(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Q1">Q1 (1ra quincena)</SelectItem>
                    <SelectItem value="Q2">Q2 (2da quincena)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Mes de nómina</Label><Input type="month" value={periodoMes} onChange={(e) => setPeriodoMes(e.target.value)} required /></div>
            </>
          )}

          <div>
            <Label>{movimiento === "entrada" ? "Monto recuperado Bs" : "Monto Bs"}</Label>
            <Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} required className="mono" />
          </div>
          <div>
            <Label>{movimiento === "entrada" ? "Tasa BCV del día" : (cfg.tasaTipo === "paralela" ? "Tasa paralela" : "Tasa BCV del día")}</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">Equivale a</span>
            <span className="text-lg font-bold mono">{fmtUsd(montoUsd)} {movimiento === "entrada" ? `(tasa BCV ${tasaN.toFixed(4)})` : ""}</span>
          </div>

          {tipo === "anticipo_prestaciones" && (
            <div className="md:col-span-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              Este pago reduce el saldo de pasivos laborales acumulados del empleado.
            </div>
          )}

          {requiereBanco && (
            <div className="md:col-span-2">
              <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
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

/* ---------------- FINANCIAMIENTO ---------------- */
function FinanciamientoForm() {
  const [tipo, setTipo] = useState<keyof typeof FINANCIAMIENTO | "pago_cuota" | ActTipo>("prestamo_recibido");
  if (tipo === "prestamo_personal" || tipo === "anticipo_nomina" || tipo === "anticipo_prestaciones") {
    return <ActivosTransitoriosForm tipo={tipo} setTipo={setTipo} />;
  }
  return <FinanciamientoBaseForm tipo={tipo} setTipo={setTipo} />;
}

function FinanciamientoBaseForm({ tipo, setTipo }: { tipo: keyof typeof FINANCIAMIENTO | "pago_cuota"; setTipo: (v: any) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(todayISO());
  const [moneda, setMoneda] = useState<"BS" | "USD">("BS");
  const [montoInput, setMontoInput] = useState("");
  const [capitalInput, setCapitalInput] = useState("");
  const [interesesInput, setInteresesInput] = useState("");
  const [tasa, setTasa] = useState("");
  const [detalle, setDetalle] = useState("");
  const [plazo, setPlazo] = useState("");
  // vida útil removida
  const [capexCategoria, setCapexCategoria] = useState<string>("Otros");
  const [notas, setNotas] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tasaSugerida } = useTasaForDate(fecha);
  const { data: paralelaSugerida } = useParalelaForDate(fecha);
  // Pre-llenar con la tasa paralela (sistema). La BCV se conserva como referencia fiscal.
  useEffect(() => { if (paralelaSugerida) setTasa(String(paralelaSugerida.tasa)); }, [paralelaSugerida?.tasa]);

  const tasaParalelaInput = Number(tasa) || 0; // valor del input → paralela
  const tasaBcvN = Number(tasaSugerida?.tasa) || 0; // BCV del día (referencia)
  const tasaConvN = tasaParalelaInput || Number(paralelaSugerida?.tasa) || 0; // USD = Bs / paralela
  const muestraBanco = tipo !== "depreciacion";

  // Conversión según moneda de entrada (USD ↔ Bs a tasa paralela)
  const toBs = (v: string) => {
    const n = Number(v) || 0;
    return moneda === "USD" ? n * tasaConvN : n;
  };
  const toUsd = (v: string) => {
    const n = Number(v) || 0;
    return moneda === "USD" ? n : (tasaConvN ? n / tasaConvN : 0);
  };
  const toUsdBcv = (v: string) => {
    const bs = toBs(v);
    return tasaBcvN ? bs / tasaBcvN : 0;
  };

  const montoBsCalc = toBs(montoInput);
  const montoUsdCalc = toUsd(montoInput);
  const montoUsdBcvCalc = toUsdBcv(montoInput);
  const capitalBsCalc = toBs(capitalInput);
  const interesesBsCalc = toBs(interesesInput);

  const baseInsert = (cuenta: string, bs: number) => ({
    fecha, cuenta_codigo: cuenta, centro_costo: "Compartido" as any,
    monto_bs: bs, monto_base_bs: bs, iva_bs: 0,
    tasa_bcv: tasaBcvN || tasaConvN, tasa_paralela: tasaConvN || null,
    monto_usd: tasaConvN ? bs / tasaConvN : 0,
    metodo_pago: "transferencia" as any, notas: notas || null, detalle: detalle || null,
    modo: "on_balance" as any,
    cuenta_bancaria_id: muestraBanco && cuentaBancariaId ? cuentaBancariaId : null,
    capex_categoria: cuenta === "10.6" ? capexCategoria : null,
    created_by: user!.id,
  });




  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !tasaConvN) return toast.error("Falta tasa paralela");
    if (muestraBanco && !cuentaBancariaId) return toast.error("Selecciona la cuenta bancaria");
    setBusy(true);
    try {
      if (tipo === "pago_cuota") {
        const cap = capitalBsCalc;
        const int = interesesBsCalc;
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
        const bs = montoBsCalc;
        const { data: tx, error } = await supabase.from("transacciones").insert(baseInsert(cfg.codigo, bs) as any).select().single();
        if (error) throw error;
        if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
        if (tipo === "prestamo_recibido" && tx) {
          await supabase.from("prestamos").insert({
            prestamista: detalle || "Prestamista",
            plazo_meses: Number(plazo) || 12,
            monto_bs: bs, monto_usd: tasaConvN ? bs / tasaConvN : 0, saldo_bs: bs,
            transaccion_id: tx.id, estado: "activo",
          } as any);
        }
      }
      toast.success("Movimiento registrado");
      qc.invalidateQueries();
      setMontoInput(""); setCapitalInput(""); setInteresesInput(""); setDetalle(""); setNotas(""); setPlazo("");
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const cfg = tipo === "pago_cuota" ? null : FINANCIAMIENTO[tipo];
  const totalCuotaBs = capitalBsCalc + interesesBsCalc;
  const sufijo = moneda === "USD" ? "$" : "Bs";

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
                <SelectItem value="prestamo_personal">Préstamo al personal (14.1)</SelectItem>
                <SelectItem value="anticipo_nomina">Anticipo de nómina (14.3)</SelectItem>
                <SelectItem value="anticipo_prestaciones">Anticipo de prestaciones (3.22)</SelectItem>
              </SelectContent>
            </Select>
            {cfg && <p className="text-xs text-muted-foreground mt-1">Afecta: <span className="font-semibold">{cfg.afecta}</span></p>}
          </div>

          {muestraBanco && (
            <div className="md:col-span-2">
              <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
            </div>
          )}

          <div className="md:col-span-2">
            <Label>Moneda de registro</Label>
            <Select value={moneda} onValueChange={(v: any) => setMoneda(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BS">Bolívares (Bs)</SelectItem>
                <SelectItem value="USD">Dólares (USD)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tipo === "pago_cuota" ? (
            <>
              <div><Label>Capital {sufijo} (10.2 → FC)</Label><Input type="number" step="0.01" value={capitalInput} onChange={(e) => setCapitalInput(e.target.value)} className="mono" /></div>
              <div><Label>Intereses {sufijo} (10.3 → G&P)</Label><Input type="number" step="0.01" value={interesesInput} onChange={(e) => setInteresesInput(e.target.value)} className="mono" /></div>
              <div><Label>Tasa paralela</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" /></div>
              <div className="md:col-span-2 rounded-md bg-muted p-3 text-sm space-y-1">
                <div className="flex justify-between"><span>Total cuota Bs:</span><span className="mono font-semibold">{fmtBs(totalCuotaBs)}</span></div>
                <div className="flex justify-between"><span>Capital USD:</span><span className="mono">{fmtUsd(toUsd(capitalInput))}</span></div>
                <div className="flex justify-between"><span>Intereses USD:</span><span className="mono">{fmtUsd(toUsd(interesesInput))}</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2"><Label>{tipo === "prestamo_recibido" ? "Prestamista" : tipo === "dividendos" ? "Beneficiarios" : tipo === "aumento_capital" ? "Aportante" : tipo === "capex" ? "Descripción activo" : "Activo"}</Label><Input value={detalle} onChange={(e) => setDetalle(e.target.value)} /></div>
              {tipo === "prestamo_recibido" && (
                <div><Label>Plazo meses</Label><Input type="number" value={plazo} onChange={(e) => setPlazo(e.target.value)} /></div>
              )}
              {tipo === "capex" && (
                <div>
                  <Label>Categoría CapEx</Label>
                  <Select value={capexCategoria} onValueChange={setCapexCategoria}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAPEX_CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div><Label>Monto {sufijo}</Label><Input type="number" step="0.01" value={montoInput} onChange={(e) => setMontoInput(e.target.value)} required className="mono" /></div>
              <div><Label>Tasa paralela</Label><Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" /></div>
              <div className="md:col-span-2 rounded-md bg-muted p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Equivalente Bs</span><span className="mono font-semibold">{fmtBs(montoBsCalc)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">USD paralelo (sistema · tasa {tasaConvN ? tasaConvN.toFixed(4) : "—"})</span><span className="mono font-bold text-base">{fmtUsd(montoUsdCalc)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">USD BCV (referencia · tasa {tasaBcvN ? tasaBcvN.toFixed(4) : "—"})</span><span className="mono">{fmtUsd(montoUsdBcvCalc)}</span></div>
              </div>


              {tipo === "depreciacion" && <div className="md:col-span-2 text-xs text-muted-foreground">No genera movimiento de caja.</div>}
            </>
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
  const [invIniUsd, setInvIniUsd] = useState("");
  const [invFinUsd, setInvFinUsd] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [modoCompra, setModoCompra] = useState<"factura" | "anticipo" | "pagar">("factura");

  // Compras individuales del período
  const [compraFecha, setCompraFecha] = useState(todayISO());
  const [compraTasa, setCompraTasa] = useState("");
  const [compraTerceroId, setCompraTerceroId] = useState("");
  const [compraNumFactura, setCompraNumFactura] = useState("");
  const [compraMonto, setCompraMonto] = useState("");
  const [compraMoneda, setCompraMoneda] = useState<"BS" | "USD">("BS");
  const [compraIvaAplica, setCompraIvaAplica] = useState(true);
  const [compraOffBalance, setCompraOffBalance] = useState(false);
  const [compraPagada, setCompraPagada] = useState(true);
  const [compraCuentaBanco, setCompraCuentaBanco] = useState("");
  const [compraVenc, setCompraVenc] = useState("");
  const [compraNotas, setCompraNotas] = useState("");
  const [compraBusy, setCompraBusy] = useState(false);
  const [compraAplicaciones, setCompraAplicaciones] = useState<AplicacionSel[]>([]);

  const esCompraUSD = compraMoneda === "USD";
  const compraInput = Number(compraMonto) || 0;
  const compraTasaN = Number(compraTasa) || 0;
  const compraTotal = esCompraUSD ? compraInput * compraTasaN : compraInput;
  const compraBase = compraIvaAplica ? compraTotal / 1.16 : compraTotal;
  const compraIva = compraIvaAplica ? compraTotal - compraBase : 0;

  const { data: tasaCompraSug } = useTasaForDate(compraFecha);
  const { data: paralelaCompraSug } = useParalelaForDate(compraFecha);
  useEffect(() => { if (paralelaCompraSug) setCompraTasa(String(paralelaCompraSug.tasa)); }, [paralelaCompraSug?.tasa]);


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

  const { data: cierreActual } = useQuery({
    queryKey: ["cierre-actual", periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from("cierres_de_mes")
        .select("*")
        .eq("periodo", periodo)
        .maybeSingle();
      return data;
    },
  });

  // Período anterior — para recordatorio "cierra el mes pasado"
  const periodoAnterior = useMemo(() => {
    const d = new Date(`${periodo}-01T00:00:00`);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  }, [periodo]);
  const { data: cierreAnterior } = useQuery({
    queryKey: ["cierre-actual", periodoAnterior],
    queryFn: async () => {
      const { data } = await supabase.from("cierres_de_mes").select("id").eq("periodo", periodoAnterior).maybeSingle();
      return data;
    },
  });
  const { data: comprasAnteriorCount } = useQuery({
    queryKey: ["compras-periodo-count", periodoAnterior],
    queryFn: async () => {
      const { count } = await supabase.from("inventario_snapshots").select("id", { count: "exact", head: true })
        .eq("tipo", "compra").eq("periodo", periodoAnterior);
      return count ?? 0;
    },
  });
  const mostrarRecordatorioAnterior = !cierreAnterior && (comprasAnteriorCount ?? 0) > 0 && (compras?.length ?? 0) > 0;

  const reabrirMes = async () => {
    if (!cierreActual) return;
    if (!confirm(`¿Reabrir el mes ${periodo}? Se eliminará el cierre actual y podrás editar transacciones y volver a cerrarlo. Esta acción queda registrada en auditoría.`)) return;
    const { error } = await supabase.from("cierres_de_mes").delete().eq("id", cierreActual.id);
    if (error) return toast.error(error.message);
    // Borrar la transacción COGS generada por el cierre
    await supabase.from("transacciones").delete().eq("referencia", `CIERRE-${periodo}`);
    toast.success(`Mes ${periodo} reabierto`);
    qc.invalidateQueries();
  };


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
        .select("fecha, tasa")
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
  const bcvByFecha = useMemo(() => {
    const m = new Map<string, number>();
    (tasasMes ?? []).forEach((p: any) => m.set(p.fecha, Number(p.tasa)));
    return m;
  }, [tasasMes]);

  // (Paralela ya no se usa para COGS — los egresos se valoran a BCV.)
  const paralelaPromedio = 0;

  const totalCompras = (compras ?? [])
    .filter((c: any) => c.modo !== "off_balance")
    .reduce((s: number, c: any) => s + (Number(c.monto_base_bs) || Number(c.monto_bs) || 0), 0);
  const totalComprasUsdBcv = (compras ?? [])
    .filter((c: any) => c.modo !== "off_balance")
    .reduce((s: number, c: any) => {
      const base = Number(c.monto_base_bs) || Number(c.monto_bs) || 0;
      const tb = Number(c.tasa_bcv) || bcvByFecha.get(c.fecha) || tasaPromedio;
      return s + (tb ? base / tb : 0);
    }, 0);

  const iniUsd = Number(invIniUsd) || 0;
  const finUsd = Number(invFinUsd) || 0;
  const cogsUsd = iniUsd + totalComprasUsdBcv - finUsd;
  const cogs = tasaPromedio ? cogsUsd * tasaPromedio : 0;

  const addCompra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const input = Number(compraMonto) || 0;
    const tasaN = Number(compraTasa) || 0;
    if (!input) return toast.error("Monto requerido");
    if (!tasaN) return toast.error("Tasa requerida");
    if (!compraTerceroId) return toast.error("Selecciona proveedor");
    if (!compraNumFactura) return toast.error("N° factura requerido");
    if (!compraOffBalance && compraPagada && !compraCuentaBanco) return toast.error("Indica cuenta bancaria");
    setCompraBusy(true);

    const montoBs = esCompraUSD ? input * tasaN : input;
    const montoUsd = esCompraUSD ? input : (tasaN ? input / tasaN : 0);
    const aplicadoUsdCompra = +(compraAplicaciones.reduce((s, a) => s + a.aplicarUsd, 0)).toFixed(2);
    const aplicadoBsCompra = +(aplicadoUsdCompra * tasaN).toFixed(2);
    const cxpSaldoBsCompra = Math.max(0, +(montoBs - aplicadoBsCompra).toFixed(2));
    const cxpSaldoUsdCompra = Math.max(0, +(montoUsd - aplicadoUsdCompra).toFixed(2));
    const tieneAnticipoCompra = compraAplicaciones.length > 0;
    // Si hay anticipo, la compra debe ir como pendiente para que la aplicación descuente bien.
    // El remanente se paga inmediatamente si el usuario marcó "pagada".
    const efectivoTrasAnticipoCompra = !compraOffBalance && tieneAnticipoCompra && compraPagada && cxpSaldoBsCompra > 0.01;
    const snapshotPagada = compraOffBalance
      ? true
      : (tieneAnticipoCompra
          ? cxpSaldoBsCompra <= 0.01
          : (compraPagada || cxpSaldoBsCompra <= 0.01));
    const snapshotBanco = !compraOffBalance && compraPagada && !tieneAnticipoCompra ? compraCuentaBanco : null;

    // Evitar facturas duplicadas (mismo proveedor + mismo N° factura), incluso en otros meses
    const { data: dup } = await supabase
      .from("inventario_snapshots")
      .select("id, periodo, fecha")
      .eq("tipo", "compra")
      .eq("tercero_id", compraTerceroId)
      .eq("numero_factura", compraNumFactura)
      .limit(1);
    if (dup && dup.length > 0) {
      setCompraBusy(false);
      const d: any = dup[0];
      return toast.error(`Factura duplicada: ya existe N° ${compraNumFactura} de este proveedor (período ${d.periodo ?? d.fecha})`);
    }


    const grupoId = tieneAnticipoCompra ? crypto.randomUUID() : null;

    // 1) Insertar snapshot de compra (COGS) primero
    const { data: snap, error } = await supabase.from("inventario_snapshots").insert({
      periodo, tipo: "compra", monto_bs: montoBs,
      monto_base_bs: compraBase, iva_bs: compraIva, iva_aplica: compraIvaAplica,
      modo: compraOffBalance ? "off_balance" : "on_balance",
      fecha: compraFecha, tasa_bcv: Number(tasaCompraSug?.tasa) || tasaN,
      tercero_id: compraTerceroId, numero_factura: compraNumFactura,
      pagada: snapshotPagada,
      cuenta_bancaria_id: snapshotBanco,
      fecha_vencimiento: !compraOffBalance && !snapshotPagada ? (compraVenc || null) : null,
      cxp_id: null,
      notas: compraNotas || null,
      registrado_por: user.id,
      grupo_transaccion_id: grupoId,
    } as any).select().single();
    if (error) { setCompraBusy(false); return toast.error(error.message); }

    // 2) Crear CxP por el saldo neto si corresponde (siempre que haya anticipo o factura pendiente)
    let cxpRowId: string | null = null;
    const debeCrearCxp = !compraOffBalance && !snapshotPagada && cxpSaldoBsCompra > 0.01;
    if (debeCrearCxp) {
      const prov = (terceros ?? []).find((t: any) => t.id === compraTerceroId);
      const { data: cxp, error: cxpErr } = await supabase.from("cuentas_por_pagar").insert({
        proveedor: prov?.razon_social ?? "Proveedor",
        numero_factura: compraNumFactura,
        tercero_id: compraTerceroId,
        centro_costo: "Compartido" as any,
        monto_bs: cxpSaldoBsCompra, monto_usd: cxpSaldoUsdCompra,
        monto_pendiente_bs: cxpSaldoBsCompra,
        fecha_vencimiento: compraVenc || null,
        estado: "pendiente",
      } as any).select().single();
      if (cxpErr) {
        if (snap?.id) await supabase.from("inventario_snapshots").delete().eq("id", snap.id);
        setCompraBusy(false); return toast.error(cxpErr.message);
      }
      cxpRowId = cxp?.id ?? null;
      if (cxp?.id && snap?.id) {
        await supabase.from("inventario_snapshots").update({ cxp_id: cxp.id }).eq("id", snap.id);
      }
    }

    // 3) Aplicar anticipos contra la factura
    if (tieneAnticipoCompra && grupoId) {
      const prov = (terceros ?? []).find((t: any) => t.id === compraTerceroId);
      const res = await aplicarAnticiposContraFactura({
        aplicaciones: compraAplicaciones,
        grupoId,
        facturaFecha: compraFecha,
        facturaProveedorNombre: prov?.razon_social ?? "Proveedor",
        facturaNumero: compraNumFactura,
        created_by: user.id,
        centro: "Compartido",
      });
      if (!res.ok) {
        if (cxpRowId) await supabase.from("cuentas_por_pagar").delete().eq("id", cxpRowId);
        if (snap?.id) await supabase.from("inventario_snapshots").delete().eq("id", snap.id);
        setCompraBusy(false);
        return toast.error(`Anticipo: ${res.error}`);
      }
    }

    // 4) Si el usuario marcó "pagada" y hay remanente tras anticipo, pagarlo de inmediato
    if (efectivoTrasAnticipoCompra && cxpRowId) {
      if (!compraCuentaBanco) {
        setCompraBusy(false);
        return toast.error("Falta cuenta bancaria para pagar el remanente del anticipo");
      }
      const usdPago = tasaN > 0 ? +(cxpSaldoBsCompra / tasaN).toFixed(2) : cxpSaldoUsdCompra;
      const { error: ePago } = await supabase.from("transacciones").insert({
        fecha: compraFecha, cuenta_codigo: "9.1", centro_costo: "Compartido" as any,
        monto_bs: cxpSaldoBsCompra, monto_base_bs: cxpSaldoBsCompra, iva_bs: 0,
        tasa_bcv: Number(tasaCompraSug?.tasa) || tasaN, tasa_paralela: tasaN || null, monto_usd: usdPago,
        metodo_pago: "transferencia" as any,
        cuenta_bancaria_id: compraCuentaBanco,
        tercero_id: compraTerceroId,
        notas: `Pago inmediato de compra ${compraNumFactura} (remanente tras anticipo)`,
        modo: "on_balance" as any,
        grupo_transaccion_id: grupoId,
        created_by: user.id,
      } as any);
      if (ePago) { setCompraBusy(false); return toast.error(ePago.message); }
      await supabase.from("cuentas_por_pagar").update({
        estado: "pagada",
        pagada_at: new Date().toISOString(),
        monto_pendiente_bs: 0,
      }).eq("id", cxpRowId);
      await supabase.from("inventario_snapshots").update({
        pagada: true, cuenta_bancaria_id: compraCuentaBanco,
      }).eq("id", snap!.id);
    }

    setCompraBusy(false);
    toast.success(
      tieneAnticipoCompra
        ? (cxpSaldoBsCompra <= 0.01
            ? `Compra cubierta totalmente con anticipo (${fmtUsd(aplicadoUsdCompra)})`
            : `Compra registrada · anticipo ${fmtUsd(aplicadoUsdCompra)} aplicado · ${compraPagada ? "remanente pagado" : "CxP por " + fmtUsd(cxpSaldoUsdCompra)}`)
        : "Compra registrada"
    );
    setCompraMonto(""); setCompraNumFactura(""); setCompraNotas(""); setCompraVenc("");
    setCompraIvaAplica(false); setCompraOffBalance(false);
    setCompraAplicaciones([]);
    qc.invalidateQueries({ queryKey: ["compras-periodo", periodo] });
    qc.invalidateQueries({ queryKey: ["cxp"] });
    qc.invalidateQueries({ queryKey: ["anticipos-abiertos"] });
    qc.invalidateQueries({ queryKey: ["anticipos-proveedor"] });
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
    const tasaConv = paralelaPromedio || tasaPromedio;
    if (!tasaConv) return toast.error("No hay tasas registradas en el período");
    setBusy(true);
    const { error } = await supabase.from("cierres_de_mes").insert({
      periodo,
      inventario_inicial_bs: iniUsd * tasaConv,
      inventario_final_bs: finUsd * tasaConv,
      compras_mes_bs: totalCompras, cogs_bs: cogs, cogs_usd: cogsUsd,
      tasa_bcv_promedio: tasaPromedio,

      pasivos_laborales_bs: 0,
      depreciacion_bs: 0,
      notas: notas || null, registrado_por: user.id, estado: "cerrado",
    } as any);
    if (error) { setBusy(false); return toast.error(error.message); }

    // Postear COGS como transacción para que se refleje en G&P y FC
    // Fecha = último día del período. Cuenta 2.2 (Ajuste COGS por inventario, afecta G&P).
    if (cogs && Math.abs(cogs) > 0.01) {
      const finDate = new Date(`${periodo}-01T00:00:00`);
      finDate.setMonth(finDate.getMonth() + 1);
      finDate.setDate(0);
      const fechaCierre = finDate.toISOString().slice(0, 10);
      // Borrar cualquier transacción residual del cierre anterior para este período
      await supabase.from("transacciones").delete().eq("referencia", `CIERRE-${periodo}`);
      await supabase.from("transacciones").insert({
        fecha: fechaCierre, cuenta_codigo: "2.2", centro_costo: "Compartido" as any,
        monto_bs: cogs, monto_base_bs: cogs, iva_bs: 0,
        tasa_bcv: tasaPromedio || tasaConv, tasa_paralela: paralelaPromedio || null,
        monto_usd: cogsUsd,
        metodo_pago: "transferencia" as any, modo: "on_balance" as any,
        referencia: `CIERRE-${periodo}`,
        notas: `COGS automático del cierre de ${periodo}`,
        created_by: user.id,
      } as any);
    }

    setBusy(false);
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
        {cierreActual ? (
          <div className="rounded border border-red-300 bg-red-50 text-red-800 text-xs p-3 font-medium flex items-start justify-between gap-3 flex-wrap">
            <div>
              🔒 <strong>Mes {periodo} cerrado</strong> el {new Date(cierreActual.created_at).toLocaleDateString()}. Las transacciones están bloqueadas. Si necesitas corregir algo, reabre el mes, edita y vuelve a cerrarlo.
            </div>
            <Button type="button" size="sm" variant="outline" onClick={reabrirMes} className="border-red-400 text-red-800 hover:bg-red-100">
              Reabrir mes
            </Button>
          </div>
        ) : (
          <div className="rounded border border-orange-300 bg-orange-50 text-orange-800 text-xs p-2.5 font-medium">
            ⚠ Una vez cerrado el mes, no se podrán modificar ni borrar transacciones de este período (un admin puede reabrirlo después si hay errores).
          </div>
        )}

        {mostrarRecordatorioAnterior && (
          <div className="rounded border border-amber-300 bg-amber-50 text-amber-800 text-xs p-3 font-medium">
            🔔 Recordatorio: el mes anterior <strong>{periodoAnterior}</strong> aún no está cerrado. No es obligatorio, pero te conviene cerrarlo antes de seguir registrando compras en {periodo}.
          </div>
        )}


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
          <div className="flex flex-wrap gap-1 rounded border p-1 bg-muted/30 text-xs">
            <button type="button" onClick={() => setModoCompra("factura")} className={`px-3 py-1.5 rounded flex-1 ${modoCompra === "factura" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Nueva compra</button>
            <button type="button" onClick={() => setModoCompra("anticipo")} className={`px-3 py-1.5 rounded flex-1 ${modoCompra === "anticipo" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Anticipo a proveedor</button>
            <button type="button" onClick={() => setModoCompra("pagar")} className={`px-3 py-1.5 rounded flex-1 ${modoCompra === "pagar" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Pagar factura pendiente (CxP)</button>
          </div>
          {modoCompra === "anticipo" ? (
            <AnticipoProveedorRegisterForm onDone={() => setModoCompra("factura")} />
          ) : modoCompra === "pagar" ? (
            <PagarCxPInline grupo="cogs" terceros={(terceros ?? []) as any} />
          ) : (<>

          <form onSubmit={addCompra} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={compraFecha} onChange={(e) => setCompraFecha(e.target.value)} required />
            </div>
            <div>
              <Label className="text-xs">Tasa paralela del día</Label>
              <Input type="number" step="0.0001" value={compraTasa} onChange={(e) => setCompraTasa(e.target.value)} required className="mono" />

            </div>
            <div className="md:col-span-2">
              <TerceroSelect value={compraTerceroId} onChange={setCompraTerceroId} terceros={(terceros ?? []) as any} />
            </div>
            {compraTerceroId && (
              <div className="md:col-span-2">
                <AnticipoProveedorBanner
                  terceroId={compraTerceroId}
                  facturaTotalUsd={Number(esCompraUSD ? compraInput : (compraTasaN ? compraInput / compraTasaN : 0)) || 0}
                  onAplicacionesChange={setCompraAplicaciones}
                />
                {compraAplicaciones.length > 0 && (
                  <div className="mt-2 rounded-md bg-green-50 border border-green-300 text-green-900 text-xs p-2">
                    Aplicando anticipo: <strong className="mono">{fmtUsd(compraAplicaciones.reduce((s, a) => s + a.aplicarUsd, 0))}</strong>
                  </div>
                )}
              </div>
            )}
            <div>
              <Label className="text-xs">N° factura</Label>
              <Input value={compraNumFactura} onChange={(e) => setCompraNumFactura(e.target.value)} required />
            </div>
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
            <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
              <Label className="text-xs">Moneda de registro</Label>
              <div className="inline-flex rounded-lg border p-1">
                <button type="button" onClick={() => setCompraMoneda("BS")} className={`px-3 py-1 text-xs rounded-md ${!esCompraUSD ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Bolívares (Bs)</button>
                <button type="button" onClick={() => setCompraMoneda("USD")} className={`px-3 py-1 text-xs rounded-md ${esCompraUSD ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Dólares (USD)</button>
              </div>
            </div>
            <div className="md:col-span-2 flex items-center justify-between border-t pt-3">
              <Label className="text-xs">¿Factura con IVA 16%?</Label>
              <Switch checked={compraIvaAplica} onCheckedChange={setCompraIvaAplica} />
            </div>
            <div>
              <Label className="text-xs">{esCompraUSD ? (compraIvaAplica ? "Monto total USD (IVA incluido)" : "Monto USD") : (compraIvaAplica ? "Monto total Bs (IVA incluido)" : "Monto Bs")}</Label>
              <Input type="number" step="0.01" value={compraMonto} onChange={(e) => setCompraMonto(e.target.value)} className="mono" required />
            </div>
            <div>
              <Label className="text-xs">Costo a inventario (base Bs)</Label>
              <Input value={fmtBs(compraBase)} disabled className="mono bg-muted/50" />
            </div>
            {compraTasaN > 0 && compraInput > 0 && (
              <div className="md:col-span-2 grid grid-cols-2 gap-2 text-sm bg-muted/50 p-3 rounded">
                <div>Tasa paralela usada: <span className="mono font-semibold">{compraTasaN.toFixed(4)}</span></div>
                <div>Equivalente: <span className="mono font-semibold">{esCompraUSD ? fmtBs(compraTotal) : fmtUsd(compraTasaN ? compraInput / compraTasaN : 0)}</span></div>
                <div className="col-span-2 text-muted-foreground text-xs">
                  El monto digitado está en {esCompraUSD ? "USD" : "Bs"}. Para la contabilidad (compras de inventario) se usa la tasa paralela del día: {esCompraUSD ? `${fmtUsd(compraInput)} × ${compraTasaN.toFixed(4)} = ${fmtBs(compraTotal)}` : `${fmtBs(compraInput)} ÷ ${compraTasaN.toFixed(4)} = ${fmtUsd(compraInput / compraTasaN)}`}.
                </div>
              </div>
            )}
            {compraIvaAplica && (
              <div className="md:col-span-2 grid grid-cols-2 gap-2 text-xs bg-muted/50 p-2 rounded">
                <div>Base: <span className="mono font-semibold">{fmtBs(compraBase)}</span></div>
                <div>IVA crédito: <span className="mono font-semibold">{fmtBs(compraIva)}</span></div>
              </div>
            )}
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
              <table className="w-full text-xs [&_th]:px-2 [&_td]:px-2 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1">Fecha</th>
                    <th>Proveedor</th>
                    <th>N° fact.</th>
                    <th className="text-right">Monto Bs</th>
                    <th className="text-right">USD (BCV)</th>
                    <th className="text-center">Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(compras ?? []).map((c: any) => {
                    const prov = c.tercero_id ? tercerosMap[c.tercero_id] : null;
                    const base = Number(c.monto_base_bs) || Number(c.monto_bs) || 0;
                    const tb = Number(c.tasa_bcv) || bcvByFecha.get(c.fecha) || tasaPromedio;
                    const usdPar = tb ? base / tb : null;
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="py-1">{c.fecha ?? new Date(c.created_at).toISOString().slice(0,10)}</td>
                        <td>{prov?.razon_social ?? "—"}</td>
                        <td>{c.numero_factura ?? "—"}</td>
                        <td className="text-right mono">{fmtBs(Number(c.monto_bs))}</td>
                        <td className="text-right mono">{usdPar != null ? fmtUsd(usdPar) : "—"}</td>
                        <td className="text-center">{c.pagada ? <span className="text-green-700">Pagada</span> : <span className="text-orange-700">CxP</span>}</td>
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
                    <td className="text-right mono">{fmtUsd(totalComprasUsdBcv)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>

            </div>
          )}
          </>)}
        </div>

        {/* Cierre */}
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Inventario inicial USD</Label><Input type="number" step="0.01" value={invIniUsd} onChange={(e) => setInvIniUsd(e.target.value)} className="mono" /></div>
          <div><Label>Inventario final USD</Label><Input type="number" step="0.01" value={invFinUsd} onChange={(e) => setInvFinUsd(e.target.value)} className="mono" /></div>
          <div className="md:col-span-2 rounded-md bg-muted/50 p-3 flex justify-between text-sm">
            <span className="text-muted-foreground">Compras del mes (auto)</span>
            <span className="mono font-semibold">{fmtBs(totalCompras)} · {fmtUsd(totalComprasUsdBcv)}</span>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">Tasa BCV promedio del mes (auto)</div>
            <div className="text-base font-bold mono">{tasaPromedio ? tasaPromedio.toFixed(4) : "—"}</div>
            <div className="text-xs text-muted-foreground">{(tasasMes ?? []).length} tasa(s) registradas</div>
          </div>
          <div className="rounded-md bg-muted p-3 flex flex-col justify-center">
            <span className="text-xs text-muted-foreground">COGS estimado</span>
            <span className="text-base font-bold mono">{fmtUsd(cogsUsd)} · {fmtBs(cogs)}</span>
          </div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy || !!cierreActual}>{busy ? "Cerrando…" : cierreActual ? "Mes ya cerrado" : "Cerrar mes"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ---------------- LIQUIDACIONES ---------------- */
const LIQ_SECCIONES = [
  { key: "Cocina",         cuenta: "3.3",  centro: "Compartido" as Centro },
  { key: "Bocú",           cuenta: "3.7",  centro: "Bocu" as Centro },
  { key: "YV",             cuenta: "3.12", centro: "YV" as Centro },
  { key: "Administración", cuenta: "3.18", centro: "Compartido" as Centro },
] as const;

function LiquidacionesForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(todayISO());
  const [empleado, setEmpleado] = useState("");
  const [seccion, setSeccion] = useState<typeof LIQ_SECCIONES[number]["key"]>("Bocú");
  const [montoBs, setMontoBs] = useState("");
  const [tasa, setTasa] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);

  // Pull paralela directly from tasas_bcv.tasa_paralela (fallback to tasas_paralela); also BCV (referencia)
  const { data: bcvRow } = useQuery({
    queryKey: ["tasa-bcv-paralela-for", fecha],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasas_bcv")
        .select("fecha, tasa, tasa_paralela")
        .lte("fecha", fecha)
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  const { data: paralelaAlt } = useParalelaForDate(fecha);
  useEffect(() => {
    const t = (bcvRow as any)?.tasa_paralela ?? (paralelaAlt as any)?.tasa ?? null;
    if (t != null) setTasa(String(t));
  }, [(bcvRow as any)?.tasa_paralela, (paralelaAlt as any)?.tasa]);

  const seccionDef = LIQ_SECCIONES.find((s) => s.key === seccion)!;
  const montoBsN = Number(montoBs) || 0;
  const tasaN = Number(tasa) || 0; // paralela (input)
  const tasaBcvRefN = Number((bcvRow as any)?.tasa) || 0; // BCV referencia
  const montoUsd = tasaN > 0 ? montoBsN / tasaN : 0;
  const montoUsdBcv = tasaBcvRefN > 0 ? montoBsN / tasaBcvRefN : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!empleado.trim()) return toast.error("Falta nombre del empleado");
    if (!montoBsN) return toast.error("Falta monto en Bs");
    if (!tasaN) return toast.error("Falta tasa paralela");
    if (!cuentaBancariaId) return toast.error("Selecciona cuenta bancaria");
    setBusy(true);
    const detalle = `${seccionDef.key} · ${empleado.trim()}`;
    const notaCompleta = `Liquidación — ${empleado.trim()} — ${fecha}${notas ? ` · ${notas}` : ""}`;
    const { data: tx, error } = await supabase.from("transacciones").insert({
      fecha,
      cuenta_codigo: seccionDef.cuenta,
      centro_costo: seccionDef.centro as any,
      monto_bs: montoBsN,
      monto_base_bs: montoBsN,
      iva_bs: 0,
      iva_aplica: false,
      tasa_bcv: tasaBcvRefN || tasaN,
      tasa_paralela: tasaN,

      monto_usd: +montoUsd.toFixed(2),
      metodo_pago: "transferencia" as any,
      cuenta_bancaria_id: cuentaBancariaId,
      detalle,
      notas: notaCompleta,
      modo: "on_balance",
      created_by: user.id,
    } as any).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    if (tx) await logAudit("transacciones", "INSERT", tx.id, null, tx);
    setBusy(false);
    toast.success("Liquidación registrada");
    qc.invalidateQueries();
    setEmpleado(""); setMontoBs(""); setNotas("");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Liquidaciones</CardTitle></CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Las liquidaciones se registran siempre en bolívares y se convierten a USD con la tasa paralela del día. No afectan G&amp;P (solo Flujo de Caja).
        </p>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Fecha de liquidación</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div>
            <Label>Centro de costo</Label>
            <Select value={seccion} onValueChange={(v) => setSeccion(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIQ_SECCIONES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.key} (cuenta {s.cuenta})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><Label>Nombre del empleado</Label><Input value={empleado} onChange={(e) => setEmpleado(e.target.value)} required /></div>
          <div><Label>Monto total Bs</Label><Input type="number" step="0.01" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} required className="mono" /></div>
          <div>
            <Label>Tasa paralela del día</Label>
            <Input type="number" step="0.0001" value={tasa} onChange={(e) => setTasa(e.target.value)} required className="mono" />
          </div>
          <div className="md:col-span-2">
            <Label>Monto USD (calculado)</Label>
            <Input value={fmtUsd(montoUsd)} readOnly className="mono bg-muted" />
          </div>
          <div className="md:col-span-2">
            <BankAccountSelect value={cuentaBancariaId} onChange={setCuentaBancariaId} required />
          </div>
          <div className="md:col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <div className="md:col-span-2 rounded-md bg-muted p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">Cuenta: <span className="font-semibold mono">{seccionDef.cuenta}</span></span>
            <span className="text-lg font-bold mono">{fmtBs(montoBsN)} · {fmtUsd(montoUsd)}</span>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Registrar liquidación"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
