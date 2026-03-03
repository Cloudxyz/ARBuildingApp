// ─────────────────────────────────────────────────────────────────────────────
// src/magic/snapUtils.ts
// All snapping heuristics for the polygon drawing tool.
// Pure functions → easy to test.
// ─────────────────────────────────────────────────────────────────────────────

import { CanvasPoint } from './types';

// ── Tunables ──────────────────────────────────────────────────────────────────
export const SNAP_CLOSE_RADIUS  = 22;  // px — auto-close to first point
export const AXIS_SNAP_RATIO    = 0.28; // if dy/dx < ratio -> snap to horizontal
export const CORNER_SNAP_RADIUS = 30;  // px — how close to 90° projection to snap
// Grid size tunables — only affects 3D Magic view (PhotoCanvasWithPolygon).
// Increase GRID_CELL_SIZE for larger squares (easier point placement).
// GRID_SCALE is a developer multiplier: 1 = normal, 2 = double-sized cells.
export const GRID_CELL_SIZE     = 40;  // px — base grid cell size
export const GRID_SCALE         = 1;   // developer multiplier (1 = normal)
export const GRID_SIZE          = GRID_CELL_SIZE * GRID_SCALE; // effective snap cell size

// ── Helpers ───────────────────────────────────────────────────────────────────
function dist(a: CanvasPoint, b: CanvasPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/** Snap p to the nearest grid cell */
function gridSnap(p: CanvasPoint, grid: number): CanvasPoint {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Result of applySnapping */
export interface SnapResult {
  point: CanvasPoint;
  /** True if snap-to-close was triggered (polygon should close) */
  shouldClose: boolean;
  /** Which snap rule fired (for optional debug display) */
  rule: 'none' | 'close' | 'axis' | 'corner' | 'grid';
}

/**
 * Main snapping function. Call this whenever the user places a new point.
 *
 * @param raw       Raw tap position (canvas pixels)
 * @param existing  Already placed points
 * @param useGrid   Whether grid snapping is enabled
 */
export function applySnapping(
  raw: CanvasPoint,
  existing: CanvasPoint[],
  useGrid: boolean,
): SnapResult {
  // ── A) Close-to-first snap ─────────────────────────────────────────────────
  if (existing.length >= 2 && dist(raw, existing[0]) <= SNAP_CLOSE_RADIUS) {
    return { point: existing[0], shouldClose: true, rule: 'close' };
  }

  let pt = { ...raw };

  // ── B) Axis / angle snap (relative to last placed point) ──────────────────
  if (existing.length >= 1) {
    const prev = existing[existing.length - 1];
    const dx   = pt.x - prev.x;
    const dy   = pt.y - prev.y;
    const adx  = Math.abs(dx);
    const ady  = Math.abs(dy);

    if (adx > 0 && ady > 0) {
      if (ady / adx < AXIS_SNAP_RATIO) {
        // Nearly horizontal → lock Y to prev
        pt = { x: pt.x, y: prev.y };
        // Continue to allow corner snap on top
      } else if (adx / ady < AXIS_SNAP_RATIO) {
        // Nearly vertical → lock X to prev
        pt = { x: prev.x, y: pt.y };
      }
    }
  }

  // ── C) 90-degree corner snap ───────────────────────────────────────────────
  if (existing.length >= 2) {
    const prev  = existing[existing.length - 1];
    const pprev = existing[existing.length - 2];

    // Direction vector of the previous segment (pprev→prev), normalized
    const segDx = prev.x - pprev.x;
    const segDy = prev.y - pprev.y;
    const segLen = Math.hypot(segDx, segDy);

    if (segLen > 1) {
      const segNx = segDx / segLen;
      const segNy = segDy / segLen;
      // Perpendicular direction
      const perpNx = -segNy;
      const perpNy =  segNx;
      // Project (prev→pt) onto perpendicular
      const toPtX = pt.x - prev.x;
      const toPtY = pt.y - prev.y;
      const projLen = dot(toPtX, toPtY, perpNx, perpNy);
      const snapX   = prev.x + perpNx * projLen;
      const snapY   = prev.y + perpNy * projLen;
      const snapPt  = { x: snapX, y: snapY };

      if (dist(pt, snapPt) <= CORNER_SNAP_RADIUS) {
        pt = snapPt;
        return applyGridIfNeeded(pt, useGrid, 'corner');
      }
    }
  }

  // ── D) Grid snap ───────────────────────────────────────────────────────────
  if (useGrid) {
    pt = gridSnap(pt, GRID_SIZE);
    return { point: pt, shouldClose: false, rule: 'grid' };
  }

  return { point: pt, shouldClose: false, rule: 'none' };
}

function applyGridIfNeeded(
  pt: CanvasPoint,
  useGrid: boolean,
  rule: SnapResult['rule'],
): SnapResult {
  const point = useGrid ? gridSnap(pt, GRID_SIZE) : pt;
  return { point, shouldClose: false, rule };
}

/**
 * Snap a point DURING DRAG (no close-to-first logic, lighter version).
 */
export function snapDrag(
  raw: CanvasPoint,
  allPoints: CanvasPoint[],
  dragIndex: number,
  useGrid: boolean,
): CanvasPoint {
  // Build fake "existing" without the dragged point so axis snap works vs neighbours
  const prev =
    dragIndex > 0 ? allPoints[dragIndex - 1] : allPoints[allPoints.length - 1];

  let pt = { ...raw };
  const dx  = pt.x - prev.x;
  const dy  = pt.y - prev.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (adx > 0 && ady > 0) {
    if (ady / adx < AXIS_SNAP_RATIO)       pt = { x: pt.x, y: prev.y };
    else if (adx / ady < AXIS_SNAP_RATIO)  pt = { x: prev.x, y: pt.y };
  }

  if (useGrid) pt = gridSnap(pt, GRID_SIZE);
  return pt;
}

/**
 * Build the path for a rectangle from two diagonal corner points.
 * Returns 4 corner points in clockwise order.
 */
export function rectangleFromDiagonal(
  a: CanvasPoint,
  b: CanvasPoint,
): [CanvasPoint, CanvasPoint, CanvasPoint, CanvasPoint] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}
