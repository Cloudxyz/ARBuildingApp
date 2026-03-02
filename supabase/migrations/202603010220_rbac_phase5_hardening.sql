-- =============================================
-- Phase 5: RBAC — Security hardening
-- =============================================
-- Adds the missing DELETE overlay policy for master_admin on profiles.
-- (Phase 2 only added SELECT + UPDATE; INSERT/DELETE were omitted since
--  normal client code should never directly manage profiles rows — but
--  the Admin Panel needs to hard-delete users, and the Edge Function
--  will also delete the auth.users row which cascades to profiles.)
--
-- Also adds a profiles INSERT override so master_admin can create
-- profiles for test accounts without going through the auth trigger.
--
-- Safe to run multiple times (DROP IF EXISTS before each CREATE).

-- ─── profiles ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Master admin can delete any profile" ON public.profiles;
CREATE POLICY "Master admin can delete any profile"
  ON public.profiles FOR DELETE
  USING (public.get_my_role() = 'master_admin');

DROP POLICY IF EXISTS "Master admin can insert any profile" ON public.profiles;
CREATE POLICY "Master admin can insert any profile"
  ON public.profiles FOR INSERT
  WITH CHECK (public.get_my_role() = 'master_admin');

-- ─── user_roles admin delete ──────────────────────────────────────────────────
-- user_roles already has a full ALL policy for master_admin (Phase 1),
-- so no additional policies are needed here.

-- ─── Grant Edge Function invocation ──────────────────────────────────────────
-- The `admin-delete-user` Edge Function uses the service-role key to call
-- auth.admin.deleteUser(). No SQL grants needed on the DB side — the check
-- is performed inside the function itself (verify caller is master_admin via JWT).
