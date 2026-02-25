-- =============================================
-- VR Real Estate — Supabase Schema
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- PROFILES
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  full_name  TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- =============================================
-- LANDS
-- =============================================
CREATE TABLE IF NOT EXISTS lands (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  area_sqm     NUMERIC(12, 2),
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  address      TEXT,
  city         TEXT,
  state        TEXT,
  country      TEXT DEFAULT 'US',
  price        NUMERIC(14, 2),
  status       TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'reserved', 'sold')),
  thumbnail_url TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lands"
  ON lands FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lands"
  ON lands FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lands"
  ON lands FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own lands"
  ON lands FOR DELETE USING (auth.uid() = user_id);

-- =============================================
-- LAND MODELS (AR Building Configurations)
-- =============================================
CREATE TABLE IF NOT EXISTS land_models (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  land_id       UUID NOT NULL REFERENCES lands(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  floor_count   INT NOT NULL DEFAULT 1 CHECK (floor_count BETWEEN 1 AND 20),
  scale         NUMERIC(5, 3) NOT NULL DEFAULT 1.0 CHECK (scale BETWEEN 0.1 AND 10.0),
  rotation_deg  NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
  building_type TEXT NOT NULL DEFAULT 'residential'
                CHECK (building_type IN ('residential', 'commercial', 'industrial', 'mixed')),
  color_scheme  TEXT NOT NULL DEFAULT 'blueprint',
  footprint_w   NUMERIC(8, 2) NOT NULL DEFAULT 10.0,
  footprint_h   NUMERIC(8, 2) NOT NULL DEFAULT 10.0,
  model_data    JSONB DEFAULT '{}'::jsonb,  -- AR config: floors, speed, offsets, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE land_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own land models"
  ON land_models FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own land models"
  ON land_models FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own land models"
  ON land_models FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own land models"
  ON land_models FOR DELETE USING (auth.uid() = user_id);

-- =============================================
-- UPDATED_AT TRIGGER HELPER
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER lands_updated_at
  BEFORE UPDATE ON lands
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER land_models_updated_at
  BEFORE UPDATE ON land_models
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_lands_user_id    ON lands(user_id);
CREATE INDEX IF NOT EXISTS idx_lands_status     ON lands(status);
CREATE INDEX IF NOT EXISTS idx_land_models_land ON land_models(land_id);
CREATE INDEX IF NOT EXISTS idx_land_models_user ON land_models(user_id);
