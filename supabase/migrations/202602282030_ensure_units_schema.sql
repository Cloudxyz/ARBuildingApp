-- Ensure DB uses units/unit_models naming (idempotent).
-- Safe to run even if some environments are still on lands/land_models.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Rename legacy tables/columns when they still exist.
DO $$
BEGIN
  IF to_regclass('public.land_models') IS NOT NULL
     AND to_regclass('public.unit_models') IS NULL THEN
    ALTER TABLE public.land_models RENAME TO unit_models;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.lands') IS NOT NULL
     AND to_regclass('public.units') IS NULL THEN
    ALTER TABLE public.lands RENAME TO units;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.unit_models') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'unit_models'
         AND column_name = 'land_id'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'unit_models'
         AND column_name = 'unit_id'
     ) THEN
    ALTER TABLE public.unit_models RENAME COLUMN land_id TO unit_id;
  END IF;
END $$;

-- 2) Ensure developments exists.
CREATE TABLE IF NOT EXISTS public.developments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('fraccionamiento', 'condominio')),
  description  TEXT,
  address      TEXT,
  city         TEXT,
  state        TEXT,
  country      TEXT DEFAULT 'US',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Ensure units exists with required columns.
CREATE TABLE IF NOT EXISTS public.units (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  development_id UUID REFERENCES public.developments(id) ON DELETE SET NULL,
  unit_type      TEXT NOT NULL DEFAULT 'other'
                 CHECK (unit_type IN ('house', 'building', 'commercial', 'other')),
  model_glb_url  TEXT,
  name           TEXT NOT NULL,
  description    TEXT,
  area_sqm       NUMERIC(12, 2),
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  address        TEXT,
  city           TEXT,
  state          TEXT,
  country        TEXT DEFAULT 'US',
  price          NUMERIC(14, 2),
  status         TEXT NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available', 'reserved', 'sold')),
  thumbnail_url  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS development_id UUID REFERENCES public.developments(id) ON DELETE SET NULL;
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS model_glb_url TEXT;

-- 4) Ensure unit_models exists with required columns.
CREATE TABLE IF NOT EXISTS public.unit_models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  floor_count   INT NOT NULL DEFAULT 1 CHECK (floor_count BETWEEN 1 AND 20),
  scale         NUMERIC(5, 3) NOT NULL DEFAULT 1.0 CHECK (scale BETWEEN 0.1 AND 10.0),
  rotation_deg  NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
  building_type TEXT NOT NULL DEFAULT 'residential'
                CHECK (building_type IN ('residential', 'commercial', 'industrial', 'mixed')),
  color_scheme  TEXT NOT NULL DEFAULT 'blueprint',
  footprint_w   NUMERIC(8, 2) NOT NULL DEFAULT 10.0,
  footprint_h   NUMERIC(8, 2) NOT NULL DEFAULT 10.0,
  model_data    JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) If both legacy and new tables exist, migrate rows and remove legacy names.
DO $$
DECLARE
  lands_has_development BOOLEAN;
  legacy_model_has_land_id BOOLEAN;
BEGIN
  -- Move lands -> units when both exist (common mixed-state issue).
  IF to_regclass('public.lands') IS NOT NULL
     AND to_regclass('public.units') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'lands'
        AND column_name = 'development_id'
    ) INTO lands_has_development;

    IF lands_has_development THEN
      INSERT INTO public.units (
        id, user_id, development_id, name, description, area_sqm,
        latitude, longitude, address, city, state, country, price,
        status, thumbnail_url, created_at, updated_at
      )
      SELECT
        l.id, l.user_id, l.development_id, l.name, l.description, l.area_sqm,
        l.latitude, l.longitude, l.address, l.city, l.state, l.country, l.price,
        l.status, l.thumbnail_url, l.created_at, l.updated_at
      FROM public.lands l
      ON CONFLICT (id) DO NOTHING;
    ELSE
      INSERT INTO public.units (
        id, user_id, development_id, name, description, area_sqm,
        latitude, longitude, address, city, state, country, price,
        status, thumbnail_url, created_at, updated_at
      )
      SELECT
        l.id, l.user_id, NULL::UUID, l.name, l.description, l.area_sqm,
        l.latitude, l.longitude, l.address, l.city, l.state, l.country, l.price,
        l.status, l.thumbnail_url, l.created_at, l.updated_at
      FROM public.lands l
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;

  -- Move land_models -> unit_models when both exist.
  IF to_regclass('public.land_models') IS NOT NULL
     AND to_regclass('public.unit_models') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'land_models'
        AND column_name = 'land_id'
    ) INTO legacy_model_has_land_id;

    IF legacy_model_has_land_id THEN
      INSERT INTO public.unit_models (
        id, unit_id, user_id, floor_count, scale, rotation_deg,
        building_type, color_scheme, footprint_w, footprint_h,
        model_data, created_at, updated_at
      )
      SELECT
        lm.id, lm.land_id, lm.user_id, lm.floor_count, lm.scale, lm.rotation_deg,
        lm.building_type, lm.color_scheme, lm.footprint_w, lm.footprint_h,
        lm.model_data, lm.created_at, lm.updated_at
      FROM public.land_models lm
      ON CONFLICT (id) DO NOTHING;
    ELSE
      INSERT INTO public.unit_models (
        id, unit_id, user_id, floor_count, scale, rotation_deg,
        building_type, color_scheme, footprint_w, footprint_h,
        model_data, created_at, updated_at
      )
      SELECT
        lm.id, lm.unit_id, lm.user_id, lm.floor_count, lm.scale, lm.rotation_deg,
        lm.building_type, lm.color_scheme, lm.footprint_w, lm.footprint_h,
        lm.model_data, lm.created_at, lm.updated_at
      FROM public.land_models lm
      ON CONFLICT (id) DO NOTHING;
    END IF;

    DROP TABLE public.land_models;
  END IF;

  -- Remove legacy table name after data has been copied.
  IF to_regclass('public.lands') IS NOT NULL
     AND to_regclass('public.units') IS NOT NULL THEN
    DROP TABLE public.lands;
  END IF;
END $$;

-- 6) RLS + policies.
ALTER TABLE public.developments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own developments" ON public.developments;
DROP POLICY IF EXISTS "Users can insert own developments" ON public.developments;
DROP POLICY IF EXISTS "Users can update own developments" ON public.developments;
DROP POLICY IF EXISTS "Users can delete own developments" ON public.developments;

CREATE POLICY "Users can view own developments"
  ON public.developments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own developments"
  ON public.developments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own developments"
  ON public.developments FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own developments"
  ON public.developments FOR DELETE USING (auth.uid() = user_id);

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

-- 7) updated_at helper + triggers.
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS developments_updated_at ON public.developments;
DROP TRIGGER IF EXISTS lands_updated_at ON public.units;
DROP TRIGGER IF EXISTS units_updated_at ON public.units;
DROP TRIGGER IF EXISTS land_models_updated_at ON public.unit_models;
DROP TRIGGER IF EXISTS unit_models_updated_at ON public.unit_models;

CREATE TRIGGER developments_updated_at
  BEFORE UPDATE ON public.developments
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();
CREATE TRIGGER units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();
CREATE TRIGGER unit_models_updated_at
  BEFORE UPDATE ON public.unit_models
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

-- 8) Indexes.
CREATE INDEX IF NOT EXISTS idx_developments_user ON public.developments(user_id);
CREATE INDEX IF NOT EXISTS idx_units_user_id ON public.units(user_id);
CREATE INDEX IF NOT EXISTS idx_units_development ON public.units(development_id);
CREATE INDEX IF NOT EXISTS idx_units_unit_type ON public.units(unit_type);
CREATE INDEX IF NOT EXISTS idx_units_status ON public.units(status);
CREATE INDEX IF NOT EXISTS idx_unit_models_unit ON public.unit_models(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_models_user ON public.unit_models(user_id);

-- 9) Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
