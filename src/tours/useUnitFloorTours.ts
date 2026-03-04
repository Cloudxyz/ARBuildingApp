/**
 * src/tours/useUnitFloorTours.ts
 *
 * Shared hook: fetches ALL floor tours for a unit once and caches the result
 * in module-level memory so repeated hook calls (across 3D Magic, 3D View,
 * Blueprint) never trigger duplicate requests for the same unitId.
 *
 * Usage:
 *   const { tourCache, loading } = useUnitFloorTours(unitId);
 *   const tourUrl = tourCache[selectedFloor] ?? null;
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Record<floor_index (1-based), url> */
export type TourCache = Record<number, string>;

// ── Module-level cache ──────────────────────────────────────────────────────
// Persists across component mounts within the same JS session.
// Key: unitId. Value: fully-fetched TourCache.
const _fetched = new Map<string, TourCache>();

// ── Hook ────────────────────────────────────────────────────────────────────
export function useUnitFloorTours(unitId: string): {
  /** All tour URLs for the unit, keyed by 1-based floor_index. */
  tourCache: TourCache;
  loading: boolean;
} {
  const [tourCache, setTourCache] = useState<TourCache>(
    () => _fetched.get(unitId) ?? {},
  );
  const [loading, setLoading] = useState(
    () => !!unitId && !_fetched.has(unitId),
  );

  useEffect(() => {
    if (!unitId) {
      setTourCache({});
      setLoading(false);
      return;
    }

    // Already cached — serve immediately, no network call.
    if (_fetched.has(unitId)) {
      setTourCache(_fetched.get(unitId)!);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setTourCache({});

    supabase
      .from('unit_floor_tours')
      .select('floor_index, url')
      .eq('unit_id', unitId)
      .then(({ data }) => {
        if (cancelled) return;
        const map: TourCache = {};
        (data ?? []).forEach((row: { floor_index: number; url: string }) => {
          map[row.floor_index] = row.url;
        });
        _fetched.set(unitId, map);
        setTourCache(map);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [unitId]);

  return { tourCache, loading };
}

/**
 * Invalidate the module-level cache for a specific unit (or all units).
 * Call this after saving new tour URLs so the next render re-fetches.
 */
export function invalidateTourCache(unitId?: string): void {
  if (unitId) {
    _fetched.delete(unitId);
  } else {
    _fetched.clear();
  }
}
