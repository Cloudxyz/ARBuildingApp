-- Allow both uploaded file URL and manual fallback URL per unit type.
-- Resolution order in app: uploaded file URL -> manual fallback URL.

ALTER TABLE public.unit_type_models
  ADD COLUMN IF NOT EXISTS external_model_glb_url TEXT;

ALTER TABLE public.unit_type_models
  ALTER COLUMN model_glb_url DROP NOT NULL;

ALTER TABLE public.unit_type_models
  ALTER COLUMN storage_path DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
