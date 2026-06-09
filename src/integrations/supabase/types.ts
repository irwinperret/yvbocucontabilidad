export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ajustes_bancarios: {
        Row: {
          created_at: string
          cuenta_bancaria_id: string
          fecha: string
          id: string
          monto: number
          notas: string | null
          registrado_por: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          cuenta_bancaria_id: string
          fecha?: string
          id?: string
          monto: number
          notas?: string | null
          registrado_por?: string | null
          tipo: string
        }
        Update: {
          created_at?: string
          cuenta_bancaria_id?: string
          fecha?: string
          id?: string
          monto?: number
          notas?: string | null
          registrado_por?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ajustes_bancarios_cuenta_bancaria_id_fkey"
            columns: ["cuenta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "cuentas_bancarias"
            referencedColumns: ["id"]
          },
        ]
      }
      auditoria: {
        Row: {
          accion: string
          created_at: string
          datos: Json | null
          datos_antes: Json | null
          datos_despues: Json | null
          id: string
          registro_id: string | null
          tabla: string
          user_id: string | null
        }
        Insert: {
          accion: string
          created_at?: string
          datos?: Json | null
          datos_antes?: Json | null
          datos_despues?: Json | null
          id?: string
          registro_id?: string | null
          tabla: string
          user_id?: string | null
        }
        Update: {
          accion?: string
          created_at?: string
          datos?: Json | null
          datos_antes?: Json | null
          datos_despues?: Json | null
          id?: string
          registro_id?: string | null
          tabla?: string
          user_id?: string | null
        }
        Relationships: []
      }
      cierres_de_mes: {
        Row: {
          cogs_bs: number
          cogs_usd: number
          compras_mes_bs: number
          created_at: string
          depreciacion_bs: number
          estado: string
          id: string
          inventario_final_bs: number
          inventario_inicial_bs: number
          notas: string | null
          pasivos_laborales_bs: number
          periodo: string
          registrado_por: string | null
          tasa_bcv_promedio: number
        }
        Insert: {
          cogs_bs: number
          cogs_usd: number
          compras_mes_bs: number
          created_at?: string
          depreciacion_bs?: number
          estado?: string
          id?: string
          inventario_final_bs: number
          inventario_inicial_bs: number
          notas?: string | null
          pasivos_laborales_bs?: number
          periodo: string
          registrado_por?: string | null
          tasa_bcv_promedio: number
        }
        Update: {
          cogs_bs?: number
          cogs_usd?: number
          compras_mes_bs?: number
          created_at?: string
          depreciacion_bs?: number
          estado?: string
          id?: string
          inventario_final_bs?: number
          inventario_inicial_bs?: number
          notas?: string | null
          pasivos_laborales_bs?: number
          periodo?: string
          registrado_por?: string | null
          tasa_bcv_promedio?: number
        }
        Relationships: []
      }
      cuentas_bancarias: {
        Row: {
          activa: boolean
          banco: string
          created_at: string
          id: string
          moneda: string
          nombre: string
          numero: string
          saldo_inicial: number
          saldo_inicial_fecha: string | null
          titular: string
          updated_at: string
        }
        Insert: {
          activa?: boolean
          banco: string
          created_at?: string
          id?: string
          moneda?: string
          nombre: string
          numero: string
          saldo_inicial?: number
          saldo_inicial_fecha?: string | null
          titular: string
          updated_at?: string
        }
        Update: {
          activa?: boolean
          banco?: string
          created_at?: string
          id?: string
          moneda?: string
          nombre?: string
          numero?: string
          saldo_inicial?: number
          saldo_inicial_fecha?: string | null
          titular?: string
          updated_at?: string
        }
        Relationships: []
      }
      cuentas_por_cobrar: {
        Row: {
          centro_costo: Database["public"]["Enums"]["centro_costo"]
          cliente: string
          cobrada_at: string | null
          created_at: string
          estado: string
          fecha_vencimiento: string | null
          id: string
          monto_bs: number
          monto_pendiente_bs: number | null
          monto_pendiente_usd: number | null
          monto_usd: number
          transaccion_cobro_id: string | null
          transaccion_id: string | null
        }
        Insert: {
          centro_costo: Database["public"]["Enums"]["centro_costo"]
          cliente: string
          cobrada_at?: string | null
          created_at?: string
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          monto_bs: number
          monto_pendiente_bs?: number | null
          monto_pendiente_usd?: number | null
          monto_usd: number
          transaccion_cobro_id?: string | null
          transaccion_id?: string | null
        }
        Update: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"]
          cliente?: string
          cobrada_at?: string | null
          created_at?: string
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          monto_bs?: number
          monto_pendiente_bs?: number | null
          monto_pendiente_usd?: number | null
          monto_usd?: number
          transaccion_cobro_id?: string | null
          transaccion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_por_cobrar_transaccion_cobro_id_fkey"
            columns: ["transaccion_cobro_id"]
            isOneToOne: false
            referencedRelation: "transacciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_por_cobrar_transaccion_cobro_id_fkey"
            columns: ["transaccion_cobro_id"]
            isOneToOne: false
            referencedRelation: "v_off_balance_pendientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_por_cobrar_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "transacciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_por_cobrar_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "v_off_balance_pendientes"
            referencedColumns: ["id"]
          },
        ]
      }
      cuentas_por_pagar: {
        Row: {
          centro_costo: Database["public"]["Enums"]["centro_costo"] | null
          created_at: string
          estado: string
          fecha_vencimiento: string | null
          id: string
          monto_bs: number
          monto_pendiente_bs: number | null
          monto_usd: number
          numero_factura: string | null
          pagada_at: string | null
          proveedor: string | null
          tercero_id: string | null
          transaccion_id: string | null
        }
        Insert: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          created_at?: string
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          monto_bs: number
          monto_pendiente_bs?: number | null
          monto_usd: number
          numero_factura?: string | null
          pagada_at?: string | null
          proveedor?: string | null
          tercero_id?: string | null
          transaccion_id?: string | null
        }
        Update: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          created_at?: string
          estado?: string
          fecha_vencimiento?: string | null
          id?: string
          monto_bs?: number
          monto_pendiente_bs?: number | null
          monto_usd?: number
          numero_factura?: string | null
          pagada_at?: string | null
          proveedor?: string | null
          tercero_id?: string | null
          transaccion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_por_pagar_tercero_id_fkey"
            columns: ["tercero_id"]
            isOneToOne: false
            referencedRelation: "terceros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_por_pagar_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "transacciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_por_pagar_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "v_off_balance_pendientes"
            referencedColumns: ["id"]
          },
        ]
      }
      inventario_snapshots: {
        Row: {
          created_at: string
          cuenta_bancaria_id: string | null
          cxp_id: string | null
          fecha: string | null
          fecha_vencimiento: string | null
          id: string
          iva_aplica: boolean
          iva_bs: number
          modo: Database["public"]["Enums"]["modo_transaccion"]
          monto_base_bs: number
          monto_bs: number
          notas: string | null
          numero_factura: string | null
          pagada: boolean
          periodo: string
          registrado_por: string | null
          tasa_bcv: number | null
          tercero_id: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          cuenta_bancaria_id?: string | null
          cxp_id?: string | null
          fecha?: string | null
          fecha_vencimiento?: string | null
          id?: string
          iva_aplica?: boolean
          iva_bs?: number
          modo?: Database["public"]["Enums"]["modo_transaccion"]
          monto_base_bs?: number
          monto_bs: number
          notas?: string | null
          numero_factura?: string | null
          pagada?: boolean
          periodo: string
          registrado_por?: string | null
          tasa_bcv?: number | null
          tercero_id?: string | null
          tipo: string
        }
        Update: {
          created_at?: string
          cuenta_bancaria_id?: string | null
          cxp_id?: string | null
          fecha?: string | null
          fecha_vencimiento?: string | null
          id?: string
          iva_aplica?: boolean
          iva_bs?: number
          modo?: Database["public"]["Enums"]["modo_transaccion"]
          monto_base_bs?: number
          monto_bs?: number
          notas?: string | null
          numero_factura?: string | null
          pagada?: boolean
          periodo?: string
          registrado_por?: string | null
          tasa_bcv?: number | null
          tercero_id?: string | null
          tipo?: string
        }
        Relationships: []
      }
      plan_de_cuentas: {
        Row: {
          activa: boolean
          afecta_fc: boolean
          afecta_gyp: boolean
          centros_permitidos:
            | Database["public"]["Enums"]["centro_costo"][]
            | null
          codigo: string
          grupo: string
          nombre: string
          orden: number
        }
        Insert: {
          activa?: boolean
          afecta_fc?: boolean
          afecta_gyp?: boolean
          centros_permitidos?:
            | Database["public"]["Enums"]["centro_costo"][]
            | null
          codigo: string
          grupo: string
          nombre: string
          orden?: number
        }
        Update: {
          activa?: boolean
          afecta_fc?: boolean
          afecta_gyp?: boolean
          centros_permitidos?:
            | Database["public"]["Enums"]["centro_costo"][]
            | null
          codigo?: string
          grupo?: string
          nombre?: string
          orden?: number
        }
        Relationships: []
      }
      prestamos: {
        Row: {
          created_at: string
          estado: string
          id: string
          monto_bs: number
          monto_usd: number
          plazo_meses: number
          prestamista: string
          saldo_bs: number
          transaccion_id: string | null
        }
        Insert: {
          created_at?: string
          estado?: string
          id?: string
          monto_bs: number
          monto_usd: number
          plazo_meses: number
          prestamista: string
          saldo_bs: number
          transaccion_id?: string | null
        }
        Update: {
          created_at?: string
          estado?: string
          id?: string
          monto_bs?: number
          monto_usd?: number
          plazo_meses?: number
          prestamista?: string
          saldo_bs?: number
          transaccion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prestamos_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "transacciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prestamos_transaccion_id_fkey"
            columns: ["transaccion_id"]
            isOneToOne: false
            referencedRelation: "v_off_balance_pendientes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nombre: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          nombre?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nombre?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tasas_bcv: {
        Row: {
          created_at: string
          fecha: string
          id: string
          registrado_por: string | null
          tasa: number
        }
        Insert: {
          created_at?: string
          fecha: string
          id?: string
          registrado_por?: string | null
          tasa: number
        }
        Update: {
          created_at?: string
          fecha?: string
          id?: string
          registrado_por?: string | null
          tasa?: number
        }
        Relationships: []
      }
      tasas_paralela: {
        Row: {
          created_at: string
          fecha: string
          id: string
          registrado_por: string | null
          tasa: number
        }
        Insert: {
          created_at?: string
          fecha: string
          id?: string
          registrado_por?: string | null
          tasa: number
        }
        Update: {
          created_at?: string
          fecha?: string
          id?: string
          registrado_por?: string | null
          tasa?: number
        }
        Relationships: []
      }
      terceros: {
        Row: {
          created_at: string
          direccion_fiscal: string | null
          email: string | null
          id: string
          nombre_comercial: string | null
          razon_social: string
          rif: string
          telefono: string | null
          tipo: Database["public"]["Enums"]["tipo_tercero"]
          tipo_rif: Database["public"]["Enums"]["tipo_rif"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          direccion_fiscal?: string | null
          email?: string | null
          id?: string
          nombre_comercial?: string | null
          razon_social: string
          rif: string
          telefono?: string | null
          tipo?: Database["public"]["Enums"]["tipo_tercero"]
          tipo_rif: Database["public"]["Enums"]["tipo_rif"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          direccion_fiscal?: string | null
          email?: string | null
          id?: string
          nombre_comercial?: string | null
          razon_social?: string
          rif?: string
          telefono?: string | null
          tipo?: Database["public"]["Enums"]["tipo_tercero"]
          tipo_rif?: Database["public"]["Enums"]["tipo_rif"]
          updated_at?: string
        }
        Relationships: []
      }
      transacciones: {
        Row: {
          adjunto_url: string | null
          centro_costo: Database["public"]["Enums"]["centro_costo"]
          created_at: string
          created_by: string
          cuenta_bancaria_id: string | null
          cuenta_codigo: string
          detalle: string | null
          fecha: string
          id: string
          iva_aplica: boolean
          iva_bs: number
          marcada_error: boolean
          metodo_pago: Database["public"]["Enums"]["metodo_pago"] | null
          modo: Database["public"]["Enums"]["modo_transaccion"]
          monto_base_bs: number
          monto_bs: number
          monto_usd: number
          notas: string | null
          numero_factura: string | null
          numero_orden: string | null
          pareja_off_balance_id: string | null
          referencia: string | null
          tasa_bcv: number
          tasa_paralela: number | null
          tercero_id: string | null
          tipo_iva: string | null
        }
        Insert: {
          adjunto_url?: string | null
          centro_costo: Database["public"]["Enums"]["centro_costo"]
          created_at?: string
          created_by: string
          cuenta_bancaria_id?: string | null
          cuenta_codigo: string
          detalle?: string | null
          fecha?: string
          id?: string
          iva_aplica?: boolean
          iva_bs?: number
          marcada_error?: boolean
          metodo_pago?: Database["public"]["Enums"]["metodo_pago"] | null
          modo?: Database["public"]["Enums"]["modo_transaccion"]
          monto_base_bs?: number
          monto_bs: number
          monto_usd: number
          notas?: string | null
          numero_factura?: string | null
          numero_orden?: string | null
          pareja_off_balance_id?: string | null
          referencia?: string | null
          tasa_bcv: number
          tasa_paralela?: number | null
          tercero_id?: string | null
          tipo_iva?: string | null
        }
        Update: {
          adjunto_url?: string | null
          centro_costo?: Database["public"]["Enums"]["centro_costo"]
          created_at?: string
          created_by?: string
          cuenta_bancaria_id?: string | null
          cuenta_codigo?: string
          detalle?: string | null
          fecha?: string
          id?: string
          iva_aplica?: boolean
          iva_bs?: number
          marcada_error?: boolean
          metodo_pago?: Database["public"]["Enums"]["metodo_pago"] | null
          modo?: Database["public"]["Enums"]["modo_transaccion"]
          monto_base_bs?: number
          monto_bs?: number
          monto_usd?: number
          notas?: string | null
          numero_factura?: string | null
          numero_orden?: string | null
          pareja_off_balance_id?: string | null
          referencia?: string | null
          tasa_bcv?: number
          tasa_paralela?: number | null
          tercero_id?: string | null
          tipo_iva?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacciones_cuenta_bancaria_id_fkey"
            columns: ["cuenta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "cuentas_bancarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "plan_de_cuentas"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "v_fc_mes_actual"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "v_gyp_mes_actual"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transacciones_pareja_off_balance_id_fkey"
            columns: ["pareja_off_balance_id"]
            isOneToOne: false
            referencedRelation: "transacciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacciones_pareja_off_balance_id_fkey"
            columns: ["pareja_off_balance_id"]
            isOneToOne: false
            referencedRelation: "v_off_balance_pendientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacciones_tercero_id_fkey"
            columns: ["tercero_id"]
            isOneToOne: false
            referencedRelation: "terceros"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      xetux_payment_map: {
        Row: {
          created_at: string
          cuenta_bancaria_id: string | null
          forma_pago: string
          metodo_pago: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cuenta_bancaria_id?: string | null
          forma_pago: string
          metodo_pago?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cuenta_bancaria_id?: string | null
          forma_pago?: string
          metodo_pago?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "xetux_payment_map_cuenta_bancaria_id_fkey"
            columns: ["cuenta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "cuentas_bancarias"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_cxc_activas: {
        Row: {
          centro_costo: Database["public"]["Enums"]["centro_costo"] | null
          cliente: string | null
          created_at: string | null
          estado: string | null
          fecha_vencimiento: string | null
          id: string | null
          monto_bs: number | null
          monto_usd: number | null
          urgencia: string | null
        }
        Insert: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          cliente?: string | null
          created_at?: string | null
          estado?: string | null
          fecha_vencimiento?: string | null
          id?: string | null
          monto_bs?: number | null
          monto_usd?: number | null
          urgencia?: never
        }
        Update: {
          centro_costo?: Database["public"]["Enums"]["centro_costo"] | null
          cliente?: string | null
          created_at?: string | null
          estado?: string | null
          fecha_vencimiento?: string | null
          id?: string | null
          monto_bs?: number | null
          monto_usd?: number | null
          urgencia?: never
        }
        Relationships: []
      }
      v_fc_mes_actual: {
        Row: {
          centro_costo: Database["public"]["Enums"]["centro_costo"] | null
          codigo: string | null
          grupo: string | null
          nombre: string | null
          total_bs: number | null
          total_usd: number | null
        }
        Relationships: []
      }
      v_gyp_mes_actual: {
        Row: {
          centro_costo: Database["public"]["Enums"]["centro_costo"] | null
          codigo: string | null
          grupo: string | null
          nombre: string | null
          num_movimientos: number | null
          total_bs: number | null
          total_usd: number | null
        }
        Relationships: []
      }
      v_iva_mensual: {
        Row: {
          iva_bs: number | null
          iva_usd: number | null
          movimientos: number | null
          periodo: string | null
          tipo_iva: string | null
        }
        Relationships: []
      }
      v_off_balance_pendientes: {
        Row: {
          centro_costo: Database["public"]["Enums"]["centro_costo"] | null
          cuenta_codigo: string | null
          cuenta_nombre: string | null
          dias_pendientes: number | null
          fecha: string | null
          id: string | null
          monto_bs: number | null
          monto_usd: number | null
          urgencia: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "plan_de_cuentas"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "v_fc_mes_actual"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "v_gyp_mes_actual"
            referencedColumns: ["codigo"]
          },
        ]
      }
      v_transacciones_mensual: {
        Row: {
          anio: number | null
          base_bs: number | null
          base_usd: number | null
          centro_costo: Database["public"]["Enums"]["centro_costo"] | null
          cuenta_codigo: string | null
          iva_bs: number | null
          mes: number | null
          modo: Database["public"]["Enums"]["modo_transaccion"] | null
          movimientos: number | null
          periodo: string | null
          total_bs: number | null
          total_usd: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "plan_de_cuentas"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "v_fc_mes_actual"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transacciones_cuenta_codigo_fkey"
            columns: ["cuenta_codigo"]
            isOneToOne: false
            referencedRelation: "v_gyp_mes_actual"
            referencedColumns: ["codigo"]
          },
        ]
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      periodo_cerrado: { Args: { _fecha: string }; Returns: boolean }
      registrar_auditoria: {
        Args: {
          _accion: string
          _antes: Json
          _despues: Json
          _registro_id: string
          _tabla: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "contador" | "usuario"
      centro_costo: "YV" | "Bocu" | "Compartido"
      metodo_pago:
        | "tarjeta"
        | "transferencia"
        | "pago_movil"
        | "zelle"
        | "efectivo_usd"
        | "efectivo_bs"
        | "pendiente"
      modo_transaccion: "on_balance" | "off_balance"
      tipo_rif: "J" | "V" | "E" | "G"
      tipo_tercero: "cliente" | "proveedor" | "ambos"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "contador", "usuario"],
      centro_costo: ["YV", "Bocu", "Compartido"],
      metodo_pago: [
        "tarjeta",
        "transferencia",
        "pago_movil",
        "zelle",
        "efectivo_usd",
        "efectivo_bs",
        "pendiente",
      ],
      modo_transaccion: ["on_balance", "off_balance"],
      tipo_rif: ["J", "V", "E", "G"],
      tipo_tercero: ["cliente", "proveedor", "ambos"],
    },
  },
} as const
