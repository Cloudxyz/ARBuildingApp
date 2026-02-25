// ─────────────────────────────────────────────────────────────────────────────
// src/magic/types.ts
// Shared types for the 3D Magic screen
// ─────────────────────────────────────────────────────────────────────────────

/** A 2-D point in canvas-pixel space */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** A 2-D point normalized to [0..1] relative to the canvas dimensions */
export interface NormPoint {
  x: number; // 0 = left edge, 1 = right edge
  y: number; // 0 = top edge,  1 = bottom edge
}

/** State produced by PhotoCanvasWithPolygon */
export interface PolygonState {
  /** Raw pixel points in canvas space (not normalized) */
  points: CanvasPoint[];
  /** Whether the polygon has been closed */
  closed: boolean;
}

/** Config passed from polygon editor to the 3D renderer */
export interface BuildingFootprintConfig {
  /** Normalized polygon points (0..1 relative to the image rect) */
  normPoints: NormPoint[];
  /** Number of floors to extrude */
  floorCount: number;
  /** Height of each floor in scene units (≈ meters) */
  floorHeightM: number;
  /** Scale applied to the XZ footprint */
  footprintScale: number;
  /**
   * Height / width of the image rect (used to convert UV → world XZ correctly).
   * Defaults to 1 if omitted.
   */
  imageAspect?: number;
}

/** Screen phases for Magic3DScreen */
export type MagicPhase =
  | 'pick'       // Choose photo source
  | 'polygon'    // Draw polygon on photo
  | '3d';        // Show 3D building on photo
