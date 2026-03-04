/**
 * src/ar/TouchRaycaster.ts
 *
 * Lightweight raycasting utility for 3D-Magic touch interactions.
 * Designed to be used with a pre-cached flat mesh list — no per-call traversal.
 */

import * as THREE from 'three';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface RaycastHit {
  /** The mesh that was hit. */
  mesh: THREE.Mesh;
  /** World-space intersection point. */
  point: THREE.Vector3;
  /** Floor index if the mesh was found in the floorMeshMap, else null. */
  floorIndex: number | null;
}

// ── NDC helper ────────────────────────────────────────────────────────────────
/**
 * Convert view-local (px) to NDC ∈ [−1, 1]².
 * @param lx  Touch x relative to the GL view's top-left.
 * @param ly  Touch y relative to the GL view's top-left.
 */
export function screenToNDC(
  lx: number,
  ly: number,
  viewW: number,
  viewH: number,
): THREE.Vector2 {
  return new THREE.Vector2(
    (lx / viewW) * 2 - 1,
    -((ly / viewH) * 2 - 1),
  );
}

// ── Raycast helper ────────────────────────────────────────────────────────────
/**
 * Cast from camera through ndc into meshList.
 * Returns the closest hit with floorIndex resolved from floorMeshMap, or null.
 */
export function castRay(
  ndc: THREE.Vector2,
  camera: THREE.Camera,
  meshList: THREE.Mesh[],
  floorMeshMap: Map<string, number>,
  raycaster: THREE.Raycaster,
): RaycastHit | null {
  if (meshList.length === 0) return null;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(meshList, false);
  if (!hits.length) return null;
  const h = hits[0];
  const mesh = h.object as THREE.Mesh;
  return {
    mesh,
    point:      h.point.clone(),
    floorIndex: floorMeshMap.get(mesh.uuid) ?? null,
  };
}

// ── Ground-plane intersection ─────────────────────────────────────────────────
/**
 * Intersect the camera ray (aimed at ndc) with the horizontal plane y=planeY.
 * Returns hit point or null if ray is nearly parallel to the plane.
 */
export function intersectGroundPlane(
  ndc: THREE.Vector2,
  camera: THREE.Camera,
  planeY: number,
  raycaster: THREE.Raycaster,
): THREE.Vector3 | null {
  raycaster.setFromCamera(ndc, camera);
  const plane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const target = new THREE.Vector3();
  const result = raycaster.ray.intersectPlane(plane, target);
  return result ? target.clone() : null;
}
