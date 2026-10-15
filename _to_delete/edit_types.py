import sys
path = "src/integrations/supabase/types.ts"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

def apply_once(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (expected 1)")
        sys.exit(1)
    return src.replace(old, new)

# cuentas_por_pagar: Row / Insert / Update each have a cierre_manual_por block.
old_row = """          cierre_manual_por: string | null
          created_at: string
          en_espera_en: string | null
          en_espera_movimiento: boolean
          en_espera_por: string | null
          estado: string
          fecha_vencimiento: string | null
          id: string
          import_batch_id: string | null
          monto_bs: number
          monto_pendiente_bs: number | null
          monto_pendiente_usd_bcv: number | null
          monto_usd: number
          numero_factura: string | null
          origen: string
          pagada_at: string | null
          proveedor: string | null
          revert_batch_id: string | null
          revert_estado_anterior: string | null
          revert_pagada_at_anterior: string | null
          revert_pendiente_bs_anterior: number | null
          revert_pendiente_usd_bcv_anterior: number | null
          tasa_bcv_factura: number | null
          tasa_paralela_factura: number | null
          tercero_id: string | null
          transaccion_id: string | null
          usd_bcv_factura: number | null
          usd_paralelo_factura: number | null
        }
        Insert: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          cierre_manual?: boolean
          cierre_manual_at?: string | null
          cierre_manual_fecha?: string | null
          cierre_manual_motivo?: string | null
          cierre_manual_nota?: string | null
          cierre_manual_por?: string | null
          created_at?: string
          en_espera_en?: string | null
          en_espera_movimiento?: boolean
          en_espera_por?: string | null
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          import_batch_id?: string | null
          monto_bs: number
          monto_pendiente_bs?: number | null
          monto_pendiente_usd_bcv?: number | null
          monto_usd: number
          numero_factura?: string | null
          origen?: string
          pagada_at?: string | null
          proveedor?: string | null
          revert_batch_id?: string | null
          revert_estado_anterior?: string | null
          revert_pagada_at_anterior?: string | null
          revert_pendiente_bs_anterior?: number | null
          revert_pendiente_usd_bcv_anterior?: number | null
          tasa_bcv_factura?: number | null
          tasa_paralela_factura?: number | null
          tercero_id?: string | null
          transaccion_id?: string | null
          usd_bcv_factura?: number | null
          usd_paralelo_factura?: number | null
        }
        Update: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          cierre_manual?: boolean
          cierre_manual_at?: string | null
          cierre_manual_fecha?: string | null
          cierre_manual_motivo?: string | null
          cierre_manual_nota?: string | null
          cierre_manual_por?: string | null
          created_at?: string
          en_espera_en?: string | null
          en_espera_movimiento?: boolean
          en_espera_por?: string | null
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          import_batch_id?: string | null
          monto_bs?: number"""

new_row = """          cierre_manual_por: string | null
          created_at: string
          en_espera_en: string | null
          en_espera_movimiento: boolean
          en_espera_por: string | null
          estado: string
          fecha_vencimiento: string | null
          id: string
          import_batch_id: string | null
          monto_bs: number
          monto_pendiente_bs: number | null
          monto_pendiente_usd_bcv: number | null
          monto_solventado_manual_usd: number
          monto_usd: number
          numero_factura: string | null
          origen: string
          pagada_at: string | null
          proveedor: string | null
          revert_batch_id: string | null
          revert_estado_anterior: string | null
          revert_pagada_at_anterior: string | null
          revert_pendiente_bs_anterior: number | null
          revert_pendiente_usd_bcv_anterior: number | null
          solventado_manual_at: string | null
          solventado_manual_fecha: string | null
          solventado_manual_nota: string | null
          solventado_manual_por: string | null
          tasa_bcv_factura: number | null
          tasa_paralela_factura: number | null
          tercero_id: string | null
          transaccion_id: string | null
          usd_bcv_factura: number | null
          usd_paralelo_factura: number | null
        }
        Insert: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          cierre_manual?: boolean
          cierre_manual_at?: string | null
          cierre_manual_fecha?: string | null
          cierre_manual_motivo?: string | null
          cierre_manual_nota?: string | null
          cierre_manual_por?: string | null
          created_at?: string
          en_espera_en?: string | null
          en_espera_movimiento?: boolean
          en_espera_por?: string | null
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          import_batch_id?: string | null
          monto_bs: number
          monto_pendiente_bs?: number | null
          monto_pendiente_usd_bcv?: number | null
          monto_solventado_manual_usd?: number
          monto_usd: number
          numero_factura?: string | null
          origen?: string
          pagada_at?: string | null
          proveedor?: string | null
          revert_batch_id?: string | null
          revert_estado_anterior?: string | null
          revert_pagada_at_anterior?: string | null
          revert_pendiente_bs_anterior?: number | null
          revert_pendiente_usd_bcv_anterior?: number | null
          solventado_manual_at?: string | null
          solventado_manual_fecha?: string | null
          solventado_manual_nota?: string | null
          solventado_manual_por?: string | null
          tasa_bcv_factura?: number | null
          tasa_paralela_factura?: number | null
          tercero_id?: string | null
          transaccion_id?: string | null
          usd_bcv_factura?: number | null
          usd_paralelo_factura?: number | null
        }
        Update: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          cierre_manual?: boolean
          cierre_manual_at?: string | null
          cierre_manual_fecha?: string | null
          cierre_manual_motivo?: string | null
          cierre_manual_nota?: string | null
          cierre_manual_por?: string | null
          created_at?: string
          en_espera_en?: string | null
          en_espera_movimiento?: boolean
          en_espera_por?: string | null
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          import_batch_id?: string | null
          monto_bs?: number"""

src = apply_once(src, old_row, new_row, "cuentas_por_pagar Row/Insert/Update header")

# The Update block tail for cuentas_por_pagar continues after monto_bs?: number
# with monto_pendiente_bs?: number | null etc. Need to add fields there too.
old_update_tail = """          monto_bs?: number
          monto_pendiente_bs?: number | null
          monto_pendiente_usd_bcv?: number | null
          monto_usd?: number
          numero_factura?: string | null
          origen?: string
          pagada_at?: string | null
          proveedor?: string | null
          revert_batch_id?: string | null
          revert_estado_anterior?: string | null
          revert_pagada_at_anterior?: string | null
          revert_pendiente_bs_anterior?: number | null
          revert_pendiente_usd_bcv_anterior?: number | null
          tasa_bcv_factura?: number | null
          tasa_paralela_factura?: number | null
          tercero_id?: string | null
          transaccion_id?: string | null
          usd_bcv_factura?: number | null
          usd_paralelo_factura?: number | null
        }
        Relationships: ["""
new_update_tail = """          monto_bs?: number
          monto_pendiente_bs?: number | null
          monto_pendiente_usd_bcv?: number | null
          monto_solventado_manual_usd?: number
          monto_usd?: number
          numero_factura?: string | null
          origen?: string
          pagada_at?: string | null
          proveedor?: string | null
          revert_batch_id?: string | null
          revert_estado_anterior?: string | null
          revert_pagada_at_anterior?: string | null
          revert_pendiente_bs_anterior?: number | null
          revert_pendiente_usd_bcv_anterior?: number | null
          solventado_manual_at?: string | null
          solventado_manual_fecha?: string | null
          solventado_manual_nota?: string | null
          solventado_manual_por?: string | null
          tasa_bcv_factura?: number | null
          tasa_paralela_factura?: number | null
          tercero_id?: string | null
          transaccion_id?: string | null
          usd_bcv_factura?: number | null
          usd_paralelo_factura?: number | null
        }
        Relationships: ["""
src = apply_once(src, old_update_tail, new_update_tail, "cuentas_por_pagar Update tail")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK cuentas_por_pagar")
