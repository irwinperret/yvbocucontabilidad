import { toast } from "sonner";

/**
 * Muestra un toast de éxito con un botón "Deshacer" visible por 30 segundos.
 * `deshacer` debe revertir el cambio ya aplicado, normalmente restaurando
 * una copia de los datos capturada ANTES de ejecutar la acción original.
 */
export function toastConDeshacer(
  mensaje: string,
  deshacer: () => void | Promise<void>,
  opts?: { mensajeDeshecho?: string },
) {
  toast.success(mensaje, {
    duration: 30000,
    action: {
      label: "Deshacer",
      onClick: async () => {
        try {
          await deshacer();
          toast.success(opts?.mensajeDeshecho ?? "Acción deshecha");
        } catch (e: any) {
          toast.error(e?.message ?? "No se pudo deshacer");
        }
      },
    },
  });
}
