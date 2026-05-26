import { supabase } from "@/integrations/supabase/client";

export async function logAudit(
  tabla: string,
  accion: "INSERT" | "UPDATE" | "DELETE" | "MIGRATE",
  registroId: string,
  antes: any,
  despues: any
) {
  await supabase.rpc("registrar_auditoria", {
    _tabla: tabla,
    _accion: accion,
    _registro_id: registroId,
    _antes: antes,
    _despues: despues,
  });
}

export async function isPeriodClosed(fecha: string): Promise<boolean> {
  const { data } = await supabase.rpc("periodo_cerrado", { _fecha: fecha });
  return !!data;
}
