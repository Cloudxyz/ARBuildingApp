-- Add floors JSONB column to units.
-- Array of strings: floors[i] = Matterport URL for floor (i+1), or "" if no tour.
-- Length of array = floor count for the unit.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS floors JSONB DEFAULT '[]';
