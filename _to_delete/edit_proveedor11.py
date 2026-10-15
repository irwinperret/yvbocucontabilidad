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

old = """                          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => deshacerCierre(c)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />Deshacer cierre manual
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>"""
new = """                          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => deshacerCierre(c)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />Deshacer cierre manual
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                  Movimientos solventados manualmente ({movsConSolventadoManual.length})
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Movimientos (o parte de su monto) que se sabe que pagaron una factura real nunca cargada al sistema.
                </p>
                {movsConSolventadoManual.length === 0 && (
                  <p className="text-xs text-muted-foreground">No hay movimientos solventados a mano.</p>
                )}
                {movsConSolventadoManual.map((mv) => (
                  <div key={mv.id} className="border rounded-md p-2.5 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs">
                        <span className="font-medium">{fmtDate(mv.fecha)}</span>{" "}
                        <span className="text-muted-foreground">{bancoDeReferencia(mv.referencia) || "banco"}</span>{" "}
                        <span className="mono">{fmtBs(Math.abs(Number(mv.monto_bs) || 0))}</span>{" "}
                        <span className="mono text-muted-foreground">{fmtUsd(usdBcvDeMov(mv))} USD BCV</span>
                      </div>
                      {isAdmin && (
                        <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => deshacerSolventadoMov(mv)}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />Deshacer
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-[#534AB7] font-medium">{movSolventadoInfo(mv)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>"""
src = apply_once(src, old, new, "seccion movimientos solventados manualmente")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK seccion solventados")
