// ─────────────────────────────────────────────────────────────────────────────
// src/magic/PolygonToFootprint.ts
// Converts 2-D canvas-pixel polygon into normalized and scaled 3-D footprint
// points (XZ plane, Y is up) ready for THREE.Shape extrusion.
// ─────────────────────────────────────────────────────────────────────────────

import { CanvasPoint, NormPoint } from './types';
import { pxToMeters } from './gridConfig';

/**
 * Compute the metric bounding box (width and depth in meters) of a polygon
 * expressed in raw canvas pixels.
 *
 * Uses pxToMeters() so the result is always consistent with the snap grid:
 *   drawing 10 cells wide → widthM = 10 × METERS_PER_CELL.
 *
 * @param points  Raw canvas-pixel polygon points
 */
export function pixelBBoxToMeters(
  points: CanvasPoint[],
): { widthM: number; depthM: number } {
  if (points.length < 2) return { widthM: 0, depthM: 0 };
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return {
    widthM: pxToMeters(maxX - minX),
    depthM: pxToMeters(maxY - minY),
  };
}

/** Normalize pixel-space polygon to [0..1] relative to canvas */
export function normalizePoints(
  points: CanvasPoint[],
  canvasW: number,
  canvasH: number,
): NormPoint[] {
  if (canvasW === 0 || canvasH === 0) return [];
  return points.map((p) => ({ x: p.x / canvasW, y: p.y / canvasH }));
}

/** Result of polygonToFootprint */
export interface Footprint3D {
  /** Points in XZ plane (Y=0), centered at origin, in scene units */
  points: { x: number; z: number }[];
  /** Bounding dimensions (scene units) */
  width: number;
  depth: number;
}

/**
 * Minimum footprint dimension in world units.
 * Prevents degenerate near-zero geometry when all points land on the same grid cell.
 */
const MIN_FOOTPRINT_M = 0.5;

/**
 * Convert normalized [0..1] polygon into a centered XZ footprint.
 *
 * @param normPoints  Polygon vertices normalized to [0..1]
 * @param scaleM      Legacy fallback: scales so longer axis = scaleM world units.
 *                    Ignored when widthM + depthM are supplied.
 * @param widthM      Explicit footprint width in meters (from pixel bbox → pxToMeters).
 *                    When provided together with depthM, the polygon is scaled to
 *                    exactly these dimensions — the grid-cell count is honoured.
 * @param depthM      Explicit footprint depth in meters (from pixel bbox → pxToMeters).
 */
export function polygonToFootprint(
  normPoints: NormPoint[],
  scaleM: number = 12,
  widthM?: number,
  depthM?: number,
): Footprint3D {
  // If caller supplies explicit metric dims, use them; otherwise use legacy scaleM.
  // Clamp to MIN_FOOTPRINT_M to prevent degenerate zero-size geometry
  // (e.g., all polygon points snapped to the same grid cell).
  const hasMetric = widthM !== undefined && depthM !== undefined
                    && widthM > 0 && depthM > 0;
  const safeWidthM = hasMetric ? Math.max(MIN_FOOTPRINT_M, widthM!) : undefined;
  const safeDepthM = hasMetric ? Math.max(MIN_FOOTPRINT_M, depthM!) : undefined;
  const useMetric  = safeWidthM !== undefined && safeDepthM !== undefined;

  if (normPoints.length < 3) {
    // Fallback: square with metric or legacy size
    const w = useMetric ? safeWidthM! : scaleM;
    const d = useMetric ? safeDepthM! : scaleM;
    const hw = w / 2, hd = d / 2;
    return {
      points: [
        { x: -hw, z: -hd },
        { x:  hw, z: -hd },
        { x:  hw, z:  hd },
        { x: -hw, z:  hd },
      ],
      width: w,
      depth: d,
    };
  }

  // Compute bounding box of normalized polygon
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of normPoints) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }

  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;

  // ── World dimensions ──────────────────────────────────────────────────────
  // Metric path: use exact pixel-derived meters (honours grid cell count).
  // Legacy path: scale so longer axis = scaleM (aspect-ratio squeeze).
  let worldW: number;
  let worldD: number;
  if (hasMetric) {
    worldW = safeWidthM!;
    worldD = safeDepthM!;
  } else {
    const aspect = spanX / spanY;
    worldW = aspect >= 1 ? scaleM : scaleM * aspect;
    worldD = aspect >= 1 ? scaleM / aspect : scaleM;
  }

  // Center offset
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const points = normPoints.map((p) => ({
    x: ((p.x - cx) / (spanX / 2)) * (worldW / 2),
    // canvas Y increases downward; THREE Z increases away from camera → invert Y
    z: (((p.y - cy) / (spanY / 2)) * (worldD / 2)),
  }));

  return { points, width: worldW, depth: worldD };
}

/** Compute polygon centroid (normalized coords) */
export function polygonCentroid(pts: NormPoint[]): NormPoint {
  const n = pts.length;
  if (n === 0) return { x: 0.5, y: 0.5 };
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  return { x: sx / n, y: sy / n };
}
