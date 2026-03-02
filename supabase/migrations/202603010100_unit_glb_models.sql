-- Per-unit, per-type GLB model storage.
-- Each unit can have up to 4 independent GLB models (one per UnitType).
-- Resolution order in app: glb_url (uploaded file) → external_glb_url (manual URL) → null.

CREATE TABLE IF NOT EXISTS public.unit_glb_models (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           UUID        NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_type         TEXT        NOT NULL CHECK (unit_type IN ('land', 'house', 'building', 'commercial')),
  glb_url           TEXT,       -- public URL of uploaded file (priority source)
  storage_path      TEXT,       -- Supabase storage path for the uploaded file
  external_glb_url  TEXT,       -- manual fallback URL
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_id, unit_type)
);

ALTER TABLE public.unit_glb_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own unit glb models"   ON public.unit_glb_models;
DROP POLICY IF EXISTS "Users can insert own unit glb models" ON public.unit_glb_models;
DROP POLICY IF EXISTS "Users can update own unit glb models" ON public.unit_glb_models;
DROP POLICY IF EXISTS "Users can delete own unit glb models" ON public.unit_glb_models;

CREATE POLICY "Users can view own unit glb models"
  ON public.unit_glb_models FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own unit glb models"
  ON public.unit_glb_models FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own unit glb models"
  ON public.unit_glb_models FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own unit glb models"
  ON public.unit_glb_models FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_unit_glb_models_unit ON public.unit_glb_models(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_glb_models_type ON public.unit_glb_models(unit_type);

DROP TRIGGER IF EXISTS unit_glb_models_updated_at ON public.unit_glb_models;
CREATE TRIGGER unit_glb_models_updated_at
  BEFORE UPDATE ON public.unit_glb_models
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

NOTIFY pgrst, 'reload schema';
