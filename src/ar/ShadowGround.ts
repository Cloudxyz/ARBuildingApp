/**
 * src/ar/ShadowGround.ts
 *
 * Realistic ground shadows for the 3D Magic procedural building.
 * Pure utility — no React, no side-effects of its own.
 *
 * Strategy
 * ────────
 * Three.js shadow maps work by rendering the scene from the directional
 * light's perspective using an orthographic frustum.  The default frustum
 * bounds (-5 to +5 on each axis) are far too small for a building that may
 * span 20 × 20 scene units, so the shadow is invisible or heavily clipped.
 *
 * This module:
 *  1.  Receives the existing DirectionalLight created in onContextCreate.
 *  2.  Computes the building's Box3 and fits the shadow camera frustum to it
 *      (with generous padding so the shadow tail is never cut off).
 *  3.  Adds a smaller "contact shadow" plane right under the building footprint
 *      at slightly higher opacity — the classic cheap trick that sells
 *      the "grounded" feeling without post-processing.
 *  4.  Returns `refresh(buildingGroup)` which reconfigures the shadow camera
 *      after every buildGeometry() call, and `cleanup()` for unmount.
 *
 * The large ShadowMaterial plane (200 × 200) that is already in the scene
 * is kept as-is; we only configure the shadow light camera and add the
 * contact plane.
 */

import * as THREE from 'three';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShadowGroundOptions {
  scene:         THREE.Scene;
  sunLight:      THREE.DirectionalLight;  // the existing castShadow=true light
  buildingGroup: THREE.Group;             // root group to measure bounds from
}

export interface ShadowGroundHandle {
  /**
   * Call after every buildGeometry() to re-fit shadow camera to new bounds.
   * Pass the (possibly new) buildingGroup ref.
   */
  refresh: (buildingGroup: THREE.Group) => void;
  /** Remove contact plane and detach from scene. Call on GL context teardown. */
  cleanup: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** How much extra space (scene units) to add around the bb on each side.
 *  Larger = shadow tail is never clipped; but wastes some shadow map resolution. */
const FRUSTUM_PADDING = 18;

/** Opacity of the soft drop-shadow directly under the building. */
const CONTACT_OPACITY = 0.48;

/** Extra Y above the main ground plane to avoid z-fighting. */
const CONTACT_Y_OFFSET = 0.02;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fitShadowCameraToBuilding(
  sunLight:     THREE.DirectionalLight,
  buildingGroup: THREE.Group,
): void {
  const bbox = new THREE.Box3().setFromObject(buildingGroup, true);
  if (bbox.isEmpty()) return;

  // We need the frustum in the light's local coordinate space.
  // Approximate: compute world-space extents and transform to light space.
  const center = bbox.getCenter(new THREE.Vector3());
  const size   = bbox.getSize(new THREE.Vector3());

  // The ground shadow spreads diagonally based on sun elevation.
  // Use the longest horizontal diagonal + building height as the conservative radius.
  const diagH  = Math.hypot(size.x, size.z);
  const half   = diagH / 2 + FRUSTUM_PADDING + size.y * 0.6; // include shadow tail

  sunLight.shadow.camera.left   = -half;
  sunLight.shadow.camera.right  =  half;
  sunLight.shadow.camera.top    =  half;
  sunLight.shadow.camera.bottom = -half;

  // Near / far in light space should cover the tallest building + some clearance
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far  = Math.max(80, size.y * 4 + FRUSTUM_PADDING * 2 + 40);

  // Target the light at the building center so shadow map resolution is maximised.
  sunLight.target.position.copy(center);
  sunLight.target.updateMatrixWorld();

  sunLight.shadow.camera.updateProjectionMatrix();

  // Mark shadow map dirty so it re-renders at new settings.
  sunLight.shadow.needsUpdate = true;
}

function buildContactPlane(footprintW: number, footprintD: number): THREE.Mesh {
  // Slightly larger than the footprint to cover any geometry rounding.
  const w   = Math.max(4, footprintW * 1.15);
  const d   = Math.max(4, footprintD * 1.15);
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShadowMaterial({
    opacity:   CONTACT_OPACITY,
    depthWrite: false,
    transparent: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow    = false;
  // Name it so buildGeometry / FloorManager traversals can skip it.
  mesh.name = '__shadowContact';
  return mesh;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function createShadowGround(opts: ShadowGroundOptions): ShadowGroundHandle {
  const { scene, sunLight, buildingGroup } = opts;

  // Lower shadow map resolution from 2048 to 1024 — sufficient at these scales
  // and saves significant GPU memory on mobile.  Done once here so callers
  // don't have to.
  if (sunLight.shadow.mapSize.width > 1024 || sunLight.shadow.mapSize.height > 1024) {
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.map?.dispose();
    // @ts-ignore — null is intentional: THREE re-creates it on next render
    sunLight.shadow.map = null;
  }

  // Fine-tune shadow bias to avoid acne / Peter-panning for a tile-scale scene.
  sunLight.shadow.bias       = -0.0008;
  sunLight.shadow.normalBias =  0.02;

  // Initial shadow camera fit
  fitShadowCameraToBuilding(sunLight, buildingGroup);

  // Contact shadow plane — sized to initial building footprint
  const bbox  = new THREE.Box3().setFromObject(buildingGroup, true);
  const size  = bbox.isEmpty()
    ? new THREE.Vector3(10, 1, 10)
    : bbox.getSize(new THREE.Vector3());
  const baseY = bbox.isEmpty() ? 0 : bbox.min.y;

  const contactMesh = buildContactPlane(size.x, size.z);
  // Place at the building floor level (+ small ε) so it's above the large catcher.
  contactMesh.position.set(0, baseY + CONTACT_Y_OFFSET, 0);
  scene.add(contactMesh);

  return {
    refresh(newGroup: THREE.Group) {
      fitShadowCameraToBuilding(sunLight, newGroup);

      // Reposition contact plane to match new building footprint & base Y
      const nb   = new THREE.Box3().setFromObject(newGroup, true);
      if (nb.isEmpty()) return;
      const ns   = nb.getSize(new THREE.Vector3());
      const ny   = nb.min.y;
      const newW = Math.max(4, ns.x * 1.15);
      const newD = Math.max(4, ns.z * 1.15);

      // Re-create geometry so the size matches precisely.
      contactMesh.geometry.dispose();
      const geo = new THREE.PlaneGeometry(newW, newD);
      geo.rotateX(-Math.PI / 2);
      contactMesh.geometry = geo;
      contactMesh.position.set(0, ny + CONTACT_Y_OFFSET, 0);
    },

    cleanup() {
      scene.remove(contactMesh);
      contactMesh.geometry.dispose();
      (contactMesh.material as THREE.Material).dispose();
    },
  };
}
