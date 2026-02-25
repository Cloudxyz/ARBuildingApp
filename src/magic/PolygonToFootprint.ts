// ─────────────────────────────────────────────────────────────────────────────
// src/magic/PolygonToFootprint.ts
// Converts 2-D canvas-pixel polygon into normalized and scaled 3-D footprint
// points (XZ plane, Y is up) ready for THREE.Shape extrusion.
// ─────────────────────────────────────────────────────────────────────────────

import { CanvasPoint, NormPoint } from './types';

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
 * Convert normalized [0..1] polygon into a centered XZ footprint.
 *
 * @param normPoints  Polygon vertices normalized to [0..1]
 * @param scaleM      Target max dimension in scene units (metres).
 *                    The polygon is scaled so that its longer axis = scaleM.
 */
export function polygonToFootprint(
  normPoints: NormPoint[],
  scaleM: number = 12,
): Footprint3D {
  if (normPoints.length < 3) {
    // Fallback: unit square
    const h = scaleM / 2;
    return {
      points: [
        { x: -h, z: -h },
        { x:  h, z: -h },
        { x:  h, z:  h },
        { x: -h, z:  h },
      ],
      width: scaleM,
      depth: scaleM,
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
  const aspect = spanX / spanY;

  // Scale so the longer axis = scaleM
  const worldW = aspect >= 1 ? scaleM : scaleM * aspect;
  const worldD = aspect >= 1 ? scaleM / aspect : scaleM;

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
