-- Replace unit_floor_tours table with a JSONB column on units.
-- Each element is a Matterport URL string; empty string "" means no tour for that floor.
-- Index = floor number (0-based): floors[0] = floor 1, floors[1] = floor 2, etc.

-- 1. Add floors column to units (safe to run multiple times)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS floors JSONB DEFAULT '[]';

-- 2. Migrate existing tour data into units.floors
--    Builds a JSON array ordered by floor_index from unit_floor_tours rows.
DO $$
DECLARE
  rec RECORD;
  arr JSONB;
  max_idx INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'unit_floor_tours') THEN
    FOR rec IN SELECT DISTINCT unit_id FROM public.unit_floor_tours LOOP
      SELECT MAX(floor_index) INTO max_idx
        FROM public.unit_floor_tours WHERE unit_id = rec.unit_id;

      -- Build array filled with "" up to max_idx, then fill in real URLs
      arr := (
        SELECT jsonb_agg(
          COALESCE(
            (SELECT url FROM public.unit_floor_tours
              WHERE unit_id = rec.unit_id AND floor_index = s.i),
            ''
          ) ORDER BY s.i
        )
        FROM generate_series(0, max_idx) AS s(i)
      );

      UPDATE public.units SET floors = arr WHERE id = rec.unit_id;
    END LOOP;
  END IF;
END $$;

-- 3. Drop the old table
DROP TABLE IF EXISTS public.unit_floor_tours;
