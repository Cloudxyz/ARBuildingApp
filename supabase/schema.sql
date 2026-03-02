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

CREATE POLICY "Master admin can view all profiles"
  ON profiles FOR SELECT
  USING (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can update all profiles"
  ON profiles FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

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
-- DEVELOPMENTS (Fraccionamientos / Condominios)
-- =============================================
CREATE TABLE IF NOT EXISTS developments (
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

ALTER TABLE developments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own developments" ON developments;
DROP POLICY IF EXISTS "Users can insert own developments" ON developments;
DROP POLICY IF EXISTS "Users can update own developments" ON developments;
DROP POLICY IF EXISTS "Users can delete own developments" ON developments;

CREATE POLICY "Users can view own developments"
  ON developments FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own developments"
  ON developments FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own developments"
  ON developments FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own developments"
  ON developments FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Master admin can view all developments"
  ON developments FOR SELECT USING (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can insert any development"
  ON developments FOR INSERT WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can update any development"
  ON developments FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can delete any development"
  ON developments FOR DELETE USING (public.get_my_role() = 'master_admin');

-- =============================================
-- units
-- =============================================
CREATE TABLE IF NOT EXISTS units (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  development_id UUID REFERENCES developments(id) ON DELETE SET NULL,
  unit_type     TEXT NOT NULL DEFAULT 'land'
                CHECK (unit_type IN ('land', 'house', 'building', 'commercial')),
  model_glb_url TEXT,
  name          TEXT NOT NULL,
  description   TEXT,
  area_sqm      NUMERIC(12, 2),
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT DEFAULT 'US',
  price         NUMERIC(14, 2),
  status        TEXT NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available', 'reserved', 'sold')),
  thumbnail_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS development_id UUID REFERENCES developments(id) ON DELETE SET NULL;

ALTER TABLE units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own units" ON units;
DROP POLICY IF EXISTS "Users can insert own units" ON units;
DROP POLICY IF EXISTS "Users can update own units" ON units;
DROP POLICY IF EXISTS "Users can delete own units" ON units;

CREATE POLICY "Users can view own units"
  ON units FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own units"
  ON units FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      development_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM developments d
        WHERE d.id = development_id
          AND d.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own units"
  ON units FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      development_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM developments d
        WHERE d.id = development_id
          AND d.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can delete own units"
  ON units FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Master admin can view all units"
  ON units FOR SELECT USING (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can insert any unit"
  ON units FOR INSERT WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can update any unit"
  ON units FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can delete any unit"
  ON units FOR DELETE USING (public.get_my_role() = 'master_admin');

-- =============================================
-- unit type models (house/building/commercial)
-- =============================================
CREATE TABLE IF NOT EXISTS unit_type_models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_type     TEXT NOT NULL CHECK (unit_type IN ('house', 'building', 'commercial')),
  model_glb_url TEXT,
  external_model_glb_url TEXT,
  storage_path  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, unit_type)
);

ALTER TABLE unit_type_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own unit type models" ON unit_type_models;
DROP POLICY IF EXISTS "Users can insert own unit type models" ON unit_type_models;
DROP POLICY IF EXISTS "Users can update own unit type models" ON unit_type_models;
DROP POLICY IF EXISTS "Users can delete own unit type models" ON unit_type_models;

CREATE POLICY "Users can view own unit type models"
  ON unit_type_models FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own unit type models"
  ON unit_type_models FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own unit type models"
  ON unit_type_models FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own unit type models"
  ON unit_type_models FOR DELETE USING (auth.uid() = user_id);

-- =============================================
-- unit models (AR Building Configurations)
-- =============================================
CREATE TABLE IF NOT EXISTS unit_models (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id       UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
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

ALTER TABLE unit_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own unit models"
  ON unit_models FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own unit models"
  ON unit_models FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own unit models"
  ON unit_models FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own unit models"
  ON unit_models FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Master admin can view all unit models"
  ON unit_models FOR SELECT USING (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can insert any unit model"
  ON unit_models FOR INSERT WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can update any unit model"
  ON unit_models FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can delete any unit model"
  ON unit_models FOR DELETE USING (public.get_my_role() = 'master_admin');

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

CREATE TRIGGER units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER developments_updated_at
  BEFORE UPDATE ON developments
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER unit_models_updated_at
  BEFORE UPDATE ON unit_models
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER unit_type_models_updated_at
  BEFORE UPDATE ON unit_type_models
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_developments_user ON developments(user_id);
CREATE INDEX IF NOT EXISTS idx_units_user_id    ON units(user_id);
CREATE INDEX IF NOT EXISTS idx_units_development ON units(development_id);
CREATE INDEX IF NOT EXISTS idx_units_unit_type  ON units(unit_type);
CREATE INDEX IF NOT EXISTS idx_units_status     ON units(status);
CREATE INDEX IF NOT EXISTS idx_unit_type_models_user ON unit_type_models(user_id);
CREATE INDEX IF NOT EXISTS idx_unit_type_models_type ON unit_type_models(unit_type);
CREATE INDEX IF NOT EXISTS idx_unit_models_unit ON unit_models(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_models_user ON unit_models(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user  ON user_roles(user_id);

-- =============================================
-- RBAC — user_roles table
-- =============================================
-- One row per user. Missing row = 'user' (safe default).
-- Roles: 'user' | 'master_admin'
--
-- Bootstrap first master_admin via Supabase dashboard:
--   INSERT INTO public.user_roles (user_id, role)
--   VALUES ('<auth-uid>', 'master_admin');
CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'master_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- =============================================
-- RBAC — get_my_role() helper
-- =============================================
-- Returns the role of the currently authenticated user.
-- Defaults to 'user' if no row exists in user_roles.
-- SECURITY DEFINER: runs as owner so it can read user_roles
-- without the caller needing a SELECT policy on it.
-- STABLE: Postgres caches result within a single query.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.user_roles WHERE user_id = auth.uid()),
    'user'
  );
$$;

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own role" ON user_roles;
CREATE POLICY "Users can read own role"
  ON user_roles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Master admin can manage all roles" ON user_roles;
CREATE POLICY "Master admin can manage all roles"
  ON user_roles FOR ALL
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

