// ─────────────────────────────────────────────────────────────────────────────
// src/magic/gridConfig.ts
//
// Single source of truth for the 3D Magic grid + metric unit system.
// Both the draw overlay (MagicCanvasMode, PhotoCanvasWithPolygon) and the
// geometry builder (Procedural3DBuilding via PolygonToFootprint) must derive
// their values from these constants — never duplicate them.
//
// Only affects 3D Magic view. Blueprint view and AR/GLB view are untouched.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many real-world meters one grid cell represents.
 * Change this to rescale ALL output geometry without touching any other file.
 *   1  → 1 cell = 1 m  (default)
 *   2  → 1 cell = 2 m  (larger real-world scale)
 *   0.5 → 1 cell = 0.5 m (smaller real-world scale)
 */
export const METERS_PER_CELL = 1; // m / cell

/**
 * Visual size of one grid cell on screen, in logical pixels.
 * Larger = bigger squares, easier to tap precisely.
 */
export const GRID_CELL_SIZE = 40; // px

/**
 * Developer multiplier applied on top of GRID_CELL_SIZE.
 *   1 = normal (40 px)
 *   2 = double-sized cells (80 px)
 * Does NOT change METERS_PER_CELL, so world scale is unaffected.
 */
export const GRID_SCALE = 1;

/**
 * Effective pixel size of one grid cell = GRID_CELL_SIZE × GRID_SCALE.
 * This is the value used by:
 *   • Grid line rendering (SVG overlay)
 *   • Snap-to-grid rounding
 *   • px → meters conversion
 */
export const GRID_SIZE = GRID_CELL_SIZE * GRID_SCALE; // px / cell

/**
 * DEV: set to true to show a translucent overlay in 3D Magic's build phase
 * displaying the computed footprint meters and total building height.
 * Costs nothing when false (no component rendered).
 * Turn off before shipping to production.
 */
export const DEV_SHOW_METRICS = false;

// ── Aspect ratio & screen size notes ──────────────────────────────────────────
// The metric pipeline is pixel-based (GRID_SIZE px = 1 cell = METERS_PER_CELL m).
// Screen density / aspect ratio changes do NOT alter world scale:
//   • A wider screen has more cells across, but each cell is still the same
//     number of logical pixels and the same real-world meters.
//   • Image aspect ratio affects only the SHAPE of the polygon (norm coords),
//     not the overall footprint meters which come from the raw pixel bbox.
//   • Zoom/pan of the photo (if added in future) must scale GRID_SIZE px
//     proportionally, or metric dims must be re-derived from zoomed coords.

// ── Conversion helpers ────────────────────────────────────────────────────────

/**
 * Convert a canvas-pixel distance to meters.
 * Consistent with the snap grid: a distance of exactly GRID_SIZE px = 1 cell = METERS_PER_CELL m.
 *
 * @param px  Distance measured in canvas pixels
 * @returns   Equivalent distance in meters
 */
export function pxToMeters(px: number): number {
  return (px / GRID_SIZE) * METERS_PER_CELL;
}

/**
 * Convert an integer number of grid cells to meters.
 *
 * @param cells  Number of grid cells (e.g. width of a drawn polygon in cells)
 * @returns      Distance in meters
 */
export function cellsToMeters(cells: number): number {
  return cells * METERS_PER_CELL;
}

// ── Measurement label system ──────────────────────────────────────────────────
// All functions here are pure (no side effects, no React).
// They are used by both the draw overlay (live labels) and the build phase
// (frozen labels). Only update when polygon points change — never per-frame.

/** Exact conversion factor: 1 metre = 3.28084 feet */
export const M_TO_FT = 3.28084;

/**
 * Convert metres to feet.
 */
export function metersToFeet(m: number): number {
  return m * M_TO_FT;
}

/**
 * Format a single dimension as "X.X m / Y.Y ft".
 * Both values are rounded to one decimal place.
 *
 * @example formatDimension(10)  → "10.0m / 32.8ft"
 * @example formatDimension(5.5) → "5.5m / 18.0ft"
 */
export function formatDimension(meters: number): string {
  const ft = metersToFeet(meters);
  return `${meters.toFixed(1)}m / ${ft.toFixed(1)}ft`;
}

/**
 * The full set of real-world measurements derived from a drawn polygon.
 * Computed once when the polygon changes; stored as plain data (no React state).
 */
export interface FootprintMeasurements {
  /** Footprint width in metres (X axis, horizontal span on canvas) */
  widthM:  number;
  /** Footprint depth in metres (Y axis, vertical span on canvas) */
  depthM:  number;
  /** Footprint width in feet */
  widthFt: number;
  /** Footprint depth in feet */
  depthFt: number;
  /** Ready-to-display string: "W.W m / F.F ft" */
  widthLabel:  string;
  /** Ready-to-display string: "W.W m / F.F ft" */
  depthLabel:  string;
}

/**
 * Measurements that also include building height.
 * Used in the frozen label shown after the model is generated.
 */
export interface BuildingMeasurements extends FootprintMeasurements {
  /** Total building height in metres (floorCount × floorHeightM) */
  heightM:  number;
  /** Total building height in feet */
  heightFt: number;
  /** Ready-to-display string: "H.H m / F.F ft" */
  heightLabel: string;
}

/**
 * Compute footprint measurements from raw canvas-pixel polygon points.
 *
 * This is the canonical way to derive real-world dimensions from a drawing:
 *   pixel span → pxToMeters() → metres → metersToFeet() → feet
 *
 * Returns zero-filled measurements when fewer than 2 points are present.
 * Only needs to run when the points array changes — never per frame.
 *
 * @param points  Array of {x, y} points in canvas pixel coordinates
 */
export function computeFootprintMeasurements(
  points: readonly { x: number; y: number }[],
): FootprintMeasurements {
  if (points.length < 2) {
    return {
      widthM: 0, depthM: 0,
      widthFt: 0, depthFt: 0,
      widthLabel: formatDimension(0),
      depthLabel: formatDimension(0),
    };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const widthM  = pxToMeters(maxX - minX);
  const depthM  = pxToMeters(maxY - minY);
  const widthFt = metersToFeet(widthM);
  const depthFt = metersToFeet(depthM);

  return {
    widthM,
    depthM,
    widthFt,
    depthFt,
    widthLabel: formatDimension(widthM),
    depthLabel: formatDimension(depthM),
  };
}

/**
 * Extend footprint measurements with total building height.
 *
 * @param footprint   Result of computeFootprintMeasurements()
 * @param floorCount  Number of floors
 * @param floorHeightM  Height per floor in metres (default: 3 m)
 */
export function computeBuildingMeasurements(
  footprint: FootprintMeasurements,
  floorCount: number,
  floorHeightM: number = 3,
): BuildingMeasurements {
  const heightM  = floorCount * floorHeightM;
  const heightFt = metersToFeet(heightM);
  return {
    ...footprint,
    heightM,
    heightFt,
    heightLabel: formatDimension(heightM),
  };
}
