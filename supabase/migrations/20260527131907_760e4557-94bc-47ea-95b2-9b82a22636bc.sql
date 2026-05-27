
-- Add adjunto_url column to transacciones
ALTER TABLE public.transacciones ADD COLUMN IF NOT EXISTS adjunto_url text;

-- Create private storage bucket for invoice attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('facturas', 'facturas', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies on storage.objects for the 'facturas' bucket
CREATE POLICY "facturas_select_authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'facturas');

CREATE POLICY "facturas_insert_authenticated"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'facturas' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "facturas_update_owner_or_admin"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'facturas' AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

CREATE POLICY "facturas_delete_owner_or_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'facturas' AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);
