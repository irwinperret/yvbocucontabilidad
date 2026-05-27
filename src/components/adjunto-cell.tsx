import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Paperclip, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

const BUCKET = "facturas";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

interface Props {
  transaccionId: string;
  adjuntoPath: string | null;
  onChange: (newPath: string | null) => void;
  canDelete: boolean;
}

export function AdjuntoCell({ transaccionId, adjuntoPath, onChange, canDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error("El archivo supera los 5 MB");
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      toast.error("Formato no permitido (solo PDF, JPG, PNG, WEBP)");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      toast.error("Sesión no válida");
      return;
    }
    setBusy(true);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `${uid}/${transaccionId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
    if (upErr) {
      setBusy(false);
      toast.error(upErr.message);
      return;
    }
    // If there was a previous file, remove it
    if (adjuntoPath) {
      await supabase.storage.from(BUCKET).remove([adjuntoPath]);
    }
    const { error: dbErr } = await supabase
      .from("transacciones")
      .update({ adjunto_url: path } as any)
      .eq("id", transaccionId);
    setBusy(false);
    if (dbErr) {
      toast.error(dbErr.message);
      await supabase.storage.from(BUCKET).remove([path]);
      return;
    }
    toast.success("Adjunto cargado");
    onChange(path);
  };

  const view = async () => {
    if (!adjuntoPath) return;
    setBusy(true);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(adjuntoPath, 60);
    setBusy(false);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "No se pudo generar enlace");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async () => {
    if (!adjuntoPath) return;
    if (!confirm("¿Eliminar el adjunto?")) return;
    setBusy(true);
    await supabase.storage.from(BUCKET).remove([adjuntoPath]);
    const { error } = await supabase
      .from("transacciones")
      .update({ adjunto_url: null } as any)
      .eq("id", transaccionId);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Adjunto eliminado");
    onChange(null);
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      {adjuntoPath ? (
        <>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={view} disabled={busy} title="Ver factura">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 text-primary" />}
          </Button>
          {canDelete && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={remove} disabled={busy} title="Eliminar adjunto">
              <X className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </>
      ) : (
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onPick} disabled={busy} title="Adjuntar factura (PDF/imagen, max 5MB)">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
        </Button>
      )}
    </div>
  );
}
