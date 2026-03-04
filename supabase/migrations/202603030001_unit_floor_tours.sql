-- =============================================
-- unit_floor_tours
-- Stores one Matterport (or any https) tour URL per floor per unit.
-- Ownership is resolved by joining through units.user_id (no denorm).
-- =============================================

CREATE TABLE IF NOT EXISTS public.unit_floor_tours (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID        NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  floor_index INT         NOT NULL CHECK (floor_index >= 1),
  provider    TEXT        NOT NULL DEFAULT 'matterport',
  url         TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unit_floor_tours_unit_floor_unique UNIQUE (unit_id, floor_index)
);

ALTER TABLE public.unit_floor_tours ENABLE ROW LEVEL SECURITY;

-- ── Owner policies (resolved via parent units row) ────────────────────────────

CREATE POLICY "Owners can view own floor tours"
  ON public.unit_floor_tours FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = unit_id
        AND u.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can insert own floor tours"
  ON public.unit_floor_tours FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = unit_id
        AND u.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update own floor tours"
  ON public.unit_floor_tours FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = unit_id
        AND u.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = unit_id
        AND u.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete own floor tours"
  ON public.unit_floor_tours FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = unit_id
        AND u.user_id = auth.uid()
    )
  );

-- ── Master admin overlay ──────────────────────────────────────────────────────

CREATE POLICY "Master admin can view all floor tours"
  ON public.unit_floor_tours FOR SELECT
  USING (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can insert any floor tour"
  ON public.unit_floor_tours FOR INSERT
  WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can update any floor tour"
  ON public.unit_floor_tours FOR UPDATE
  USING  (public.get_my_role() = 'master_admin')
  WITH CHECK (public.get_my_role() = 'master_admin');

CREATE POLICY "Master admin can delete any floor tour"
  ON public.unit_floor_tours FOR DELETE
  USING (public.get_my_role() = 'master_admin');
