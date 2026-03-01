-- Storage bucket for optional per-unit GLB uploads.
-- Public read is required because app stores model_glb_url as public URL.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'unit-models',
  'unit-models',
  true,
  52428800,
  ARRAY['model/gltf-binary', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can read unit-models" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own unit-models" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own unit-models" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own unit-models" ON storage.objects;

CREATE POLICY "Public can read unit-models"
ON storage.objects FOR SELECT
USING (bucket_id = 'unit-models');

CREATE POLICY "Users can upload own unit-models"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'unit-models'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update own unit-models"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'unit-models'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'unit-models'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own unit-models"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'unit-models'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
