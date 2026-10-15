import sys
path = "src/routes/_authenticated/proveedores/$id.tsx"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

old = """  const abrirCierre = (lista: any[]) => {
    if (!lista.length) return;
    setCierreForm({ nota: "", fecha: new Date().toISOString().slice(0, 10) });
    setCierreAbierto(lista);
  };

  const confirmarCierre = async () => {
    if (!cierreAbierto?.length) return;
    setBusy(true);
    try {
      for (const c of cierreAbierto) {
        const r = await cerrarCxpSinMovimiento({
          cxp: c,
          nota: cierreForm.nota.trim() || null,
          fecha: cierreForm.fecha,
          userId: user?.id ?? null,
        });
        if (!r.ok) throw new Error(r.error);
      }
      toast.success(
        cierreAbierto.length === 1
          ? "Factura marcada como pagada sin movimiento"
          : `${cierreAbierto.length} facturas marcadas como pagadas sin movimiento`,
      );
      setCierreAbierto(null);
      setSelCierre([]);
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cerrar la factura");
    } finally {
      setBusy(false);
    }
  };

  const deshacerCierre = async (c: any) => {
    setBusy(true);
    try {
      const r = await reabrirCxpCerradaManual(c);
      if (!r.ok) throw new Error(r.error);
      toast.success("Cierre manual deshecho — la factura vuelve a estar pendiente");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo deshacer el cierre");
    } finally {
      setBusy(false);
    }
  };"""
new = """  const abrirCierre = (lista: any[]) => {
    if (!lista.length) return;
    const montoDefault = lista.length === 1 ? String(pendienteUsdBcv(lista[0])) : "";
    setCierreForm({ nota: "", fecha: new Date().toISOString().slice(0, 10), monto: montoDefault });
    setCierreAbierto(lista);
  };

  const confirmarCierre = async () => {
    if (!cierreAbierto?.length) return;
    // El monto editable solo aplica cuando se cierra UNA factura a la vez --
    // para un cierre en lote siempre es total, como era antes.
    const montoUsd =
      cierreAbierto.length === 1 && cierreForm.monto.trim() !== ""
        ? Number(cierreForm.monto)
        : undefined;
    const esParcial =
      montoUsd != null && Number.isFinite(montoUsd) && montoUsd > 0.01 &&
      montoUsd < pendienteUsdBcv(cierreAbierto[0]) - 0.01;
    setBusy(true);
    try {
      for (const c of cierreAbierto) {
        const r = await cerrarCxpSinMovimiento({
          cxp: c,
          nota: cierreForm.nota.trim() || null,
          fecha: cierreForm.fecha,
          userId: user?.id ?? null,
          montoUsd,
        });
        if (!r.ok) throw new Error(r.error);
      }
      toast.success(
        esParcial
          ? `Solventado ${fmtUsd(montoUsd!)} USD BCV de la factura — el resto sigue pendiente`
          : cierreAbierto.length === 1
            ? "Factura marcada como pagada sin movimiento"
            : `${cierreAbierto.length} facturas marcadas como pagadas sin movimiento`,
      );
      setCierreAbierto(null);
      setSelCierre([]);
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cerrar la factura");
    } finally {
      setBusy(false);
    }
  };

  const deshacerCierre = async (c: any) => {
    setBusy(true);
    try {
      const r = await reabrirCxpCerradaManual(c);
      if (!r.ok) throw new Error(r.error);
      toast.success("Cierre manual deshecho — la factura vuelve a estar pendiente");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo deshacer el cierre");
    } finally {
      setBusy(false);
    }
  };

  const deshacerSolventadoParcial = async (c: any) => {
    setBusy(true);
    try {
      const r = await quitarSolventadoParcialCxp(c);
      if (!r.ok) throw new Error(r.error);
      toast.success("Solventado manual deshecho — el monto vuelve a estar pendiente");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo deshacer");
    } finally {
      setBusy(false);
    }
  };

  const abrirSolventarMov = (mv: any, maxUsd: number) => {
    setSolventarMovForm({ nota: "", fecha: new Date().toISOString().slice(0, 10), monto: String(maxUsd) });
    setSolventarMovAbierto(mv);
  };

  const confirmarSolventarMov = async (maxUsd: number) => {
    if (!solventarMovAbierto) return;
    const montoUsd = Number(solventarMovForm.monto);
    if (!Number.isFinite(montoUsd) || montoUsd <= 0) {
      toast.error("Ingresa un monto válido");
      return;
    }
    setBusy(true);
    try {
      const r = await marcarMovimientoSolventadoManual({
        mov: solventarMovAbierto,
        montoUsd,
        maxUsd,
        nota: solventarMovForm.nota.trim() || null,
        fecha: solventarMovForm.fecha,
        userId: user?.id ?? null,
      });
      if (!r.ok) throw new Error(r.error);
      toast.success("Movimiento marcado como solventado manualmente");
      setSolventarMovAbierto(null);
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo marcar el movimiento");
    } finally {
      setBusy(false);
    }
  };

  const deshacerSolventadoMov = async (mv: any) => {
    setBusy(true);
    try {
      const r = await quitarSolventadoManualMovimiento(mv);
      if (!r.ok) throw new Error(r.error);
      toast.success("Solventado manual del movimiento deshecho");
      await refrescar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo deshacer");
    } finally {
      setBusy(false);
    }
  };"""
src = apply_once(src, old, new, "handlers cierre + solventado")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK handlers")
