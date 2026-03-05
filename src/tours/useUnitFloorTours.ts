/**
 * src/tours/useUnitFloorTours.ts
 *
 * Stub: floor tour URLs are now stored in `units.floors` JSON column.
 * This hook always returns empty — consuming components derive tour URLs
 * directly from the unit's floors array.
 */

import { useState } from 'react';

/** Record<floor_index (1-based), url> */
export type TourCache = Record<number, string>;

export function useUnitFloorTours(_unitId: string): {
  tourCache: TourCache;
  loading: boolean;
} {
  const [tourCache] = useState<TourCache>({});
  return { tourCache, loading: false };
}

/** No-op: cache busting no longer needed as data comes from units API. */
export function invalidateTourCache(_unitId?: string): void {}

