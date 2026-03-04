/**
 * src/magic/Procedural3DBuilding.tsx
 *
 * Renders a procedural building extruded from a polygon footprint.
 * Uses expo-gl + expo-three + THREE.js.
 *
 * Gestures (self-contained PanResponder, captures before parents):
 *   1 finger drag  → orbit building (azimuth / elevation)
 *   pinch          → zoom (orbit distance)
 *   2 finger drag  → pan camera target (XZ + Y)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { BuildingFootprintConfig } from './types';
import { polygonToFootprint } from './PolygonToFootprint';
import { loadBuildingTextures, BuildingTextures } from './buildingTextures';
import {
  type FloorGroupData,
  type ExplodeTween,
  buildExplodeTweens,
  tickExplodeTweens,
  applyFloorSelection,
  cleanupFloorManager,
} from '../ar/FloorManager';
import { CinematicCameraController } from '../ar/CinematicCameraController';
import { screenToNDC, castRay, intersectGroundPlane } from '../ar/TouchRaycaster';

// ── Tunables ──────────────────────────────────────────────────────────────────
const FLOOR_BUILD_SEC  = 0.8 / 4;   // match 3D View effective speed (default buildSpeed=4)
const SCANLINE_OPACITY = 0.20;
const DEFAULT_AZIMUTH   = 0;
const DEFAULT_ELEVATION = 0;
const CAMERA_FIT_PADDING = 4.4; // higher = less zoom
const ZOOM_STEP_BASE = 1.2;
const ZOOM_HOLD_SPEED_BASE = 3.0;

// UV tiling repeat for PBR textures (higher = smaller tiles on facade)
const TEXTURE_SCALE = 4;
const TEXTURE_REPEAT_MIN = 14;
const TEXTURE_REPEAT_MAX = 42;
const MAGIC_VISUAL_CENTER_NDC_X = 0;
const MAGIC_VISUAL_CENTER_NDC_Y = 0;

// Set to true during development to see a red sphere at the polygon centroid
const DEBUG_CENTROID = false;

function improveTextureQuality(
  renderer: THREE.WebGLRenderer,
  tex: THREE.Texture,
): void {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy
    ? renderer.capabilities.getMaxAnisotropy()
    : 1;
  tex.anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
}

function improveTextureSet(
  renderer: THREE.WebGLRenderer,
  set: BuildingTextures,
): void {
  improveTextureQuality(renderer, set.albedo);
  improveTextureQuality(renderer, set.ao);
  improveTextureQuality(renderer, set.normal);
  improveTextureQuality(renderer, set.roughness);
}

function computeAdaptiveTextureRepeat(
  points: Array<{ x: number; z: number }>,
  totalHeight: number,
): number {
  if (points.length < 2) return TEXTURE_SCALE;

  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    perimeter += Math.hypot(b.x - a.x, b.z - a.z);
  }

  const avgEdge = perimeter / points.length;
  const fromPlan = avgEdge * 2.1;
  const fromHeight = totalHeight * 0.7;
  const target = Math.max(fromPlan, fromHeight);

  return THREE.MathUtils.clamp(target, TEXTURE_REPEAT_MIN, TEXTURE_REPEAT_MAX);
}

function applyTextureRepeat(set: BuildingTextures, repeat: number): void {
  for (const tex of [set.albedo, set.ao, set.normal, set.roughness]) {
    tex.repeat.set(repeat, repeat);
    tex.needsUpdate = true;
  }
}

function computePolygonCentroidXZ(
  points: Array<{ x: number; z: number }>,
): { x: number; z: number } {
  if (points.length === 0) return { x: 0, z: 0 };
  if (points.length < 3) {
    let sx = 0;
    let sz = 0;
    for (const p of points) {
      sx += p.x;
      sz += p.z;
    }
    return { x: sx / points.length, z: sz / points.length };
  }

  let area2 = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.z - b.x * a.z;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  if (Math.abs(area2) < 1e-6) {
    let sx = 0;
    let sz = 0;
    for (const p of points) {
      sx += p.x;
      sz += p.z;
    }
    return { x: sx / points.length, z: sz / points.length };
  }

  const inv = 1 / (3 * area2);
  return { x: cx * inv, z: cz * inv };
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Procedural3DBuildingProps {
  config: BuildingFootprintConfig;
  isPlaying: boolean;
  animKey: number;
  cameraResetKey?: number;
  active?: boolean;
  interactionMode?: 'camera' | 'moveModel';
  onDebugMetrics?: (metrics: Procedural3DDebugMetrics) => void;
  zoomCommandId?: number;
  zoomCommandDir?: 'in' | 'out';
  zoomHoldDir?: -1 | 0 | 1;
  onZoomMetrics?: (metrics: {
    zoomValue: number;
    canZoomIn: boolean;
    canZoomOut: boolean;
  }) => void;
  /** Called once when the build animation reaches 100%. */
  onBuildComplete?: () => void;
  /** Zoom factor applied immediately after the building geometry is framed (and on reset). Default: 1 (no extra zoom). */
  initialZoom?: number;
  /** Button-hold direction for azimuth (camera mode) / model-Y rotation (moveModel mode). */
  manualAzimuthDir?: -1 | 0 | 1;
  /** Button-hold direction for elevation (camera mode) / model-X rotation (moveModel mode). */
  manualElevationDir?: -1 | 0 | 1;
  /** Button-hold direction to translate the model/camera target vertically (+Y / -Y). */
  manualMoveYDir?: -1 | 0 | 1;
  /** When true, PanResponder touch gestures are disabled. */
  gesturesDisabled?: boolean;
  /** When true, floors animate apart vertically (Exploded View). */
  explodeEnabled?: boolean;
  /** Vertical gap added between floors when exploded, in scene units (metres). */
  explodeSeparation?: number;
  /** Which floor index to highlight; others are ghosted. 'all' = no isolation. */
  selectedFloor?: number | 'all';
  /** Fired when user taps a floor mesh. Passes the selected floorIndex or 'all' to deselect. */
  onFloorSelect?: (floor: number | 'all') => void;
  /** Fired once after buildGeometry() completes with the current floor count. */
  onFloorGroupsReady?: (count: number) => void;
}

export interface Procedural3DDebugMetrics {
  glViewWidth: number;
  glViewHeight: number;
  glCenterX: number;
  glCenterY: number;
  modelScreenX: number;
  modelScreenY: number;
  modelRectX: number;
  modelRectY: number;
  modelRectW: number;
  modelRectH: number;
  modelWorldX: number;
  modelWorldY: number;
  modelWorldZ: number;
  buildingCordsScreenX: number;
  buildingCordsScreenY: number;
  buildingCordsX: number;
  buildingCordsY: number;
  buildingCordsZ: number;
}

// ── Camera helpers ────────────────────────────────────────────────────────────
function updateCamera(
  cam: THREE.PerspectiveCamera,
  dist: number,
  az: number,
  el: number,
  target: THREE.Vector3,
): void {
  const cosEl = Math.cos(el);
  cam.position.set(
    target.x + dist * cosEl * Math.sin(az),
    target.y + dist * Math.sin(el),
    target.z + dist * cosEl * Math.cos(az),
  );
  cam.lookAt(target);
}

function frameCameraOnRadius(
  cam: THREE.PerspectiveCamera,
  radius: number,
  az: number,
  el: number,
  target: THREE.Vector3,
): number {
  const fovR = (cam.fov * Math.PI) / 180;
  const dist = Math.max(3.5, (radius * CAMERA_FIT_PADDING) / Math.tan(fovR / 2));
  updateCamera(cam, dist, az, el, target);
  return dist;
}

function getBBoxNdcCenter(
  cam: THREE.PerspectiveCamera,
  bbox: THREE.Box3,
): { x: number; y: number } {
  const corners = [
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z),
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    c.project(cam);
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 };
}

function getBBoxScreenRect(
  cam: THREE.PerspectiveCamera,
  bbox: THREE.Box3,
  viewW: number,
  viewH: number,
): { x: number; y: number; w: number; h: number } | null {
  const corners = [
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z),
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let hasValid = false;

  for (const c of corners) {
    c.project(cam);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    hasValid = true;
    const sx = (c.x * 0.5 + 0.5) * viewW;
    const sy = (-c.y * 0.5 + 0.5) * viewH;
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }

  if (!hasValid) return null;
  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  };
}

function centerTargetByBBoxProjection(
  cam: THREE.PerspectiveCamera,
  bbox: THREE.Box3,
  dist: number,
  az: number,
  el: number,
  target: THREE.Vector3,
  desiredNdcX: number = 0,
  desiredNdcY: number = 0,
): void {
  const fovR = (cam.fov * Math.PI) / 180;
  const halfH = Math.tan(fovR / 2) * dist;
  const halfW = halfH * cam.aspect;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  for (let i = 0; i < 2; i++) {
    updateCamera(cam, dist, az, el, target);
    cam.updateMatrixWorld();

    const ndcCenter = getBBoxNdcCenter(cam, bbox);
    if (!Number.isFinite(ndcCenter.x) || !Number.isFinite(ndcCenter.y)) break;
    const errX = ndcCenter.x - desiredNdcX;
    const errY = ndcCenter.y - desiredNdcY;
    if (Math.abs(errX) < 0.002 && Math.abs(errY) < 0.002) break;

    right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();

    target.addScaledVector(right, errX * halfW);
    target.addScaledVector(up, errY * halfH);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export const Procedural3DBuilding: React.FC<Procedural3DBuildingProps> = ({
  config,
  isPlaying,
  animKey,
  cameraResetKey,
  active = true,
  interactionMode = 'camera',
  onDebugMetrics,
  zoomCommandId = 0,
  zoomCommandDir = 'in',
  zoomHoldDir = 0,
  onZoomMetrics,
  onBuildComplete,
  initialZoom = 1,
  manualAzimuthDir = 0,
  manualElevationDir = 0,
  manualMoveYDir = 0,
  gesturesDisabled = false,
  explodeEnabled = false,
  explodeSeparation = 0,
  selectedFloor = 'all' as number | 'all',
  onFloorGroupsReady,
  onFloorSelect,
}) => {
  const [glReady, setGlReady] = useState(false);
  const [isWarmingUp, setIsWarmingUp] = useState(false);
  /** Incremented to force GLView remount when the GL context was lost during inactivity. */
  const [glKey, setGlKey] = useState(0);
  /** True while GLView is remounting after a context-loss recovery (shows "Restoring 3D…"). */
  const [isRestoring, setIsRestoring] = useState(false);

  const raffRef      = useRef<number>(0);
  /** Set true whenever a GL render error occurs; triggers remount on next focus. */
  const contextLostRef = useRef(false);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isActiveRef  = useRef(active);
  const warmupPendingRef = useRef(false);
  const configRef    = useRef(config);
  const animKeyRef   = useRef(animKey);
  const buildTRef    = useRef(0);
  const contextSessionRef = useRef(0);

  const azimuthRef      = useRef(DEFAULT_AZIMUTH);
  const elevationRef    = useRef(DEFAULT_ELEVATION);
  const distRef         = useRef(30);
  const baseDistRef     = useRef(30);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  // Stores the world-space centroid so resetCamera() can return to the right spot
  const centroidRef     = useRef(new THREE.Vector3(0, 0, 0));
  const pinchDistRef    = useRef(0);
  const lastMidRef      = useRef({ x: 0, y: 0 });
  const lastTouchRef    = useRef({ x: 0, y: 0 });

  // ── Scene-object refs (allow rebuild without recreating GL context) ────────
  const sceneRef         = useRef<THREE.Scene | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const baseGroupPosRef  = useRef(new THREE.Vector3(0, 0, 0));
  const coreMeshRef      = useRef<THREE.Mesh | null>(null);
  const clipPlaneRef     = useRef<THREE.Plane | null>(null);
  const totalHRef        = useRef(0);
  const scanlineRef      = useRef<THREE.Mesh | null>(null);
  const scanlineMatRef   = useRef<THREE.MeshBasicMaterial | null>(null);
  const buildingMarkerRef = useRef<THREE.LineSegments | null>(null);
  const texRef           = useRef<BuildingTextures | null>(null);
  const rendererRef      = useRef<THREE.WebGLRenderer | null>(null);
  const layoutSizeRef    = useRef({ width: 0, height: 0 });
  const forceResizeRef   = useRef(false); // set true on focus-return to force viewport refresh
  const metricsTimeRef   = useRef(0);
  const onDebugMetricsRef = useRef(onDebugMetrics);
  const onZoomMetricsRef = useRef(onZoomMetrics);
  const onBuildCompleteRef = useRef(onBuildComplete);
  const zoomCommandIdRef = useRef(zoomCommandId);
  const zoomCommandDirRef = useRef<'in' | 'out'>(zoomCommandDir);
  const zoomHoldDirRef = useRef<-1 | 0 | 1>(zoomHoldDir);
  const zoomLimitsRef = useRef({ canZoomIn: true, canZoomOut: true });
  const lastZoomReportRef = useRef({
    zoomValue: NaN,
    canZoomIn: true,
    canZoomOut: true,
  });
  const initialZoomRef        = useRef(initialZoom);
  const manualAzimuthDirRef   = useRef<-1 | 0 | 1>(0);
  const manualElevationDirRef = useRef<-1 | 0 | 1>(0);
  const manualMoveYDirRef     = useRef<-1 | 0 | 1>(0);
  const gesturesDisabledRef   = useRef(false);
  // ── Floor Manager refs ──────────────────────────────────────────────────
  const floorGroupsRef       = useRef<FloorGroupData[]>([]);
  const explodeTweensRef     = useRef<ExplodeTween[]>([]);
  const ghostMatCacheRef     = useRef<Map<string, THREE.Material>>(new Map());
  const origMatMapRef        = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  const explodeEnabledRef    = useRef(explodeEnabled);
  const explodeSeparationRef = useRef(explodeSeparation);
  const selectedFloorRef     = useRef<number | 'all'>(selectedFloor);
  const onFloorGroupsReadyRef = useRef<((count: number) => void) | undefined>(onFloorGroupsReady);
  // ── Cinematic camera refs ───────────────────────────────────────────────
  const cinematicRef         = useRef<CinematicCameraController | null>(null);
  const cinematicWasActiveRef = useRef(false);
  const cinematicFiredRef    = useRef(false); // guard: fire once per build
  const [cinematicActive, setCinematicActive] = useState(false);
  // ── Touch interaction refs (tap / double-tap / long-press / ground move) ───────────
  const raycasterRef      = useRef(new THREE.Raycaster());
  const tapRef            = useRef({ t0: 0, x0: 0, y0: 0, moved: false, active: false, fingerCount: 1 });
  const doubleTapRef      = useRef({ lastT: 0, lastX: 0, lastY: 0 });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveModeRef       = useRef(false);
  const moveGrabRef       = useRef({ offsetX: 0, offsetZ: 0 });
  const floorMeshMapRef   = useRef<Map<string, number>>(new Map());
  const focusTweenRef     = useRef<{
    sT:    THREE.Vector3; eT:    THREE.Vector3;
    sDist: number;        eDist: number;
    sEl:   number;        eEl:   number;
    prog:  number;        dur:   number;
  } | null>(null);
  const onFloorSelectRef  = useRef(onFloorSelect);
  const [showMoveHint, setShowMoveHint] = useState(false);
  const wasActiveRef      = useRef(active);
  const latestMetricsRef  = useRef<Procedural3DDebugMetrics | null>(null);
  const movedModelInGestureRef = useRef(false);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isActiveRef.current  = active;    }, [active]);
  useEffect(() => { configRef.current    = config;    }, [config]);
  useEffect(() => { onDebugMetricsRef.current = onDebugMetrics; }, [onDebugMetrics]);
  useEffect(() => { onZoomMetricsRef.current = onZoomMetrics; }, [onZoomMetrics]);
  useEffect(() => { zoomCommandIdRef.current = zoomCommandId; }, [zoomCommandId]);
  useEffect(() => { zoomCommandDirRef.current = zoomCommandDir; }, [zoomCommandDir]);
  useEffect(() => { zoomHoldDirRef.current = zoomHoldDir; }, [zoomHoldDir]);
  useEffect(() => { initialZoomRef.current        = initialZoom; }, [initialZoom]);
  useEffect(() => { manualAzimuthDirRef.current   = manualAzimuthDir   as (-1 | 0 | 1); }, [manualAzimuthDir]);
  useEffect(() => { manualElevationDirRef.current = manualElevationDir as (-1 | 0 | 1); }, [manualElevationDir]);
  useEffect(() => { manualMoveYDirRef.current     = manualMoveYDir     as (-1 | 0 | 1); }, [manualMoveYDir]);
  useEffect(() => { gesturesDisabledRef.current   = gesturesDisabled; }, [gesturesDisabled]);
  useEffect(() => { explodeEnabledRef.current     = explodeEnabled; }, [explodeEnabled]);
  useEffect(() => { explodeSeparationRef.current  = explodeSeparation; }, [explodeSeparation]);
  useEffect(() => { selectedFloorRef.current      = selectedFloor; }, [selectedFloor]);
  useEffect(() => { onFloorGroupsReadyRef.current = onFloorGroupsReady; }, [onFloorGroupsReady]);
  useEffect(() => { onFloorSelectRef.current = onFloorSelect; }, [onFloorSelect]);

  // Create the CinematicCameraController once (refs are stable so this is safe)
  useEffect(() => {
    cinematicRef.current = new CinematicCameraController({
      azimuthRef,
      elevationRef,
      distRef,
      baseDistRef,
      cameraTargetRef,
      buildingGroupRef,
    });
    return () => {
      cinematicRef.current?.cleanup();
      cinematicRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger explode / collapse tweens when enabled state or separation changes
  useEffect(() => {
    const floors = floorGroupsRef.current;
    if (!floors.length) return;
    const sep = explodeEnabled ? explodeSeparation : 0;
    explodeTweensRef.current = buildExplodeTweens(floors, sep, 380, performance.now());
  }, [explodeEnabled, explodeSeparation]);

  // Apply floor selection (ghosting) when selectedFloor changes
  useEffect(() => {
    applyFloorSelection(
      floorGroupsRef.current,
      selectedFloor,
      0.22,
      ghostMatCacheRef.current,
      origMatMapRef.current,
    );
  }, [selectedFloor]);

  // Cleanup FloorManager on unmount
  useEffect(() => () => {
    cleanupFloorManager(floorGroupsRef.current, ghostMatCacheRef.current, origMatMapRef.current);
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  useEffect(() => {
    if (active) {
      if (contextLostRef.current) {
        // GL context was lost while the component was inactive (common on Android).
        // Remount the GLView to get a fresh context + full scene rebuild.
        contextLostRef.current = false;
        setIsRestoring(true);
        setGlReady(false);
        setGlKey(k => k + 1);
      } else {
        warmupPendingRef.current = true;
        forceResizeRef.current   = true; // re-apply viewport after tab-focus-return
        setIsWarmingUp(true);
      }
    } else {
      warmupPendingRef.current = false;
      setIsWarmingUp(false);
    }
  }, [active]);
  useEffect(() => {
    if (animKeyRef.current !== animKey) {
      animKeyRef.current = animKey;
      buildTRef.current  = 0;
    }
  }, [animKey]);

  const applyZoomStep = useCallback((zoomIn: boolean) => {
    const step = Math.max(ZOOM_STEP_BASE, distRef.current * 0.12);
    const next = zoomIn ? distRef.current - step : distRef.current + step;
    const minDist = 3;
    const maxDist = Math.max(minDist, Math.min(100, baseDistRef.current || 100));
    distRef.current = Math.max(minDist, Math.min(maxDist, next));
  }, []);

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      layoutSizeRef.current = { width, height };
    }
  }, []);

  // ── Rebuild geometry whenever floor-count, footprint-scale, or polygon changes ──
  // Use animKey (incremented on every explicit Generate / Replay in MagicCanvasMode)
  // instead of normPointsKey (a pixel-to-UV string that changes on any layout
  // resize, including the 1-px panel shift when isPlaying flips Stop→Play).
  // This prevents the spurious buildGeometry() call that was resetting distRef
  // and causing the visible camera snap at the end of the build animation.
  useEffect(() => {
    // Delay slightly so configRef is updated before we read it
    const id = setTimeout(() => { buildGeometry(); }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.floorCount, config.footprintScale, animKey]);

  // ── buildGeometry — tear down old group and rebuild from configRef ────────
  const buildGeometry = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;  // GL context not yet ready

    // Dispose and remove previous building group
    if (buildingGroupRef.current) {
      scene.remove(buildingGroupRef.current);
      buildingGroupRef.current.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
      buildingGroupRef.current = null;
      coreMeshRef.current = null;
      buildingMarkerRef.current = null;
    }

    const cfg    = configRef.current;
    const totalH = cfg.floorCount * cfg.floorHeightM;
    totalHRef.current = totalH;

    const npts   = cfg.normPoints;
    // Keep building centered in the full GL preview.
    centroidRef.current.set(0, totalH / 2, 0);

    // Phase 2: use metric dims from the drawn polygon when available;
    // fall back to legacy aspect-ratio squeeze if caller didn't supply them.
    const footprint     = polygonToFootprint(
      npts,
      cfg.footprintScale * 12,   // legacy scaleM fallback
      cfg.footprintWidthM,       // exact meters from pixel bbox (Phase 2+)
      cfg.footprintDepthM,
    );
    const buildingGroup = new THREE.Group();
    buildingGroup.position.set(0, 0, 0);
    buildingGroup.rotation.set(0, 0, 0);
    scene.add(buildingGroup);
    buildingGroupRef.current = buildingGroup;
    const adaptiveTextureRepeat = computeAdaptiveTextureRepeat(footprint.points, totalH);

    // Shape (shared across per-floor ExtrudeGeometry slabs below)
    const shape = new THREE.Shape();
    footprint.points.forEach((p, i) => { if (i === 0) shape.moveTo(p.x, p.z); else shape.lineTo(p.x, p.z); });
    shape.closePath();

    // PBR material — reuse cached textures so rebuild is fast
    let roofMat: THREE.Material;
    let facadeMat: THREE.Material;
    try {
      const tex = texRef.current ?? await loadBuildingTextures(TEXTURE_SCALE);
      texRef.current = tex;
      const renderer = rendererRef.current;
      if (renderer) improveTextureSet(renderer, tex);
      applyTextureRepeat(tex, adaptiveTextureRepeat);

      facadeMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xd8dde3),
        map: tex.albedo,
        aoMap: tex.ao,
        aoMapIntensity: 1.85,
        normalMap: tex.normal,
        normalScale: new THREE.Vector2(1.9, 1.9),
        roughnessMap: tex.roughness,
        roughness: 0.44,
        metalness: 0.05,
        clearcoat: 0.02,
        clearcoatRoughness: 0.5,
      });

      roofMat = new THREE.MeshPhysicalMaterial({
        color: 0x7f8792,
        normalMap: tex.normal,
        normalScale: new THREE.Vector2(0.95, 0.95),
        roughnessMap: tex.roughness,
        roughness: 0.7,
        metalness: 0.06,
      });
    } catch (err) {
      console.warn('[3D Magic] Falling back to flat materials. Texture load failed:', err);
      facadeMat = new THREE.MeshStandardMaterial({ color: 0x6b849c, roughness: 0.65, metalness: 0.18 });
      roofMat = new THREE.MeshStandardMaterial({ color: 0x69717d, roughness: 0.9, metalness: 0.05 });
    }

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    for (const mat of [roofMat, facadeMat]) {
      const pbr = mat as THREE.MeshStandardMaterial;
      pbr.clippingPlanes = [clipPlane];
      pbr.clipShadows = true;
    }
    clipPlaneRef.current = clipPlane;

    // ── Per-floor groups (Exploded View) ───────────────────────────────────
    // Each floor slice is an independent THREE.Group so its Y can be animated
    // independently during explode without affecting other floors.
    const newFloorGroups: FloorGroupData[] = [];
    for (let f = 0; f < cfg.floorCount; f++) {
      const fg = new THREE.Group();
      fg.position.set(0, f * cfg.floorHeightM, 0);
      buildingGroup.add(fg);

      const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: cfg.floorHeightM, bevelEnabled: false });
      slabGeo.rotateX(-Math.PI / 2);
      const slabUv = slabGeo.getAttribute('uv');
      if (slabUv) slabGeo.setAttribute('uv2', slabUv);
      // Top floor cap uses roofMat; interior caps are interior and invisible
      const capMat = f === cfg.floorCount - 1 ? roofMat : facadeMat;
      const slabMesh = new THREE.Mesh(slabGeo, [capMat, facadeMat]);
      slabMesh.castShadow = slabMesh.receiveShadow = true;
      fg.add(slabMesh);

      newFloorGroups.push({ index: f, group: fg, baseY: 0, meshes: [slabMesh] });
    }
    // Keep coreMeshRef pointing at ground-floor slab for backward compat
    coreMeshRef.current = (newFloorGroups[0]?.group.children[0] as THREE.Mesh) ?? null;

    // Floor-slab edge lines
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xaaddff, clippingPlanes: [clipPlane] });
    for (let f = 0; f <= cfg.floorCount; f++) {
      const extZ    = f * cfg.floorHeightM;
      const pts2d   = footprint.points;
      const lineGeo = new THREE.BufferGeometry();
      const verts: number[] = [];
      for (let k = 0; k < pts2d.length; k++) {
        const a = pts2d[k]; const b = pts2d[(k + 1) % pts2d.length];
        verts.push(a.x, a.z, extZ, b.x, b.z, extZ);
      }
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      lineGeo.rotateX(-Math.PI / 2);
      buildingGroup.add(new THREE.LineSegments(lineGeo, edgeMat));
    }

    // ── Windows ───────────────────────────────────────────────────────────
    //
    // COORDINATE SPACE NOTE
    // ─────────────────────
    // ExtrudeGeometry is built with the shape in the XY plane:
    //   shape.moveTo(p.x, p.z)   → shape-X = p.x, shape-Y = p.z
    // Then rotateX(-π/2) is BAKED into the geometry, which maps:
    //   shape-X → world-X  (unchanged)
    //   shape-Y → world-Z* (negated: world-Z = -shape-Y = -p.z)
    //   extrusion-Z → world-Y (height ↑)
    //
    // Therefore, to place windows in group-local world space we must use:
    //   worldX = p.x
    //   worldZ = -p.z   ← the sign flip only applies to world-Z positions
    //   worldY = floor  ← +Y is up, this is correct as-is
    //
    // The floor-slab lines are fine because they call lineGeo.rotateX(-π/2)
    // on the BufferGeometry itself (baked), so they never hit this issue.
    // ─────────────────────────────────────────────────────────────────────

    const WIN_OFFSET = 0.08;  // metres proud of wall (prevents z-fighting)
    const WIN_BAY_W  = 2.2;   // target bay width
    const WIN_W_FRAC = 0.52;  // window width as fraction of bay
    const WIN_H_FRAC = 0.50;  // window height as fraction of floor height
    const WIN_DEPTH  = 0.42;  // cavity depth to produce readable shadows
    const WIN_INSET  = 0.16;  // push windows into facade
    const WIN_FRAME_D = 0.10;
    const RELIEF_OUT = 0.09;
    const BAND_HEIGHT = Math.max(0.08, cfg.floorHeightM * 0.045);
    const BAND_DEPTH = 0.20;
    const PILASTER_W = 0.18;
    const PILASTER_D = 0.22;
    const PARAPET_H = Math.max(0.18, cfg.floorHeightM * 0.11);
    const MIN_WALL   = 1.2;   // walls shorter than this get no windows

    const facadeTrimMat = new THREE.MeshStandardMaterial({
      color:          0xadb6c0,
      roughness:      0.74,
      metalness:      0.08,
      clippingPlanes: [clipPlane],
    });
    const facadeShadowMat = new THREE.MeshStandardMaterial({
      color:          0x434b54,
      roughness:      0.9,
      metalness:      0.02,
      clippingPlanes: [clipPlane],
    });
    const windowFrameMat = new THREE.MeshStandardMaterial({
      color:          0xd2d9df,
      roughness:      0.58,
      metalness:      0.18,
      clippingPlanes: [clipPlane],
    });
    const windowCavityMat = new THREE.MeshStandardMaterial({
      color:          0x0a1018,
      roughness:      0.98,
      metalness:      0.0,
      clippingPlanes: [clipPlane],
    });
    const windowGlassLit = new THREE.MeshPhysicalMaterial({
      color:             0x193247,
      emissive:          0x3a78b0,
      emissiveIntensity: 0.64,
      roughness:         0.08,
      metalness:         0.86,
      transparent:       true,
      opacity:           0.78,
      clippingPlanes:    [clipPlane],
      side:              THREE.DoubleSide,
    });
    const windowGlassDark = new THREE.MeshPhysicalMaterial({
      color:             0x0a121b,
      emissive:          0x060b12,
      emissiveIntensity: 0.14,
      roughness:         0.14,
      metalness:         0.82,
      transparent:       true,
      opacity:           0.68,
      clippingPlanes:    [clipPlane],
      side:              THREE.DoubleSide,
    });

    const pts2d = footprint.points;
    for (let k = 0; k < pts2d.length; k++) {
      const a = pts2d[k];
      const b = pts2d[(k + 1) % pts2d.length];

      // Map footprint coords → post-rotation group-local world coords (Z negated)
      const ax = a.x,  az = -a.z;
      const bx = b.x,  bz = -b.z;

      const ddx = bx - ax;
      const ddz = bz - az;
      const wallLen = Math.hypot(ddx, ddz);
      if (wallLen < MIN_WALL) continue;

      const dirX = ddx / wallLen;
      const dirZ = ddz / wallLen;

      // Outward normal in XZ — perpendicular to wall, pointing away from centroid
      let nx = dirZ, nz = -dirX;
      const midX = (ax + bx) / 2;
      const midZ = (az + bz) / 2;
      if (midX * nx + midZ * nz < 0) { nx = -nx; nz = -nz; }

      // PlaneGeometry default normal = +Z. rotateY(faceAngle) makes it face (nx,0,nz).
      // sin(faceAngle)=nx, cos(faceAngle)=nz → faceAngle = atan2(nx, nz)  ✓
      const faceAngle = Math.atan2(nx, nz);
      const midWX = (ax + bx) / 2;
      const midWZ = (az + bz) / 2;

      // Facade relief bands per floor — strong macro detail visible from distance.
      for (let f = 1; f < cfg.floorCount; f++) {
        const bandGeo = new THREE.BoxGeometry(Math.max(0.4, wallLen * 0.96), BAND_HEIGHT, BAND_DEPTH);
        bandGeo.rotateY(faceAngle);
        const bandMesh = new THREE.Mesh(bandGeo, f % 2 === 0 ? facadeTrimMat : facadeShadowMat);
        // Y=0 local to floor group f = world Y f*floorHeightM (bottom of that floor)
        bandMesh.position.set(midWX + nx * RELIEF_OUT, 0, midWZ + nz * RELIEF_OUT);
        bandMesh.castShadow = true;
        bandMesh.receiveShadow = true;
        newFloorGroups[f].group.add(bandMesh);
        newFloorGroups[f].meshes.push(bandMesh);
      }

      // Vertical pilasters — break flat walls into bays.
      const pilasterCount = Math.min(12, Math.max(1, Math.round(wallLen / WIN_BAY_W)));
      const pilasterH = Math.max(cfg.floorHeightM * 1.1, totalH - BAND_HEIGHT * 1.5);
      for (let p = 0; p <= pilasterCount; p++) {
        const tP = p / pilasterCount;
        const pX = ax + tP * ddx + nx * (RELIEF_OUT + 0.01);
        const pZ = az + tP * ddz + nz * (RELIEF_OUT + 0.01);
        const pilasterGeo = new THREE.BoxGeometry(PILASTER_W, pilasterH, PILASTER_D);
        pilasterGeo.rotateY(faceAngle);
        const pilasterMesh = new THREE.Mesh(pilasterGeo, p % 2 === 0 ? facadeTrimMat : facadeShadowMat);
        pilasterMesh.position.set(pX, pilasterH / 2, pZ);
        pilasterMesh.castShadow = true;
        pilasterMesh.receiveShadow = true;
        buildingGroup.add(pilasterMesh);
      }

      // Roof parapet edge
      const parapetGeo = new THREE.BoxGeometry(Math.max(0.4, wallLen * 0.98), PARAPET_H, BAND_DEPTH * 1.1);
      parapetGeo.rotateY(faceAngle);
      const parapetMesh = new THREE.Mesh(parapetGeo, facadeTrimMat);
      parapetMesh.position.set(
        midWX + nx * (RELIEF_OUT + 0.03),
        totalH + PARAPET_H / 2,
        midWZ + nz * (RELIEF_OUT + 0.03),
      );
      parapetMesh.castShadow = true;
      parapetMesh.receiveShadow = true;
      buildingGroup.add(parapetMesh);

      const numWin = Math.max(1, Math.round(wallLen / WIN_BAY_W));
      const winW   = (wallLen / numWin) * WIN_W_FRAC;
      const winH   = cfg.floorHeightM * WIN_H_FRAC;

      for (let f = 0; f < cfg.floorCount; f++) {
        const centerY = 0.5 * cfg.floorHeightM;   // local Y within floor group (+Y is up) ✓

        for (let w = 0; w < numWin; w++) {
          const t  = (w + 0.5) / numWin;
          const px = ax + t * ddx + nx * WIN_OFFSET;   // step along wall in X
          const pz = az + t * ddz + nz * WIN_OFFSET;   // step along wall in Z (post-rotation)

          const seed = ((f + 1) * 73856093 + (w + 1) * 19349663 + (k + 1) * 83492791) % 100;

          const frameGeo = new THREE.BoxGeometry(winW, winH, WIN_FRAME_D);
          frameGeo.rotateY(faceAngle);
          const frameMesh = new THREE.Mesh(frameGeo, windowFrameMat);
          // Keep frame and glass proud of the facade so windows are visible outside.
          frameMesh.position.set(px + nx * WIN_INSET, centerY, pz + nz * WIN_INSET);
          frameMesh.castShadow = true;
          frameMesh.receiveShadow = true;
          newFloorGroups[f].group.add(frameMesh);
          newFloorGroups[f].meshes.push(frameMesh);

          const cavityGeo = new THREE.BoxGeometry(winW * 0.78, winH * 0.76, WIN_DEPTH);
          cavityGeo.rotateY(faceAngle);
          const cavityMesh = new THREE.Mesh(cavityGeo, windowCavityMat);
          cavityMesh.position.set(px - nx * (WIN_INSET + WIN_DEPTH * 0.52), centerY, pz - nz * (WIN_INSET + WIN_DEPTH * 0.52));
          cavityMesh.castShadow = false;
          cavityMesh.receiveShadow = true;
          newFloorGroups[f].group.add(cavityMesh);
          newFloorGroups[f].meshes.push(cavityMesh);

          const glassGeo = new THREE.PlaneGeometry(winW * 0.72, winH * 0.70);
          glassGeo.rotateY(faceAngle);
          const glassMesh = new THREE.Mesh(glassGeo, seed < 40 ? windowGlassLit : windowGlassDark);
          glassMesh.position.set(px + nx * (WIN_INSET + 0.04), centerY, pz + nz * (WIN_INSET + 0.04));
          glassMesh.castShadow = false;
          glassMesh.receiveShadow = false;
          newFloorGroups[f].group.add(glassMesh);
          newFloorGroups[f].meshes.push(glassMesh);
        }
      }
    }

    // Scanline
    const scanlineMat = new THREE.MeshBasicMaterial({
      color: 0x44ccff, transparent: true, opacity: SCANLINE_OPACITY,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const scanShape = new THREE.Shape();
    footprint.points.forEach((p, i) => { if (i === 0) scanShape.moveTo(p.x, p.z); else scanShape.lineTo(p.x, p.z); });
    scanShape.closePath();
    const scanGeo = new THREE.ShapeGeometry(scanShape);
    scanGeo.rotateX(-Math.PI / 2);
    const scanline = new THREE.Mesh(scanGeo, scanlineMat);
    scanline.visible = false;
    buildingGroup.add(scanline);
    scanlineRef.current    = scanline;
    scanlineMatRef.current = scanlineMat;

    // Recenter geometry content so group origin becomes the visual pivot.
    const rawBox = new THREE.Box3().setFromObject(buildingGroup, true);
    const rawCenter = rawBox.getCenter(new THREE.Vector3());
    for (const child of buildingGroup.children) {
      child.position.sub(rawCenter);
      child.updateMatrixWorld(true);
    }
    buildingGroup.position.set(0, 0, 0);
    buildingGroup.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    // Recompute bounds AFTER recentering the whole group.
    // If any residual offset remains (due to mixed child transforms),
    // run one more centering pass to force pivot at world origin.
    let centeredBox = new THREE.Box3().setFromObject(buildingGroup, true);
    let focusCenter = centeredBox.getCenter(new THREE.Vector3());
    if (focusCenter.lengthSq() > 1e-8) {
      for (const child of buildingGroup.children) {
        child.position.sub(focusCenter);
        child.updateMatrixWorld(true);
      }
      buildingGroup.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      centeredBox = new THREE.Box3().setFromObject(buildingGroup, true);
      focusCenter = centeredBox.getCenter(new THREE.Vector3());
    }
    if (
      Math.abs(focusCenter.x) < 1e-6 &&
      Math.abs(focusCenter.y) < 1e-6 &&
      Math.abs(focusCenter.z) < 1e-6
    ) {
      focusCenter.set(0, 0, 0);
    }
    const size = centeredBox.getSize(new THREE.Vector3());
    baseGroupPosRef.current.copy(buildingGroup.position);

    // True visual center of the centered model bounds.
    centroidRef.current.copy(focusCenter);
    cameraTargetRef.current.copy(focusCenter);

    const cam = cameraRef.current;
    if (cam) {
      const radius = Math.sqrt((size.x / 2) ** 2 + (size.y / 2) ** 2 + (size.z / 2) ** 2);
      distRef.current = frameCameraOnRadius(
        cam,
        radius,
        azimuthRef.current,
        elevationRef.current,
        cameraTargetRef.current,
      );
      baseDistRef.current = distRef.current;
      // Apply initial zoom: pull camera closer so zoom = initialZoom on first view
      if (initialZoomRef.current > 1) {
        distRef.current = Math.max(3, distRef.current / initialZoomRef.current);
      }
      centerTargetByBBoxProjection(
        cam,
        centeredBox,
        distRef.current,
        azimuthRef.current,
        elevationRef.current,
        cameraTargetRef.current,
        MAGIC_VISUAL_CENTER_NDC_X,
        MAGIC_VISUAL_CENTER_NDC_Y,
      );
    }

    // Reset animation progress so the building re-reveals
    buildTRef.current = 0;

    // ── Floor Manager: record baseY for each group after all centering passes ──
    for (const flData of newFloorGroups) {
      flData.baseY = flData.group.position.y;
    }
    cleanupFloorManager(floorGroupsRef.current, ghostMatCacheRef.current, origMatMapRef.current);
    floorGroupsRef.current = newFloorGroups;
    // Build uuid→floorIndex map for tap raycasting (single pass, cached)
    const meshMap = new Map<string, number>();
    for (const fg of newFloorGroups) {
      for (const m of fg.meshes) meshMap.set(m.uuid, fg.index);
    }
    floorMeshMapRef.current = meshMap;
    onFloorGroupsReadyRef.current?.(cfg.floorCount);
    // Re-apply current explode / selection state to newly built geometry
    if (explodeEnabledRef.current && explodeSeparationRef.current > 0) {
      explodeTweensRef.current = buildExplodeTweens(
        newFloorGroups, explodeSeparationRef.current, 1, performance.now(),
      );
    }
    if (selectedFloorRef.current !== 'all') {
      applyFloorSelection(
        newFloorGroups, selectedFloorRef.current, 0.22,
        ghostMatCacheRef.current, origMatMapRef.current,
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetCamera = useCallback(() => {
    azimuthRef.current   = DEFAULT_AZIMUTH;
    elevationRef.current = DEFAULT_ELEVATION;
    // Also reframe distance around visual bounds (same strategy as 3D View).
    const cam = cameraRef.current;
    if (buildingGroupRef.current) {
      if (interactionMode === 'moveModel') {
        // In 3D Magic, reset should also restore the model to its base centered pose.
        buildingGroupRef.current.position.copy(baseGroupPosRef.current);
        buildingGroupRef.current.rotation.set(0, 0, 0);
        buildingGroupRef.current.updateMatrixWorld(true);
      }
      buildingGroupRef.current.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(buildingGroupRef.current, true);
      const size = bbox.getSize(new THREE.Vector3());
      const focusCenter = bbox.getCenter(new THREE.Vector3());

      centroidRef.current.copy(focusCenter);
      cameraTargetRef.current.copy(focusCenter);

      if (cam) {
        const radius = Math.sqrt((size.x / 2) ** 2 + (size.y / 2) ** 2 + (size.z / 2) ** 2);
        distRef.current = frameCameraOnRadius(
          cam,
          radius,
          azimuthRef.current,
          elevationRef.current,
          cameraTargetRef.current,
        );
        baseDistRef.current = distRef.current;
        // Re-apply initial zoom on reset so the view returns to the same default
        if (initialZoomRef.current > 1) {
          distRef.current = Math.max(3, distRef.current / initialZoomRef.current);
        }
        centerTargetByBBoxProjection(
          cam,
          bbox,
          distRef.current,
          azimuthRef.current,
          elevationRef.current,
          cameraTargetRef.current,
          MAGIC_VISUAL_CENTER_NDC_X,
          MAGIC_VISUAL_CENTER_NDC_Y,
        );
      }
      return;
    }
    cameraTargetRef.current.copy(centroidRef.current);
  }, [interactionMode]);

  useEffect(() => {
    if (cameraResetKey !== undefined) resetCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraResetKey]);

  useEffect(() => {
    if (!glReady) return;
    resetCamera();
  }, [animKey, glReady, resetCamera]);

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (!becameActive || !glReady) return;

    // Recenter synchronously so distRef is correct before the first warmed-up frame
    // renders and uncovers the view (avoids zoom-jump when "Preparing view" clears).
    resetCamera();
  }, [active, glReady, resetCamera]);

  // ── Multi-touch PanResponder ──────────────────────────────────────────────
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder:        () => !gesturesDisabledRef.current,
        onMoveShouldSetPanResponder:         () => !gesturesDisabledRef.current,
        onStartShouldSetPanResponderCapture: () => !gesturesDisabledRef.current,
        onMoveShouldSetPanResponderCapture:  () => !gesturesDisabledRef.current,

        onPanResponderGrant: (evt) => {
          // Cancel cinematic + focus tween on any interaction
          cinematicRef.current?.onUserInteractionStart();
          focusTweenRef.current = null;

          const touches = evt.nativeEvent.touches;

          // ── Tap / long-press tracking (single finger only) ────────────────
          if (touches.length === 1) {
            const lx = evt.nativeEvent.locationX ?? touches[0].pageX;
            const ly = evt.nativeEvent.locationY ?? touches[0].pageY;
            tapRef.current = { t0: Date.now(), x0: lx, y0: ly, moved: false, active: true, fingerCount: 1 };

            // Start long-press timer (420 ms)
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = setTimeout(() => {
              if (!tapRef.current.moved && tapRef.current.active) {
                const cam   = cameraRef.current;
                const bg    = buildingGroupRef.current;
                const viewW = layoutSizeRef.current.width;
                const viewH = layoutSizeRef.current.height;
                if (cam && bg && viewW > 0 && viewH > 0) {
                  const ndc = screenToNDC(tapRef.current.x0, tapRef.current.y0, viewW, viewH);
                  const hit = intersectGroundPlane(ndc, cam, bg.position.y, raycasterRef.current);
                  if (hit) {
                    moveGrabRef.current = { offsetX: hit.x - bg.position.x, offsetZ: hit.z - bg.position.z };
                    moveModeRef.current = true;
                    setShowMoveHint(true);
                  }
                }
              }
            }, 420);
          } else {
            // Multi-finger: cancel tap / long-press / move mode
            tapRef.current.active = false;
            if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
            if (moveModeRef.current) { moveModeRef.current = false; setShowMoveHint(false); }
          }

          // ── Existing pinch / orbit initialisation ─────────────────────────
          if (touches.length >= 2) {
            const dx = touches[1].pageX - touches[0].pageX;
            const dy = touches[1].pageY - touches[0].pageY;
            pinchDistRef.current = Math.hypot(dx, dy);
            lastMidRef.current   = {
              x: (touches[0].pageX + touches[1].pageX) / 2,
              y: (touches[0].pageY + touches[1].pageY) / 2,
            };
          } else {
            pinchDistRef.current = 0;
            lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          }
        },

        onPanResponderMove: (evt) => {
          const touches = evt.nativeEvent.touches;

          // ── 2-finger: always cancel move-mode + tap tracking ─────────────
          if (touches.length >= 2) {
            if (moveModeRef.current) { moveModeRef.current = false; setShowMoveHint(false); }
            tapRef.current.active = false;
            if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }

            const dx   = touches[1].pageX - touches[0].pageX;
            const dy   = touches[1].pageY - touches[0].pageY;
            const d    = Math.hypot(dx, dy);
            const midX = (touches[0].pageX + touches[1].pageX) / 2;
            const midY = (touches[0].pageY + touches[1].pageY) / 2;

            if (pinchDistRef.current > 0 && d > 0) {
              if (interactionMode !== 'moveModel') {
                const scale = d / pinchDistRef.current;
                distRef.current = Math.max(3, Math.min(100, distRef.current / scale));
              }
              const dmx = midX - lastMidRef.current.x;
              const dmy = midY - lastMidRef.current.y;
              if (interactionMode !== 'moveModel') {
                const sp  = distRef.current * 0.003;
                const cosAz = Math.cos(azimuthRef.current);
                const sinAz = Math.sin(azimuthRef.current);
                cameraTargetRef.current.x -= dmx * cosAz * sp;
                cameraTargetRef.current.z += dmx * sinAz * sp;
                cameraTargetRef.current.y -= dmy * sp * 0.6;
              }
            }

            pinchDistRef.current = d;
            lastMidRef.current   = { x: midX, y: midY };
            return;
          }

          // ── Single finger ─────────────────────────────────────────────────
          if (touches.length === 1) {
            pinchDistRef.current = 0;
            const tx  = touches[0].pageX;
            const ty  = touches[0].pageY;

            // Track movement for tap / long-press cancellation
            if (tapRef.current.active) {
              const lx = evt.nativeEvent.locationX ?? tx;
              const ly = evt.nativeEvent.locationY ?? ty;
              if (Math.hypot(lx - tapRef.current.x0, ly - tapRef.current.y0) > 8) {
                tapRef.current.moved = true;
                if (longPressTimerRef.current && !moveModeRef.current) {
                  clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              }
            }

            const ddx = tx - lastTouchRef.current.x;
            const ddy = ty - lastTouchRef.current.y;
            lastTouchRef.current = { x: tx, y: ty };

            // Ground-plane move mode: drag building on XZ plane
            if (moveModeRef.current) {
              const cam   = cameraRef.current;
              const bg    = buildingGroupRef.current;
              const viewW = layoutSizeRef.current.width;
              const viewH = layoutSizeRef.current.height;
              if (cam && bg && viewW > 0 && viewH > 0) {
                const lx = evt.nativeEvent.locationX ?? tx;
                const ly = evt.nativeEvent.locationY ?? ty;
                const ndc = screenToNDC(lx, ly, viewW, viewH);
                const hit = intersectGroundPlane(ndc, cam, bg.position.y, raycasterRef.current);
                if (hit) {
                  bg.position.x = hit.x - moveGrabRef.current.offsetX;
                  bg.position.z = hit.z - moveGrabRef.current.offsetZ;
                  bg.updateMatrixWorld(true);
                }
              }
              return; // skip orbit
            }

            if (interactionMode === 'moveModel') {
              const g = buildingGroupRef.current;
              if (g) {
                g.rotation.y -= ddx * 0.008;
                g.rotation.x = Math.max(-0.5, Math.min(0.5, g.rotation.x - ddy * 0.006));
                g.updateMatrixWorld(true);
              }
              movedModelInGestureRef.current = true;
            } else {
              azimuthRef.current   -= ddx * 0.008;
              elevationRef.current  = Math.max(0.05, Math.min(1.48, elevationRef.current - ddy * 0.008));
            }
          }
        },

        onPanResponderRelease: (evt) => {
          // Clear long-press timer
          if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }

          // Exit move mode on release
          if (moveModeRef.current) {
            moveModeRef.current = false;
            setShowMoveHint(false);
            pinchDistRef.current = 0;
            tapRef.current.active = false;
            return;
          }

          // ── Tap detection ─────────────────────────────────────────────────
          const tap      = tapRef.current;
          const duration = Date.now() - tap.t0;
          if (tap.active && !tap.moved && tap.fingerCount === 1 && duration < 180) {
            const lx    = evt.nativeEvent.locationX ?? tap.x0;
            const ly    = evt.nativeEvent.locationY ?? tap.y0;
            const cam   = cameraRef.current;
            const viewW = layoutSizeRef.current.width;
            const viewH = layoutSizeRef.current.height;
            if (cam && viewW > 0 && viewH > 0 && floorGroupsRef.current.length > 0) {
              const ndc      = screenToNDC(lx, ly, viewW, viewH);
              const allMeshes = floorGroupsRef.current.flatMap((fg) => fg.meshes);
              const hit = castRay(ndc, cam, allMeshes, floorMeshMapRef.current, raycasterRef.current);
              if (hit !== null) {
                const dtap  = doubleTapRef.current;
                const dtGap = Date.now() - dtap.lastT;
                if (dtGap < 260 && Math.hypot(lx - dtap.lastX, ly - dtap.lastY) < 12) {
                  // Double-tap: gentle focus tween on hit point
                  const bg       = buildingGroupRef.current;
                  const startDist = distRef.current;
                  const endDist   = bg
                    ? Math.max(4, new THREE.Box3().setFromObject(bg).getSize(new THREE.Vector3()).length() * 0.85)
                    : startDist * 0.75;
                  focusTweenRef.current = {
                    sT: cameraTargetRef.current.clone(), eT: hit.point.clone(),
                    sDist: startDist, eDist: endDist,
                    sEl: elevationRef.current, eEl: Math.max(0.18, Math.min(0.8, elevationRef.current)),
                    prog: 0, dur: 0.40,
                  };
                  doubleTapRef.current = { lastT: 0, lastX: 0, lastY: 0 };
                } else {
                  // Single-tap: toggle floor selection
                  if (hit.floorIndex !== null) {
                    const next: number | 'all' = selectedFloorRef.current === hit.floorIndex ? 'all' : hit.floorIndex;
                    onFloorSelectRef.current?.(next);
                  }
                  doubleTapRef.current = { lastT: Date.now(), lastX: lx, lastY: ly };
                }
              } else {
                doubleTapRef.current = { lastT: 0, lastX: 0, lastY: 0 };
              }
            }
          }

          tap.active = false;
          pinchDistRef.current = 0;
          movedModelInGestureRef.current = false;
        },

        onPanResponderTerminate: () => {
          if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
          if (moveModeRef.current) { moveModeRef.current = false; setShowMoveHint(false); }
          tapRef.current.active = false;
          pinchDistRef.current  = 0;
        },
      }),
    [interactionMode],
  );

  // ── GL context ───────────────────────────────────────────────────────────
  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    // Invalidate any previous RAF loop bound to an old GL session.
    const sessionId = contextSessionRef.current + 1;
    contextSessionRef.current = sessionId;
    // Fresh context — clear any prior loss flag and restoring banner.
    contextLostRef.current = false;
    setIsRestoring(false);
    cancelAnimationFrame(raffRef.current);

    // pixelStorei patch
    const _origPsi = gl.pixelStorei.bind(gl);
    try {
      Object.defineProperty(gl, 'pixelStorei', {
        configurable: true, writable: false,
        value: (pname: number, param: number) => { if (pname !== 0x9240) _origPsi(pname, param); },
      });
    } catch {
      // @ts-ignore
      gl.pixelStorei = (pname: number, param: number) => { if (pname !== 0x9240) _origPsi(pname, param); };
    }

    // Expo GL can return undefined for shader/program info logs.
    // THREE calls `.trim()` on those logs during program first use.
    const _origGetShaderInfoLog =
      // @ts-ignore
      typeof gl.getShaderInfoLog === 'function' ? gl.getShaderInfoLog.bind(gl) : null;
    if (_origGetShaderInfoLog) {
      try {
        Object.defineProperty(gl, 'getShaderInfoLog', {
          configurable: true,
          writable: false,
          value: (shader: unknown) => {
            const out = _origGetShaderInfoLog(shader as WebGLShader);
            return typeof out === 'string' ? out : '';
          },
        });
      } catch {
        // @ts-ignore
        gl.getShaderInfoLog = (shader: unknown) => {
          const out = _origGetShaderInfoLog(shader as WebGLShader);
          return typeof out === 'string' ? out : '';
        };
      }
    }

    const _origGetProgramInfoLog =
      // @ts-ignore
      typeof gl.getProgramInfoLog === 'function' ? gl.getProgramInfoLog.bind(gl) : null;
    if (_origGetProgramInfoLog) {
      try {
        Object.defineProperty(gl, 'getProgramInfoLog', {
          configurable: true,
          writable: false,
          value: (program: unknown) => {
            const out = _origGetProgramInfoLog(program as WebGLProgram);
            return typeof out === 'string' ? out : '';
          },
        });
      } catch {
        // @ts-ignore
        gl.getProgramInfoLog = (program: unknown) => {
          const out = _origGetProgramInfoLog(program as WebGLProgram);
          return typeof out === 'string' ? out : '';
        };
      }
    }

    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;

    // bufW / bufH are already in device pixels (gl.drawingBufferWidth/Height).
    // THREE.js's setViewport/setSize multiply the given size by _pixelRatio
    // internally when calling gl.viewport(). Passing pixelRatio: 1 prevents a
    // double-scaling that would push NDC (0,0) to the upper-right corner of
    // the physical framebuffer instead of the center.
    const renderer = new Renderer({ gl, width: bufW, height: bufH, pixelRatio: 1, alpha: true });
    if (renderer.debug && typeof renderer.debug.checkShaderErrors === 'boolean') {
      renderer.debug.checkShaderErrors = false;
    }
    rendererRef.current = renderer as unknown as THREE.WebGLRenderer;
    renderer.setSize(bufW, bufH, false);
    renderer.setViewport(0, 0, bufW, bufH);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace     = THREE.SRGBColorSpace;
    renderer.toneMapping          = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure  = 1.34;
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Lighting
    scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x5a4532, 0.48));
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.25);
    sun.position.set(10, 22, 12);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fc5ff, 0.45);
    fill.position.set(-10, 8, -11);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xbfe4ff, 0.72);
    rim.position.set(-7, 14, 18);
    scene.add(rim);

    // Camera (use visible layout aspect to avoid GL buffer/layout mismatch)
    const initialViewW = layoutSizeRef.current.width > 0 ? layoutSizeRef.current.width : bufW;
    const initialViewH = layoutSizeRef.current.height > 0 ? layoutSizeRef.current.height : bufH;
    const cam = new THREE.PerspectiveCamera(46, initialViewW / Math.max(1, initialViewH), 0.05, 500);
    cameraRef.current = cam;

    // Pre-load textures (cached — subsequent calls are instant)
    try {
      texRef.current = await loadBuildingTextures(TEXTURE_SCALE);
      if (texRef.current) improveTextureSet(renderer as unknown as THREE.WebGLRenderer, texRef.current);
    } catch (texErr) {
      console.warn('[3D Magic] onContextCreate: texture pre-load failed (fallback materials will be used):', texErr);
    }

    // Build initial geometry — wrapped so a crash here still lets us call
    // setGlReady(true) and show the (possibly empty) GL view instead of
    // leaving the UI frozen forever at "Building scene…".
    try {
      await buildGeometry();
    } catch (geoErr) {
      console.error('[3D Magic] onContextCreate: buildGeometry failed:', geoErr);
    }

    setGlReady(true);

    // Render loop
    let lastBufW  = bufW;
    let lastBufH  = bufH;
    let lastTime  = 0;
    let loopKey   = animKeyRef.current;
    let loopZoomCommandId = zoomCommandIdRef.current;

    const animate = (time: number = 0) => {
      if (contextSessionRef.current !== sessionId) return;
      raffRef.current = requestAnimationFrame(animate);

      if (!isActiveRef.current) {
        lastTime = time;
        // Render a blank transparent frame so the GL swap-chain stays alive while
        // the component is hidden.  Without this, some Android EGL drivers treat an
        // unflushed surface as abandoned and destroy the context silently.
        try {
          renderer.setClearColor(0x000000, 0);
          renderer.clear();
          gl.endFrameEXP();
        } catch {
          // Context lost mid-inactivity.  Record it so focus-return can remount.
          contextLostRef.current = true;
          if (contextSessionRef.current === sessionId) {
            contextSessionRef.current += 1;
            cancelAnimationFrame(raffRef.current);
          }
        }
        return;
      }

      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime  = time;

      if (zoomCommandIdRef.current !== loopZoomCommandId) {
        loopZoomCommandId = zoomCommandIdRef.current;
        const wantsZoomIn = zoomCommandDirRef.current === 'in';
        const limits = zoomLimitsRef.current;
        if ((wantsZoomIn && limits.canZoomIn) || (!wantsZoomIn && limits.canZoomOut)) {
          applyZoomStep(wantsZoomIn);
        }
      }

      if (zoomHoldDirRef.current !== 0 && dt > 0) {
        const limits = zoomLimitsRef.current;
        const allowHold =
          (zoomHoldDirRef.current === 1 && limits.canZoomIn) ||
          (zoomHoldDirRef.current === -1 && limits.canZoomOut);
        if (allowHold) {
          const minDist = 3;
          const maxDist = Math.max(minDist, Math.min(100, baseDistRef.current || 100));
          const zoomSpeed = Math.max(ZOOM_HOLD_SPEED_BASE, distRef.current * 1.2);
          const nextDist = distRef.current - zoomHoldDirRef.current * zoomSpeed * dt;
          distRef.current = Math.max(minDist, Math.min(maxDist, nextDist));
        }
      }

      // Manual button-driven rotation (camera orbit or model rotation)
      const MANUAL_ROT_SPEED = 1.2; // radians per second
      if (manualAzimuthDirRef.current !== 0 && dt > 0) {
        if (interactionMode === 'moveModel') {
          const g = buildingGroupRef.current;
          if (g) {
            g.rotation.y -= manualAzimuthDirRef.current * MANUAL_ROT_SPEED * dt;
            g.updateMatrixWorld(true);
          }
        } else {
          azimuthRef.current -= manualAzimuthDirRef.current * MANUAL_ROT_SPEED * dt;
        }
      }
      if (manualElevationDirRef.current !== 0 && dt > 0) {
        if (interactionMode === 'moveModel') {
          const g = buildingGroupRef.current;
          if (g) {
            g.rotation.x = Math.max(-0.5, Math.min(0.5, g.rotation.x - manualElevationDirRef.current * MANUAL_ROT_SPEED * dt));
            g.updateMatrixWorld(true);
          }
        } else {
          elevationRef.current = Math.max(0.05, Math.min(1.48, elevationRef.current + manualElevationDirRef.current * MANUAL_ROT_SPEED * dt));
        }
      }

      // Manual vertical translation (↑ ↓ buttons)
      const MANUAL_MOVE_SPEED = 4; // world-units per second
      if (manualMoveYDirRef.current !== 0 && dt > 0) {
        if (interactionMode === 'moveModel') {
          const g = buildingGroupRef.current;
          if (g) {
            g.position.y += manualMoveYDirRef.current * MANUAL_MOVE_SPEED * dt;
            g.updateMatrixWorld(true);
          }
        } else {
          cameraTargetRef.current.y = Math.max(-80, Math.min(80,
            cameraTargetRef.current.y + manualMoveYDirRef.current * MANUAL_MOVE_SPEED * dt,
          ));
        }
      }

      // Reset on new animKey
      if (animKeyRef.current !== loopKey) {
        loopKey           = animKeyRef.current;
        buildTRef.current = 0;
        cinematicFiredRef.current = false; // allow cinematic to fire again for new build
        cinematicRef.current?.cancel();
      }

      const cfg2   = configRef.current;
      const floors = Math.max(1, cfg2.floorCount);
      const dur    = floors * FLOOR_BUILD_SEC;
      if (isPlayingRef.current && buildTRef.current < 1) {
        buildTRef.current = Math.min(1, buildTRef.current + dt / dur);
        if (buildTRef.current >= 1) {
          onBuildCompleteRef.current?.();
          // Fire cinematic once per build cycle
          if (!cinematicFiredRef.current) {
            cinematicFiredRef.current = true;
            cinematicRef.current?.runFramingAndOrbit();
          }
        }
      }

      const t          = buildTRef.current;
      const totalH     = totalHRef.current;
      const clipPlane  = clipPlaneRef.current;
      const scanline   = scanlineRef.current;
      const scanlineMat = scanlineMatRef.current;

      if (clipPlane && totalH > 0) {
        // Per-floor smoothstep reveal
        const scaled     = t * floors;
        const floorIdx   = Math.floor(Math.min(scaled, floors - 0.001));
        const local      = scaled - floorIdx;
        const eased      = local * local * (3 - 2 * local);
        const revealFrac = (floorIdx + eased) / floors;
        const revealY    = revealFrac * totalH;

        // In explode mode (build complete), lift clip so offset floor groups stay visible
        clipPlane.constant = (explodeEnabledRef.current && buildTRef.current >= 1) ? 999 : revealY;

        if (scanline && scanlineMat) {
          if (t > 0.001 && t < 0.999) {
            scanline.visible    = true;
            scanline.position.y = revealY;
            scanlineMat.opacity = SCANLINE_OPACITY * (0.5 + 0.5 * Math.sin(time * 0.007));
          } else {
            scanline.visible = false;
            if (t >= 1) scanlineMat.opacity = 0;
          }
        }
      }

      // Advance explode tweens (floor Y-offset animation)
      if (explodeTweensRef.current.length > 0) {
        const stillActive = tickExplodeTweens(explodeTweensRef.current, time);
        if (!stillActive) explodeTweensRef.current = [];
      }

      // Tick cinematic camera controller
      const cinematicNowActive = cinematicRef.current?.tick(time, dt) ?? false;
      if (cinematicNowActive !== cinematicWasActiveRef.current) {
        cinematicWasActiveRef.current = cinematicNowActive;
        setCinematicActive(cinematicNowActive);
      }

      // Smooth double-tap focus tween
      const ft = focusTweenRef.current;
      if (ft && dt > 0) {
        ft.prog = Math.min(1, ft.prog + dt / ft.dur);
        const e = ft.prog < 1 ? ft.prog * ft.prog * (3 - 2 * ft.prog) : 1; // smoothstep
        cameraTargetRef.current.lerpVectors(ft.sT, ft.eT, e);
        distRef.current      = ft.sDist + (ft.eDist - ft.sDist) * e;
        elevationRef.current = ft.sEl   + (ft.eEl   - ft.sEl)   * e;
        if (ft.prog >= 1) focusTweenRef.current = null;
      }

      // Resize
      const cw = gl.drawingBufferWidth;
      const ch = gl.drawingBufferHeight;
      if (cw <= 0 || ch <= 0) return;
      if (cw !== lastBufW || ch !== lastBufH || forceResizeRef.current) {
        forceResizeRef.current = false;
        lastBufW = cw; lastBufH = ch;
        renderer.setSize(cw, ch, false);
        renderer.setViewport(0, 0, cw, ch);
        if (cameraRef.current) {
          // Use buffer ratio — same aspect as layout, but never stale after tab-switch
          cameraRef.current.aspect = cw / Math.max(1, ch);
          cameraRef.current.updateProjectionMatrix();
        }
      }

      const viewW = layoutSizeRef.current.width > 0 ? layoutSizeRef.current.width : cw;
      const viewH = layoutSizeRef.current.height > 0 ? layoutSizeRef.current.height : ch;
      const minDist = 3;
      const maxDist = Math.max(minDist, Math.min(100, baseDistRef.current || 100));
      const canZoomIn = distRef.current > minDist;
      const canZoomOut = distRef.current < maxDist - 0.0001;
      zoomLimitsRef.current = { canZoomIn, canZoomOut };

      const baseDist = Math.max(0.001, baseDistRef.current);
      const zoomValue = Math.max(
        1,
        Math.min(9.9, baseDist / Math.max(0.001, distRef.current)),
      );
      const roundedZoom = +zoomValue.toFixed(1);
      const lastZoom = lastZoomReportRef.current;
      if (
        roundedZoom !== lastZoom.zoomValue ||
        canZoomIn !== lastZoom.canZoomIn ||
        canZoomOut !== lastZoom.canZoomOut
      ) {
        lastZoom.zoomValue = roundedZoom;
        lastZoom.canZoomIn = canZoomIn;
        lastZoom.canZoomOut = canZoomOut;
        onZoomMetricsRef.current?.({
          zoomValue: roundedZoom,
          canZoomIn,
          canZoomOut,
        });
      }

      if (cameraRef.current) {
        // Keep camera projection aligned with the GL buffer — buffer ratio is always correct.
        const viewAspect = cw / Math.max(1, ch);
        if (Math.abs(cameraRef.current.aspect - viewAspect) > 0.0001) {
          cameraRef.current.aspect = viewAspect;
          cameraRef.current.updateProjectionMatrix();
        }
        updateCamera(
          cameraRef.current,
          distRef.current,
          azimuthRef.current,
          elevationRef.current,
          cameraTargetRef.current,
        );
      }

      let modelScreenX = viewW / 2;
      let modelScreenY = viewH / 2;
      const modelWorld = centroidRef.current.clone();
      let buildingCordsScreenX = modelScreenX;
      let buildingCordsScreenY = modelScreenY;
      const buildingCordsWorld = modelWorld.clone();
      let rectX = 0;
      let rectY = 0;
      let rectW = 0;
      let rectH = 0;
      let rectVisible = false;

      if (cameraRef.current && buildingGroupRef.current) {
        buildingGroupRef.current.updateMatrixWorld(true);
        const bbox = new THREE.Box3().setFromObject(buildingGroupRef.current, true);
        const worldCenter = bbox.getCenter(new THREE.Vector3());
        modelWorld.copy(worldCenter);
        const ndc = worldCenter.clone().project(cameraRef.current);
        if (Number.isFinite(ndc.x) && Number.isFinite(ndc.y)) {
          modelScreenX = (ndc.x * 0.5 + 0.5) * viewW;
          modelScreenY = (-ndc.y * 0.5 + 0.5) * viewH;
        }
        // Keep building_coords anchored to the same center used by pivot_x metrics.
        buildingCordsWorld.copy(worldCenter);
        buildingCordsScreenX = modelScreenX;
        buildingCordsScreenY = modelScreenY;
        const screenRect = getBBoxScreenRect(cameraRef.current, bbox, viewW, viewH);
        if (screenRect) {
          rectX = screenRect.x;
          rectY = screenRect.y;
          rectW = screenRect.w;
          rectH = screenRect.h;
          rectVisible = true;
        }
      }

      const liveMetrics: Procedural3DDebugMetrics = {
        glViewWidth: viewW,
        glViewHeight: viewH,
        glCenterX: viewW / 2,
        glCenterY: viewH / 2,
        modelScreenX,
        modelScreenY,
        modelRectX: rectX,
        modelRectY: rectY,
        modelRectW: rectW,
        modelRectH: rectH,
        modelWorldX: modelWorld.x,
        modelWorldY: modelWorld.y,
        modelWorldZ: modelWorld.z,
        buildingCordsScreenX,
        buildingCordsScreenY,
        buildingCordsX: buildingCordsWorld.x,
        buildingCordsY: buildingCordsWorld.y,
        buildingCordsZ: buildingCordsWorld.z,
      };
      latestMetricsRef.current = liveMetrics;

      if (time - metricsTimeRef.current > 120) {
        metricsTimeRef.current = time;
        onDebugMetricsRef.current?.(liveMetrics);
      }

      try {
        renderer.setRenderTarget(null);
        renderer.render(scene, cameraRef.current ?? cam);
        gl.endFrameEXP();
        if (warmupPendingRef.current) {
          warmupPendingRef.current = false;
          setIsWarmingUp(false);
        }
      } catch {
        contextLostRef.current = true;
        if (contextSessionRef.current === sessionId) {
          contextSessionRef.current += 1;
          cancelAnimationFrame(raffRef.current);
          // If the context died while the component is actively visible, kick off
          // an immediate recovery rather than waiting for the next focus cycle.
          if (isActiveRef.current) {
            setGlReady(false);
            setIsRestoring(true);
            setGlKey(k => k + 1);
          }
        }
      }
    };

    raffRef.current = requestAnimationFrame(animate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    contextSessionRef.current += 1;
    cancelAnimationFrame(raffRef.current);
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} onLayout={onRootLayout}>
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        <GLView key={glKey} style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      </View>


      {(!glReady || isWarmingUp) && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="#00d4ff" />
          <Text style={styles.loadingText}>
            {!glReady
              ? (isRestoring ? 'Restoring 3D…' : 'Building scene…')
              : 'Preparing view...'}
          </Text>
        </View>
      )}

      {cinematicActive && (
        <View style={styles.cinematicBadge} pointerEvents="none">
          <Text style={styles.cinematicBadgeText}>{'▶ PREVIEW'}</Text>
        </View>
      )}

      {showMoveHint && (
        <View style={styles.moveHint} pointerEvents="none">
          <Text style={styles.moveHintText}>MOVE</Text>
        </View>
      )}

    </View>
  );
};

export default Procedural3DBuilding;

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },

  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#00d4ff',
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },

  cinematicBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.3)',
  },
  cinematicBadgeText: {
    color: 'rgba(0,212,255,0.75)',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  moveHint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.5)',
  },
  moveHintText: {
    color: '#00d4ff',
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 3,
  },

});
