-- Rename lands to units and land_models to unit_models.
-- Keeps data and relationships, and updates RLS/index/trigger names.

DO $$
BEGIN
  IF to_regclass('public.land_models') IS NOT NULL THEN
    ALTER TABLE public.land_models RENAME TO unit_models;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.lands') IS NOT NULL THEN
    ALTER TABLE public.lands RENAME TO units;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'unit_models'
      AND column_name = 'land_id'
  ) THEN
    ALTER TABLE public.unit_models RENAME COLUMN land_id TO unit_id;
  END IF;
END $$;

-- Units policies
DROP POLICY IF EXISTS "Users can view own lands" ON public.units;
DROP POLICY IF EXISTS "Users can insert own lands" ON public.units;
DROP POLICY IF EXISTS "Users can update own lands" ON public.units;
DROP POLICY IF EXISTS "Users can delete own lands" ON public.units;
DROP POLICY IF EXISTS "Users can view own units" ON public.units;
DROP POLICY IF EXISTS "Users can insert own units" ON public.units;
DROP POLICY IF EXISTS "Users can update own units" ON public.units;
DROP POLICY IF EXISTS "Users can delete own units" ON public.units;

CREATE POLICY "Users can view own units"
  ON public.units FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own units"
  ON public.units FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      development_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.developments d
        WHERE d.id = development_id
          AND d.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own units"
  ON public.units FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      development_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.developments d
        WHERE d.id = development_id
          AND d.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete own units"
  ON public.units FOR DELETE USING (auth.uid() = user_id);

-- Unit model policies
DROP POLICY IF EXISTS "Users can view own land models" ON public.unit_models;
DROP POLICY IF EXISTS "Users can insert own land models" ON public.unit_models;
DROP POLICY IF EXISTS "Users can update own land models" ON public.unit_models;
DROP POLICY IF EXISTS "Users can delete own land models" ON public.unit_models;
DROP POLICY IF EXISTS "Users can view own unit models" ON public.unit_models;
DROP POLICY IF EXISTS "Users can insert own unit models" ON public.unit_models;
DROP POLICY IF EXISTS "Users can update own unit models" ON public.unit_models;
DROP POLICY IF EXISTS "Users can delete own unit models" ON public.unit_models;

CREATE POLICY "Users can view own unit models"
  ON public.unit_models FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own unit models"
  ON public.unit_models FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own unit models"
  ON public.unit_models FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own unit models"
  ON public.unit_models FOR DELETE USING (auth.uid() = user_id);

-- Trigger names
DROP TRIGGER IF EXISTS lands_updated_at ON public.units;
DROP TRIGGER IF EXISTS units_updated_at ON public.units;
CREATE TRIGGER units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

DROP TRIGGER IF EXISTS land_models_updated_at ON public.unit_models;
DROP TRIGGER IF EXISTS unit_models_updated_at ON public.unit_models;
CREATE TRIGGER unit_models_updated_at
  BEFORE UPDATE ON public.unit_models
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

-- Index names
DROP INDEX IF EXISTS public.idx_lands_user_id;
DROP INDEX IF EXISTS public.idx_lands_development;
DROP INDEX IF EXISTS public.idx_lands_status;
DROP INDEX IF EXISTS public.idx_land_models_land;
DROP INDEX IF EXISTS public.idx_land_models_user;
DROP INDEX IF EXISTS public.idx_units_user_id;
DROP INDEX IF EXISTS public.idx_units_development;
DROP INDEX IF EXISTS public.idx_units_status;
DROP INDEX IF EXISTS public.idx_unit_models_unit;
DROP INDEX IF EXISTS public.idx_unit_models_user;

CREATE INDEX IF NOT EXISTS idx_units_user_id ON public.units(user_id);
CREATE INDEX IF NOT EXISTS idx_units_development ON public.units(development_id);
CREATE INDEX IF NOT EXISTS idx_units_status ON public.units(status);
CREATE INDEX IF NOT EXISTS idx_unit_models_unit ON public.unit_models(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_models_user ON public.unit_models(user_id);
