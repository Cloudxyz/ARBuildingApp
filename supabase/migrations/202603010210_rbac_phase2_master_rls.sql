-- =============================================
-- Phase 2: RBAC — master_admin RLS overlay policies
-- =============================================
-- Strategy: add one permissive policy per table per operation for
-- master_admin. Postgres OR-combines permissive policies, so a master
-- passes the role check regardless of user_id ownership.
-- Existing user-owned policies are UNTOUCHED → zero normal-user regression.
-- Safe to run multiple times (DROP POLICY IF EXISTS before each CREATE).

-- =============================================
-- profiles
-- =============================================
DROP POLICY IF EXISTS "Master admin can view all profiles" ON public.profiles;
CREATE POLICY "Master admin can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can update all profiles" ON public.profiles;
CREATE POLICY "Master admin can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

-- =============================================
-- developments
-- =============================================
DROP POLICY IF EXISTS "Master admin can view all developments" ON public.developments;
CREATE POLICY "Master admin can view all developments"
  ON public.developments FOR SELECT
  USING (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can insert any development" ON public.developments;
CREATE POLICY "Master admin can insert any development"
  ON public.developments FOR INSERT
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can update any development" ON public.developments;
CREATE POLICY "Master admin can update any development"
  ON public.developments FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can delete any development" ON public.developments;
CREATE POLICY "Master admin can delete any development"
  ON public.developments FOR DELETE
  USING (public.get_my_role() = 'master_admin');

-- =============================================
-- units
-- =============================================
DROP POLICY IF EXISTS "Master admin can view all units" ON public.units;
CREATE POLICY "Master admin can view all units"
  ON public.units FOR SELECT
  USING (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can insert any unit" ON public.units;
CREATE POLICY "Master admin can insert any unit"
  ON public.units FOR INSERT
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can update any unit" ON public.units;
CREATE POLICY "Master admin can update any unit"
  ON public.units FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can delete any unit" ON public.units;
CREATE POLICY "Master admin can delete any unit"
  ON public.units FOR DELETE
  USING (public.get_my_role() = 'master_admin');

-- =============================================
-- unit_models (AR building configs)
-- =============================================
DROP POLICY IF EXISTS "Master admin can view all unit models" ON public.unit_models;
CREATE POLICY "Master admin can view all unit models"
  ON public.unit_models FOR SELECT
  USING (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can insert any unit model" ON public.unit_models;
CREATE POLICY "Master admin can insert any unit model"
  ON public.unit_models FOR INSERT
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can update any unit model" ON public.unit_models;
CREATE POLICY "Master admin can update any unit model"
  ON public.unit_models FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can delete any unit model" ON public.unit_models;
CREATE POLICY "Master admin can delete any unit model"
  ON public.unit_models FOR DELETE
  USING (public.get_my_role() = 'master_admin');

-- =============================================
-- unit_glb_models (per-unit GLB files)
-- =============================================
DROP POLICY IF EXISTS "Master admin can view all unit glb models" ON public.unit_glb_models;
CREATE POLICY "Master admin can view all unit glb models"
  ON public.unit_glb_models FOR SELECT
  USING (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can insert any unit glb model" ON public.unit_glb_models;
CREATE POLICY "Master admin can insert any unit glb model"
  ON public.unit_glb_models FOR INSERT
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can update any unit glb model" ON public.unit_glb_models;
CREATE POLICY "Master admin can update any unit glb model"
  ON public.unit_glb_models FOR UPDATE
  USING (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can delete any unit glb model" ON public.unit_glb_models;
CREATE POLICY "Master admin can delete any unit glb model"
  ON public.unit_glb_models FOR DELETE
  USING (public.get_my_role() = 'master_admin');
