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

old = """                        ) : (
                          <Select
                            value={mv.tercero_id ?? "none"}
                            onValueChange={(v) => cambiarProveedorMov(mv.id, v === "none" ? null : v)}
                          >
                            <SelectTrigger className="w-44 h-7 text-[11px]"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sin proveedor</SelectItem>
                              {(terceros ?? []).map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.nombre_comercial || t.razon_social}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  </Zona>
                );"""
new = """                        ) : (
                          <Select
                            value={mv.tercero_id ?? "none"}
                            onValueChange={(v) => cambiarProveedorMov(mv.id, v === "none" ? null : v)}
                          >
                            <SelectTrigger className="w-44 h-7 text-[11px]"><SelectValue placeholder="Proveedor" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sin proveedor</SelectItem>
                              {(terceros ?? []).map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.nombre_comercial || t.razon_social}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {isAdmin && sinAplicarUsd > 0.01 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={() => abrirSolventarMov(mv, sinAplicarUsd)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Marcar como solventado
                          </Button>
                        )}
                      </div>
                      {movSolventadoInfo(mv) && (
                        <p className="text-[11px] text-[#534AB7] font-medium">{movSolventadoInfo(mv)}</p>
                      )}
                    </div>
                  </Zona>
                );"""
src = apply_once(src, old, new, "boton marcar como solventado en movsSinResolver")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK boton solventar mov")
