/**
 * src/tours/getFloorsFromTours.ts
 *
 * Single source of truth for floor count and tour URL lookup.
 * Operates on TourCache — the Record<floor_index, url> already
 * fetched by useUnitFloorTours(unitId).
 *
 * floor_index is 1-based throughout the app.
 */

import type { TourCache } from './useUnitFloorTours';

/**
 * Returns the total number of floors represented by the saved tours.
 * Falls back to 1 when no tours exist.
 */
export function getFloorsTotal(tourCache: TourCache): number {
  const keys = Object.keys(tourCache).map(Number).filter((n) => n >= 1);
  return keys.length === 0 ? 1 : Math.max(...keys);
}

/**
 * Returns the tour URL for a 1-based floor index, or null if none saved.
 */
export function getTourUrl(tourCache: TourCache, floorIndex: number): string | null {
  return tourCache[floorIndex] ?? null;
}
