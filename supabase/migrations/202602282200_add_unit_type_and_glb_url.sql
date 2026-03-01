-- Add unit type + optional per-unit GLB URL for custom 3D model loading.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'other';

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS model_glb_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_unit_type_check'
      AND conrelid = 'public.units'::regclass
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_unit_type_check
      CHECK (unit_type IN ('house', 'building', 'commercial', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_units_unit_type ON public.units(unit_type);

NOTIFY pgrst, 'reload schema';
