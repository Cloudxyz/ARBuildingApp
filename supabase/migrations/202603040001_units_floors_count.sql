-- Add floors_count to units as single source of truth for floor count.
-- Default 1 applies to existing rows automatically (NOT NULL with DEFAULT).
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS floors_count integer NOT NULL DEFAULT 1
    CONSTRAINT units_floors_count_range CHECK (floors_count >= 1 AND floors_count <= 200);
