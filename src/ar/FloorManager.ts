/**
 * src/ar/FloorManager.ts
 *
 * Pure-utility helpers for the Exploded View feature in Procedural3DBuilding.
 * No React, no side-effects — all logic is called directly from the RAF loop
 * or from useEffect hooks in the building component.
 */

import * as THREE from 'three';

// ── Data types ────────────────────────────────────────────────────────────────

export interface FloorGroupData {
  index:  number;
  group:  THREE.Group;
  /** Y position of the group in buildingGroup-local space after centering. */
  baseY:  number;
  /** Every Mesh that belongs to this floor (for ghosting). */
  meshes: THREE.Mesh[];
}

export interface ExplodeTween {
  group:     THREE.Group;
  startY:    number;
  targetY:   number;
  startTime: number;
  duration:  number;
}

// ── Easing ───────────────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// ── Tween builders & tick ─────────────────────────────────────────────────────

/**
 * Build a fresh set of tweens targeting Y = baseY + index * separation.
 * Pass separation=0 to collapse back to original positions.
 */
export function buildExplodeTweens(
  floors:     FloorGroupData[],
  separation: number,
  duration:   number,
  now:        number,
): ExplodeTween[] {
  return floors.map((f) => ({
    group:     f.group,
    startY:    f.group.position.y,
    targetY:   f.baseY + f.index * separation,
    startTime: now,
    duration,
  }));
}

/**
 * Advance all tweens.
 * @returns true while any tween is still running.
 */
export function tickExplodeTweens(
  tweens: ExplodeTween[],
  now:    number,
): boolean {
  let anyActive = false;
  for (const tw of tweens) {
    const raw   = (now - tw.startTime) / tw.duration;
    const t     = Math.min(1, raw);
    tw.group.position.y = tw.startY + (tw.targetY - tw.startY) * easeInOut(t);
    if (raw < 1) anyActive = true;
  }
  return anyActive;
}

// ── Ghost material cache ──────────────────────────────────────────────────────

/**
 * Clone a material (or array) into a ghost version.
 * Results are cached by `${uuid}_${opacity}` so we never clone on every frame.
 */
function getOrCreateGhost(
  mat:     THREE.Material,
  opacity: number,
  cache:   Map<string, THREE.Material>,
): THREE.Material {
  const key    = `${mat.uuid}_${opacity}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const ghost = mat.clone() as THREE.MeshStandardMaterial;
  ghost.transparent  = true;
  ghost.opacity      = opacity;
  ghost.depthWrite   = false;
  if (ghost.emissive) ghost.emissive.setHex(0x000000);
  ghost.emissiveIntensity = 0;
  cache.set(key, ghost);
  return ghost;
}

// ── Floor selection (ghost / restore) ─────────────────────────────────────────

/**
 * Apply ghosting to every floor that is NOT selected.
 * Selected floor (or 'all') gets its original materials restored.
 *
 * Materials are cloned on first ghost and cached — no clone per frame.
 * Original materials are stored in `origMatMap` so they can be restored.
 */
export function applyFloorSelection(
  floors:      FloorGroupData[],
  selected:    number | 'all',
  ghostOpacity: number,
  ghostCache:  Map<string, THREE.Material>,
  origMatMap:  Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
): void {
  for (const fl of floors) {
    const isSelected = selected === 'all' || fl.index === selected;

    for (const mesh of fl.meshes) {
      if (isSelected) {
        // Restore original material
        const orig = origMatMap.get(mesh);
        if (orig !== undefined) {
          mesh.material = orig;
          origMatMap.delete(mesh);
        }
      } else {
        // Save original and apply ghost
        if (!origMatMap.has(mesh)) {
          origMatMap.set(mesh, mesh.material);
        }

        const mats  = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const ghosts = mats.map((m) => getOrCreateGhost(m, ghostOpacity, ghostCache));
        mesh.material = ghosts.length === 1 ? ghosts[0] : ghosts;
      }
    }
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Restore all original materials, dispose ghost clones, reset floor Y positions.
 * Call this when buildGeometry() re-runs or the component unmounts.
 */
export function cleanupFloorManager(
  floors:     FloorGroupData[],
  ghostCache: Map<string, THREE.Material>,
  origMatMap: Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
): void {
  // Restore original materials
  for (const [mesh, orig] of origMatMap) {
    mesh.material = orig;
  }
  origMatMap.clear();

  // Dispose ghost clones
  for (const ghost of ghostCache.values()) {
    ghost.dispose();
  }
  ghostCache.clear();

  // Reset floor Y to their base positions
  for (const fl of floors) {
    fl.group.position.y = fl.baseY;
    fl.group.updateMatrixWorld(false);
  }
}
