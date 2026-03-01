-- Add parent entity for lands: developments (fraccionamientos/condominios)
-- and make lands.development_id optional.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.developments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('fraccionamiento', 'condominio')),
  description   TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT DEFAULT 'US',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.developments ENABLE ROW LEVEL SECURITY;

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

ALTER TABLE public.lands
  ADD COLUMN IF NOT EXISTS development_id UUID REFERENCES public.developments(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "Users can view own lands" ON public.lands;
DROP POLICY IF EXISTS "Users can insert own lands" ON public.lands;
DROP POLICY IF EXISTS "Users can update own lands" ON public.lands;
DROP POLICY IF EXISTS "Users can delete own lands" ON public.lands;

CREATE POLICY "Users can view own lands"
  ON public.lands FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lands"
  ON public.lands FOR INSERT WITH CHECK (
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

CREATE POLICY "Users can update own lands"
  ON public.lands FOR UPDATE USING (auth.uid() = user_id)
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

CREATE POLICY "Users can delete own lands"
  ON public.lands FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS developments_updated_at ON public.developments;
CREATE TRIGGER developments_updated_at
  BEFORE UPDATE ON public.developments
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

CREATE INDEX IF NOT EXISTS idx_developments_user ON public.developments(user_id);
CREATE INDEX IF NOT EXISTS idx_lands_development ON public.lands(development_id);
