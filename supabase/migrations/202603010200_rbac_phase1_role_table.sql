-- =============================================
-- Phase 1: RBAC — user_roles table + get_my_role() helper
-- =============================================
-- Safe to run multiple times (IF NOT EXISTS / CREATE OR REPLACE)
--
-- Roles:
--   'user'         → default, owns-only access (existing behavior)
--   'master_admin' → full access across all data
--
-- Bootstrapping: insert the first master_admin directly via Supabase
-- dashboard SQL editor or service-role key:
--   INSERT INTO public.user_roles (user_id, role)
--   VALUES ('<your-auth-uid>', 'master_admin');

-- 1. Helper function (defined first — policies below reference it)
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

-- 2. Role table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'master_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- 3. RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role (needed for app-side role resolution)
DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
CREATE POLICY "Users can read own role"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- Master admin has full control over role assignments
DROP POLICY IF EXISTS "Master admin can manage all roles" ON public.user_roles;
CREATE POLICY "Master admin can manage all roles"
  ON public.user_roles FOR ALL
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

-- 4. Index
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
