/**
 * src/ar/CinematicCameraController.ts
 *
 * Runs a two-phase cinematic sequence after a building finishes constructing:
 *   Phase 1 — "framing tween": smoothly moves the camera to a comfortable
 *              distance and gentle elevation facing the building center.
 *   Phase 2 — "orbit": slowly rotates around the building for a few seconds.
 *
 * Design notes
 * ─────────────
 * The building's RAF loop already reads `azimuthRef`, `elevationRef`,
 * `distRef` and `cameraTargetRef` every frame.  The controller only needs
 * to *mutate those same refs* on each tick — no separate animation loop
 * is required.  Tick() must be called from inside the existing animate().
 *
 * All mutable state lives inside a plain object (`state`) stored on the
 * class instance.  Three.js types are used for math only — nothing is
 * added to the scene.
 */

import * as THREE from 'three';

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'framing' | 'orbiting';

interface CinematicRefs {
  azimuthRef:      React.MutableRefObject<number>;
  elevationRef:    React.MutableRefObject<number>;
  distRef:         React.MutableRefObject<number>;
  baseDistRef:     React.MutableRefObject<number>;
  cameraTargetRef: React.MutableRefObject<THREE.Vector3>;
  buildingGroupRef: React.MutableRefObject<THREE.Group | null>;
}

// ── Tunables ─────────────────────────────────────────────────────────────────

const FRAMING_DURATION_MS = 700;  // ms for the fit-to-view tween
const ORBIT_DURATION_MS   = 4200; // ms of slow auto-orbit after framing

/** Azimuth advance per second during orbit (radians). Lower = more premium. */
const ORBIT_SPEED_RAD_S   = 0.22;

/**  Elevation target: ~20° above horizon in radians. */
const CINEMA_ELEVATION    = 0.36;

/** Padding multiplier applied to bounding-sphere radius when computing ideal dist. */
const FRAMING_PADDING     = 2.2;

// ── Helpers ──────────────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** Wraps angle difference to [-π, +π] so tweening always takes the short path. */
function shortAngle(from: number, to: number): number {
  let diff = ((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return diff;
}

// ── Controller ───────────────────────────────────────────────────────────────

export class CinematicCameraController {
  private refs:  CinematicRefs;
  private phase: Phase = 'idle';

  // Framing tween state
  private framingStartMs  = 0;
  private startDist       = 30;
  private targetDist      = 30;
  private startAz         = 0;
  private deltaAz         = 0;   // short-path delta so we don't spin the long way
  private startEl         = 0;
  private targetEl        = 0;
  private startTarget     = new THREE.Vector3();
  private targetTarget    = new THREE.Vector3();

  // Orbit state
  private orbitStartMs    = 0;
  private orbitStartAz    = 0;

  constructor(refs: CinematicRefs) {
    this.refs = refs;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Call after build animation fires onBuildComplete. */
  runFramingAndOrbit(): void {
    const group = this.refs.buildingGroupRef.current;
    if (!group) return;

    const bbox = new THREE.Box3().setFromObject(group, true);
    if (bbox.isEmpty()) return;

    const center = bbox.getCenter(new THREE.Vector3());
    const size   = bbox.getSize(new THREE.Vector3());
    const radius = Math.sqrt(
      (size.x / 2) ** 2 + (size.y / 2) ** 2 + (size.z / 2) ** 2,
    );

    const idealDist = Math.max(5, radius * FRAMING_PADDING);

    // Snapshot current camera state
    this.startDist   = this.refs.distRef.current;
    this.targetDist  = idealDist;
    this.startAz     = this.refs.azimuthRef.current;
    this.deltaAz     = shortAngle(this.startAz, this.startAz); // don't move azimuth — keep current heading
    this.startEl     = this.refs.elevationRef.current;
    this.targetEl    = CINEMA_ELEVATION;
    this.startTarget.copy(this.refs.cameraTargetRef.current);
    this.targetTarget.copy(center);

    this.framingStartMs = performance.now();
    this.phase = 'framing';
  }

  /**
   * Cancel cinematic and return full control.
   * Safe to call at any time (even when idle).
   */
  cancel(): void {
    this.phase = 'idle';
  }

  /** Call from the gesture-start handler to immediately hand back control. */
  onUserInteractionStart(): void {
    this.cancel();
  }

  /** Must be called every frame from inside the existing animate() loop.
   *  @param nowMs  - `time` value from rAF (milliseconds)
   *  @param dt     - frame delta in seconds (capped, same as building loop)
   *  Returns true while the cinematic is running. */
  tick(nowMs: number, dt: number): boolean {
    if (this.phase === 'idle') return false;

    if (this.phase === 'framing') {
      const elapsed = nowMs - this.framingStartMs;
      const raw     = Math.min(1, elapsed / FRAMING_DURATION_MS);
      const t       = easeInOut(raw);

      this.refs.distRef.current =
        this.startDist + (this.targetDist - this.startDist) * t;

      this.refs.azimuthRef.current =
        this.startAz + this.deltaAz * t;

      this.refs.elevationRef.current =
        this.startEl + (this.targetEl - this.startEl) * t;

      this.refs.cameraTargetRef.current.lerpVectors(
        this.startTarget, this.targetTarget, t,
      );

      if (raw >= 1) {
        // Framing done — start orbit
        this.orbitStartMs  = nowMs;
        this.orbitStartAz  = this.refs.azimuthRef.current;
        this.phase         = 'orbiting';
      }
      return true;
    }

    if (this.phase === 'orbiting') {
      const elapsed = nowMs - this.orbitStartMs;
      if (elapsed >= ORBIT_DURATION_MS) {
        this.phase = 'idle';
        // Update baseDistRef so zoom limits are recalculated around new distance
        this.refs.baseDistRef.current = this.refs.distRef.current;
        return false;
      }
      const safeDt = (dt > 0 && dt < 0.2) ? dt : 1 / 60;
      this.refs.azimuthRef.current -= ORBIT_SPEED_RAD_S * safeDt;
      return true;
    }

    return false;
  }

  get isRunning(): boolean {
    return this.phase !== 'idle';
  }

  cleanup(): void {
    this.phase = 'idle';
  }
}
