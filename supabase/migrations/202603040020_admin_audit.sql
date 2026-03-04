-- =============================================
-- admin_audit — log admin actions on users
-- =============================================
-- Records who did what to whom and when.
-- Only master_admin can read; only service-role can write
-- (Edge Functions use service-role, so RLS INSERT policy is omitted here —
--  the table is insert-restricted to authenticated service-role callers).

CREATE TABLE IF NOT EXISTS public.admin_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action          TEXT        NOT NULL,          -- e.g. 'create_user', 'delete_user'
  actor_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email    TEXT,
  metadata        JSONB       DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

-- Only master_admin can read audit logs
CREATE POLICY "master_admin can read audit logs"
  ON public.admin_audit FOR SELECT
  USING (public.get_my_role() = 'master_admin');

-- No client-side INSERT — only via service-role (Edge Functions)
-- No UPDATE or DELETE allowed from client

-- Index for filtering by actor or target
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx   ON public.admin_audit (actor_id);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx  ON public.admin_audit (target_user_id);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON public.admin_audit (created_at DESC);
