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

old = """          <DialogFooter>
            <Button variant="ghost" onClick={() => setCierreAbierto(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={confirmarCierre} disabled={busy}>Confirmar cierre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}"""
new = """          <DialogFooter>
            <Button variant="ghost" onClick={() => setCierreAbierto(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={confirmarCierre} disabled={busy}>Confirmar cierre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!solventarMovAbierto} onOpenChange={(v) => { if (!v) setSolventarMovAbierto(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar movimiento como solventado manualmente</DialogTitle>
            <DialogDescription>
              Úsalo cuando se sabe que este movimiento (o parte de su monto) pagó una factura real que nunca se
              cargó al sistema. No crea ningún vínculo ni afecta G&amp;P ni flujo de caja -- solo deja de contarse
              como un pago sin cruzar. Si pones menos del total pendiente, el resto sigue viéndose como sin resolver.
            </DialogDescription>
          </DialogHeader>
          {solventarMovAbierto && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Monto a solventar (USD BCV)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={solventarMovForm.monto}
                  onChange={(e) => setSolventarMovForm({ ...solventarMovForm, monto: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Sin aplicar actualmente: {fmtUsd(resumenMov(solventarMovAbierto).sinAplicarUsd)} USD BCV.
                </p>
              </div>
              <div>
                <Label className="text-xs">Fecha</Label>
                <Input
                  type="date"
                  value={solventarMovForm.fecha}
                  onChange={(e) => setSolventarMovForm({ ...solventarMovForm, fecha: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Nota (qué factura pagó, por ejemplo)</Label>
                <Textarea
                  value={solventarMovForm.nota}
                  onChange={(e) => setSolventarMovForm({ ...solventarMovForm, nota: e.target.value })}
                  placeholder="Detalle adicional…"
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSolventarMovAbierto(null)} disabled={busy}>Cancelar</Button>
            <Button
              onClick={() => confirmarSolventarMov(resumenMov(solventarMovAbierto).sinAplicarUsd)}
              disabled={busy}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}"""
src = apply_once(src, old, new, "dialog solventar movimiento")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK dialog solventar mov")
