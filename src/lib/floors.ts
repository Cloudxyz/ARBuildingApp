/**
 * src/lib/floors.ts
 *
 * Single source of truth for deriving floor count and tour URLs
 * from the units.floors JSONB column.
 *
 * Shape: string[]   — floors[i] is the Matterport URL for floor (i+1).
 *                     Empty string ("") means no tour for that floor.
 *                     Array length == floor count.
 */

/**
 * Normalize the raw DB value (null | undefined | unknown[]) into a
 * clean string[]. Always returns at least one element ("").
 */
export function normalizeFloors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [''];
  const arr = raw.map((v) => (typeof v === 'string' ? v : ''));
  return arr.length > 0 ? arr : [''];
}

/**
 * Return a new array resized to n entries.
 * - Existing URLs are preserved.
 * - New entries are filled with "".
 * - Clamped to [1, 200].
 */
export function resizeFloors(floors: string[], n: number): string[] {
  const clamped = Math.max(1, Math.min(200, n));
  if (floors.length === clamped) return floors;
  if (floors.length > clamped) return floors.slice(0, clamped);
  return [...floors, ...Array<string>(clamped - floors.length).fill('')];
}

/** Total floor count — always at least 1. */
export function getFloorsTotalFromArr(floors: string[]): number {
  return Math.max(1, floors.length);
}

/**
 * Tour URL for a 1-based floorIndex, or null if the entry is empty/missing.
 */
export function getTourUrlFromArr(floors: string[], floorIndex: number): string | null {
  const url = floors[floorIndex - 1] ?? '';
  return url.trim() ? url : null;
}
