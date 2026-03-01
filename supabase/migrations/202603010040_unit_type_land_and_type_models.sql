-- Finalize unit type taxonomy and add per-type model table.

-- 1) Replace old "other" type with "land".
ALTER TABLE public.units
DROP CONSTRAINT IF EXISTS units_unit_type_check;

UPDATE public.units
SET unit_type = 'land'
WHERE unit_type = 'other';

ALTER TABLE public.units
ADD CONSTRAINT units_unit_type_check
CHECK (unit_type IN ('land', 'house', 'building', 'commercial'));

ALTER TABLE public.units
ALTER COLUMN unit_type SET DEFAULT 'land';

-- 2) Per-user model by unit type (house/building/commercial).
CREATE TABLE IF NOT EXISTS public.unit_type_models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_type     TEXT NOT NULL CHECK (unit_type IN ('house', 'building', 'commercial')),
  model_glb_url TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, unit_type)
);

ALTER TABLE public.unit_type_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own unit type models" ON public.unit_type_models;
DROP POLICY IF EXISTS "Users can insert own unit type models" ON public.unit_type_models;
DROP POLICY IF EXISTS "Users can update own unit type models" ON public.unit_type_models;
DROP POLICY IF EXISTS "Users can delete own unit type models" ON public.unit_type_models;

CREATE POLICY "Users can view own unit type models"
ON public.unit_type_models FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own unit type models"
ON public.unit_type_models FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own unit type models"
ON public.unit_type_models FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own unit type models"
ON public.unit_type_models FOR DELETE
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_unit_type_models_user ON public.unit_type_models(user_id);
CREATE INDEX IF NOT EXISTS idx_unit_type_models_type ON public.unit_type_models(unit_type);

DROP TRIGGER IF EXISTS unit_type_models_updated_at ON public.unit_type_models;
CREATE TRIGGER unit_type_models_updated_at
  BEFORE UPDATE ON public.unit_type_models
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

NOTIFY pgrst, 'reload schema';
