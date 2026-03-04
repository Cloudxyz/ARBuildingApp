-- Revert the floors_count column added in 202603040001.
-- Safe to DROP because that migration has NOT been deployed to production.
-- floor count is derived at runtime from unit_floor_tours.floor_index instead.
ALTER TABLE units DROP COLUMN IF EXISTS floors_count;
