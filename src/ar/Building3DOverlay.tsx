/**
 * src/ar/Building3DOverlay.tsx
 *
 * Renders assets/models/EEB_015.glb in a full PBR 3D scene.
 *
 * Construction animation:
 *  - renderer.localClippingEnabled = true
 *  - A clipping plane (normal 0,-1,0) rises from model bottom to top.
 *  - revealY uses a per-floor smoothstep so each floor lingers slightly
 *    at its boundary before the next starts (soft stepping, no popping).
 *  - isPlaying / animKey from the Play button control start/restart.
 *  - Duration = config.floorCount * FLOOR_BUILD_SEC seconds.
 *  - Scanline PlaneGeometry band follows the clip front.
 *
 * Blueprint view: UNCHANGED.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { ARModelConfig } from '../types';
import { loadTexturelessGlb, disposeObject3D, disposeRenderer, rafLoopStats, logGlbStats } from '../lib/glbLoader';

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------
const DEFAULT_MODEL_ASSET = require('../../assets/models/EEB_015.glb');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
/** Seconds to reveal each floor when buildSpeed === 1 */
const FLOOR_BUILD_SEC  = 0.8;
/** Peak opacity of the scan-plane at the reveal front (0 = off) */
const SCANLINE_OPACITY = 0.18;
/** Extra camera fit padding (higher = less initial zoom). */
const CAMERA_FIT_PADDING = 1.9;
const ROTATE_AZIMUTH_SPEED = 1.9;   // rad/s
const ROTATE_ELEVATION_SPEED = 1.2; // rad/s
const AUTO_ROTATE_RIGHT_SPEED = 0.95; // rad/s while auto-build is running
const MOVE_TARGET_Y_SPEED_BASE = 2.4; // units/s
const ZOOM_STEP_BASE = 1.2;
const ZOOM_HOLD_SPEED_BASE = 3.0; // units/s
const DEFAULT_VIEW3D_ZOOM = 1.3;
const MAX_FLOORS_FIXED = 20;
const MODEL_LOAD_TIMEOUT_MS = 25000;

// ---------------------------------------------------------------------------
// Camera defaults
// ---------------------------------------------------------------------------
const DEFAULT_AZIMUTH   = Math.PI / 4;
const DEFAULT_ELEVATION = (26 * Math.PI) / 180;

const DEBUG = false;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Building3DOverlayProps {
  config: ARModelConfig;
  isPlaying: boolean;
  animKey: number;
  modelUri?: string | null;
  active?: boolean;
  width: number;
  height: number;
  zoomCommandId?: number;
  zoomCommandDir?: 'in' | 'out';
  zoomHoldDir?: -1 | 0 | 1;
  onZoomMetrics?: (metrics: {
    zoomValue: number;
    canZoomIn: boolean;
    canZoomOut: boolean;
  }) => void;
  onBuildComplete?: () => void;
}

interface OverlayDebugMetrics {
  previewCenterX: number;
  previewCenterY: number;
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
}

interface ManualControlState {
  azimuthDir: -1 | 0 | 1;
  elevationDir: -1 | 0 | 1;
  moveYDir: -1 | 0 | 1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function updateCamera(
  camera: THREE.PerspectiveCamera,
  dist: number,
  azimuth: number,
  elevation: number,
  target: THREE.Vector3 = new THREE.Vector3(),
): void {
  const cosEl = Math.cos(elevation);
  camera.position.set(
    target.x + dist * cosEl * Math.sin(azimuth),
    target.y + dist * Math.sin(elevation),
    target.z + dist * cosEl * Math.cos(azimuth),
  );
  camera.lookAt(target);
}

function frameCameraOnRadius(
  camera: THREE.PerspectiveCamera,
  radius: number,
  azimuth: number,
  elevation: number,
  target: THREE.Vector3,
): number {
  const fovRad = (camera.fov * Math.PI) / 180;
  const dist   = Math.max(4, (radius * CAMERA_FIT_PADDING) / Math.tan(fovRad / 2));
  updateCamera(camera, dist, azimuth, elevation, target);
  return dist;
}

function getBBoxScreenRect(
  camera: THREE.PerspectiveCamera,
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
    c.project(camera);
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

/**
 * Per-floor soft-stepped easing.
 * Divides t[0..1] into `floors` equal segments and applies smoothstep
 * inside each segment so the camera reveal lingers at each floor boundary
 * before advancing  no popping, no opacity tricks.
 */
function floorSmoothStep(t: number, floors: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled  = clamped * floors;
  const idx     = Math.floor(scaled);
  const local   = scaled - idx;                          // [0..1] within floor
  const eased   = local * local * (3.0 - 2.0 * local);  // smoothstep
  return (idx + eased) / floors;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const Building3DOverlay: React.FC<Building3DOverlayProps> = ({
  config,
  isPlaying,
  animKey,
  modelUri,
  active = true,
  zoomCommandId = 0,
  zoomCommandDir = 'in',
  zoomHoldDir = 0,
  onZoomMetrics,
  onBuildComplete,
}) => {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg]   = useState('');
  const [isWarmingUp, setIsWarmingUp] = useState(false);
  const [debugMetrics, setDebugMetrics] = useState<OverlayDebugMetrics | null>(null);
  const [gesturesEnabled, setGesturesEnabled] = useState(true);

  // Refs used inside the render-loop closure (avoids stale captures)
  const isPlayingRef = useRef(isPlaying);
  const isActiveRef  = useRef(active);
  const warmupPendingRef = useRef(false);
  const configRef    = useRef(config);
  const animKeyRef   = useRef(animKey);
  const buildTRef    = useRef(0);      // animation progress [0..1]
  const raffRef      = useRef<number>(0);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef     = useRef<THREE.Scene | null>(null);
  const contextSessionRef = useRef(0);

  const azimuthRef      = useRef(DEFAULT_AZIMUTH);
  const elevationRef    = useRef(DEFAULT_ELEVATION);
  const distRef         = useRef(0);
  const defaultDistRef  = useRef(0);
  const lastTouchRef    = useRef({ x: 0, y: 0 });
  const cameraTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const defaultTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  // Multi-touch pinch & 2-finger pan
  const pinchDistRef    = useRef(0);          // previous distance between 2 fingers
  const lastMidRef      = useRef({ x: 0, y: 0 }); // previous midpoint of 2 fingers
  const layoutSizeRef   = useRef({ width: 0, height: 0 });
  const metricsTimeRef  = useRef(0);
  const lastZoomReportRef = useRef({
    zoomValue: NaN,
    canZoomIn: true,
    canZoomOut: true,
  });
  const gesturesEnabledRef = useRef(true);
  const zoomCommandIdRef = useRef(zoomCommandId);
  const zoomCommandDirRef = useRef<'in' | 'out'>(zoomCommandDir);
  const zoomHoldDirRef = useRef<-1 | 0 | 1>(zoomHoldDir);
  const onZoomMetricsRef = useRef<Building3DOverlayProps['onZoomMetrics']>(onZoomMetrics);
  const onBuildCompleteRef = useRef<Building3DOverlayProps['onBuildComplete']>(onBuildComplete);
  const zoomLimitsRef = useRef({ canZoomIn: true, canZoomOut: true });
  const completionSentRef = useRef(false);
  const userInteractedRef = useRef(false);
  const baseDistRef = useRef(1);
  const manualControlRef = useRef<ManualControlState>({
    azimuthDir: 0,
    elevationDir: 0,
    moveYDir: 0,
  });

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isActiveRef.current  = active;    }, [active]);
  useEffect(() => { configRef.current    = config;    }, [config]);
  useEffect(() => { gesturesEnabledRef.current = gesturesEnabled; }, [gesturesEnabled]);
  useEffect(() => { zoomCommandIdRef.current = zoomCommandId; }, [zoomCommandId]);
  useEffect(() => { zoomCommandDirRef.current = zoomCommandDir; }, [zoomCommandDir]);
  useEffect(() => { zoomHoldDirRef.current = zoomHoldDir; }, [zoomHoldDir]);
  useEffect(() => { onZoomMetricsRef.current = onZoomMetrics; }, [onZoomMetrics]);
  useEffect(() => { onBuildCompleteRef.current = onBuildComplete; }, [onBuildComplete]);
  useEffect(() => {
    if (!active) {
      manualControlRef.current.azimuthDir = 0;
      manualControlRef.current.elevationDir = 0;
      manualControlRef.current.moveYDir = 0;
    }
  }, [active]);
  useEffect(() => {
    if (active) {
      warmupPendingRef.current = true;
      setIsWarmingUp(true);
    } else {
      warmupPendingRef.current = false;
      setIsWarmingUp(false);
    }
  }, [active]);
  useEffect(() => {
    // animKey changes when Play is pressed  restart the reveal
    if (animKeyRef.current !== animKey) {
      animKeyRef.current = animKey;
      buildTRef.current  = 0;
      completionSentRef.current = false;
      userInteractedRef.current = false;
    }
  }, [animKey]);

  const resetCamera = useCallback(() => {
    azimuthRef.current   = DEFAULT_AZIMUTH;
    elevationRef.current = DEFAULT_ELEVATION;
    cameraTargetRef.current.copy(defaultTargetRef.current);
    if (defaultDistRef.current > 0) {
      distRef.current = defaultDistRef.current;
    }
    pinchDistRef.current = 0;
    lastTouchRef.current = { x: 0, y: 0 };
    userInteractedRef.current = false;
    manualControlRef.current.azimuthDir = 0;
    manualControlRef.current.elevationDir = 0;
    manualControlRef.current.moveYDir = 0;
    if (cameraRef.current && distRef.current > 0) {
      updateCamera(
        cameraRef.current,
        distRef.current,
        azimuthRef.current,
        elevationRef.current,
        cameraTargetRef.current,
      );
    }
  }, []);

  const setManualAzimuthDir = useCallback((dir: -1 | 0 | 1) => {
    if (dir !== 0) userInteractedRef.current = true;
    manualControlRef.current.azimuthDir = dir;
  }, []);

  const setManualElevationDir = useCallback((dir: -1 | 0 | 1) => {
    if (dir !== 0) userInteractedRef.current = true;
    manualControlRef.current.elevationDir = dir;
  }, []);

  const setManualMoveYDir = useCallback((dir: -1 | 0 | 1) => {
    if (dir !== 0) userInteractedRef.current = true;
    manualControlRef.current.moveYDir = dir;
  }, []);

  const applyZoomStep = useCallback((zoomIn: boolean) => {
    userInteractedRef.current = true;
    const step = Math.max(ZOOM_STEP_BASE, distRef.current * 0.12);
    const next = zoomIn ? distRef.current - step : distRef.current + step;
    const maxZoomOutDist = Math.max(2, Math.min(80, baseDistRef.current || 80));
    distRef.current = Math.max(2, Math.min(maxZoomOutDist, next));
  }, []);

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      layoutSizeRef.current = { width, height };
    }
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture immediately so no parent (ScrollView, GestureDetector) steals the touch
        onStartShouldSetPanResponder:         () => gesturesEnabledRef.current,
        onMoveShouldSetPanResponder:          () => gesturesEnabledRef.current,
        onStartShouldSetPanResponderCapture:  () => gesturesEnabledRef.current,
        onMoveShouldSetPanResponderCapture:   () => gesturesEnabledRef.current,

        onPanResponderGrant: (evt) => {
          if (!gesturesEnabledRef.current) return;
          userInteractedRef.current = true;
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            const dx   = touches[1].pageX - touches[0].pageX;
            const dy   = touches[1].pageY - touches[0].pageY;
            pinchDistRef.current  = Math.sqrt(dx * dx + dy * dy);
            lastMidRef.current    = {
              x: (touches[0].pageX + touches[1].pageX) / 2,
              y: (touches[0].pageY + touches[1].pageY) / 2,
            };
          } else {
            lastTouchRef.current  = { x: touches[0].pageX, y: touches[0].pageY };
            pinchDistRef.current  = 0;
          }
        },

        onPanResponderMove: (evt) => {
          if (!gesturesEnabledRef.current) return;
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            // ── Pinch → zoom (scale orbit distance) ──────────────────────
            const dx   = touches[1].pageX - touches[0].pageX;
            const dy   = touches[1].pageY - touches[0].pageY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (pinchDistRef.current > 0) {
              // Pinch: shrink/grow orbit dist inversely
              const scaleDelta = dist / pinchDistRef.current;
              const maxZoomOutDist = Math.max(2, Math.min(80, baseDistRef.current || 80));
              distRef.current  = Math.max(2, Math.min(maxZoomOutDist, distRef.current / scaleDelta));

            }

            pinchDistRef.current = dist;
          } else if (touches.length === 1) {
            // ── Single finger → orbit ─────────────────────────────────────
            pinchDistRef.current = 0; // reset if second finger lifted
            const tx = touches[0].pageX;
            const ty = touches[0].pageY;
            const ddx = tx - lastTouchRef.current.x;
            const ddy = ty - lastTouchRef.current.y;
            lastTouchRef.current = { x: tx, y: ty };
            azimuthRef.current   -= ddx * 0.008;
            elevationRef.current  = Math.max(
              0.087,
              Math.min(1.484, elevationRef.current - ddy * 0.008),
            );
            const verticalSpeed = Math.max(0.01, distRef.current * 0.0035);
            cameraTargetRef.current.y = Math.max(
              -80,
              Math.min(80, cameraTargetRef.current.y - ddy * verticalSpeed),
            );
          }
        },

        onPanResponderRelease: () => {
          pinchDistRef.current = 0;
          lastTouchRef.current = { x: 0, y: 0 };
        },
        onPanResponderTerminate: () => {
          pinchDistRef.current = 0;
          lastTouchRef.current = { x: 0, y: 0 };
        },
      }),
    [],
  );

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    // Invalidate any previous RAF loop bound to an old GL session.
    const sessionId = contextSessionRef.current + 1;
    contextSessionRef.current = sessionId;
    cancelAnimationFrame(raffRef.current);
    rafLoopStats.active += 1;
    if (__DEV__) console.log(`[Building3DOverlay] GL session #${sessionId} start, activeRAF=${rafLoopStats.active}`);
    setErrorMsg('');
    setLoadState('loading');

    try {

    // Suppress expo-gl unsupported pixelStorei parameter
    const _orig = gl.pixelStorei.bind(gl);
    try {
      Object.defineProperty(gl, 'pixelStorei', {
        configurable: true, writable: false,
        value: (pname: number, param: number) => {
          if (pname === 0x9240) return;
          _orig(pname, param);
        },
      });
    } catch {
      // @ts-ignore
      gl.pixelStorei = (pname: number, param: number) => {
        if (pname === 0x9240) return;
        _orig(pname, param);
      };
    }

    // -- Renderer -------------------------------------------------------------
    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;
    if (DEBUG) console.log(`[3D] drawingBuffer: ${bufW}x${bufH}`);

    const renderer = new Renderer({ gl, width: bufW, height: bufH, pixelRatio: 1, alpha: true });
    // Expo GL can return undefined shader/program logs; THREE tries `.trim()`
    // when debug shader checks are enabled, which crashes in dev on some setups.
    // Disable this check for this renderer only (runtime behavior is unaffected).
    if (renderer.debug && typeof renderer.debug.checkShaderErrors === 'boolean') {
      renderer.debug.checkShaderErrors = false;
    }
    renderer.setSize(bufW, bufH, false);
    renderer.setViewport(0, 0, bufW, bufH);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled   = true;
    renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    // Required for per-material clipping planes
    renderer.localClippingEnabled = true;
    rendererRef.current = renderer as unknown as THREE.WebGLRenderer;

    // -- Scene ----------------------------------------------------------------
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // -- Lighting -------------------------------------------------------------
    scene.add(new THREE.HemisphereLight(0xc8d8f0, 0x6b4f2a, 0.4));

    const sun = new THREE.DirectionalLight(0xfff6e0, 3.0);
    sun.position.set(5, 12, 8);
    sun.castShadow             = true;
    sun.shadow.mapSize.width   = 2048;
    sun.shadow.mapSize.height  = 2048;
    sun.shadow.bias            = -0.0005;
    sun.shadow.camera.near     = 0.5;
    sun.shadow.camera.far      = 80;
    sun.shadow.camera.left     = -12;
    sun.shadow.camera.right    = 12;
    sun.shadow.camera.top      = 12;
    sun.shadow.camera.bottom   = -6;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xb0c8f0, 0.5);
    fill.position.set(-6, 4, -5);
    scene.add(fill);

    // -- Camera ---------------------------------------------------------------
    const camera = new THREE.PerspectiveCamera(40, bufW / bufH, 0.1, 500);
    camera.updateProjectionMatrix();
    cameraRef.current = camera;

    // -- Shadow-catcher -------------------------------------------------------
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.30 }),
    );
    catcher.rotation.x    = -Math.PI / 2;
    catcher.receiveShadow = true;
    scene.add(catcher);

    // -- Load GLB -------------------------------------------------------------
    let modelRoot: THREE.Group;
    try {
      // Always parse a textureless GLB variant in Expo Go.
      // This avoids GLTFLoader trying to create Blob(ArrayBuffer) for embedded textures.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelSource = modelUri?.trim() ? modelUri.trim() : DEFAULT_MODEL_ASSET;
      const gltf: any = await withTimeout(
        loadTexturelessGlb(modelSource),
        MODEL_LOAD_TIMEOUT_MS,
        'Model loading timed out. Verify your GLB URL or assets/models/EEB_015.glb.',
      );
      modelRoot = (gltf.scene ?? gltf) as THREE.Group;
      if (DEBUG) console.log('[Building3DOverlay] GLB loaded via textureless parser');
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const isOOM = /byte allocation|out of memory|OutOfMemory|growth limit|free bytes/i.test(raw);
      const msg = isOOM
        ? 'GLB file is too large for this device.\n\n'
          + 'Compress it to under 15 MB before uploading.\n\n'
          + 'Tools:\n'
          + '\u2022 gltf.report (browser, free)\n'
          + '\u2022 gltf-transform optimize (CLI)\n'
          + '\u2022 Blender \u2192 Export glTF 2.0 + Draco'
        : raw;
      console.error('[Building3DOverlay] GLB load failed:', raw);
      setErrorMsg(msg);
      setLoadState('error');
      return;
    }

    // -- Post-process meshes + clipping plane ---------------------------------
    // Clipping plane: keeps fragments where y <= constant (world space).
    // Normal (0,-1,0) + constant c  =>  -(y) + c >= 0  =>  y <= c.
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    modelRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow    = true;
      child.receiveShadow = true;
      const mats = (Array.isArray(child.material) ? child.material : [child.material]).filter(
        (mat): mat is THREE.Material => Boolean(mat),
      );
      if (mats.length === 0) return;
      mats.forEach((mat) => {
        mat.clippingPlanes  = [clipPlane];
        mat.clipShadows     = true;
        // Keep 3D View in non-textured mode: ignore any texture maps embedded in GLB.
        const m = mat as THREE.Material & {
          map?: THREE.Texture | null;
          normalMap?: THREE.Texture | null;
          roughnessMap?: THREE.Texture | null;
          metalnessMap?: THREE.Texture | null;
          aoMap?: THREE.Texture | null;
          emissiveMap?: THREE.Texture | null;
        };
        if ('map' in m) m.map = null;
        if ('normalMap' in m) m.normalMap = null;
        if ('roughnessMap' in m) m.roughnessMap = null;
        if ('metalnessMap' in m) m.metalnessMap = null;
        if ('aoMap' in m) m.aoMap = null;
        if ('emissiveMap' in m) m.emissiveMap = null;
        mat.needsUpdate = true;
      });
    });

    // -- Center model ---------------------------------------------------------
    const box = new THREE.Box3().setFromObject(modelRoot);
    if (box.isEmpty()) {
      const msg = 'Loaded GLB contains no visible geometry.\nVerify your GLB URL or replace assets/models/EEB_015.glb.';
      console.error('[Building3DOverlay]', msg);
      setErrorMsg(msg);
      setLoadState('error');
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    modelRoot.position.sub(center);
    scene.add(modelRoot);

    // World-space Y extents of the centred model
    const modelMinY = box.min.y - center.y;
    const modelMaxY = box.max.y - center.y;
    const modelH    = modelMaxY - modelMinY;

    // Shadow catcher at model bottom
    catcher.position.y = isFinite(modelMinY) ? modelMinY : 0;

    // -- Frame camera ---------------------------------------------------------
    const radius = Math.sqrt((size.x / 2) ** 2 + (size.y / 2) ** 2 + (size.z / 2) ** 2);
    cameraTargetRef.current.set(0, size.y * 0.45 - center.y, 0);
    distRef.current = frameCameraOnRadius(
      camera, radius, azimuthRef.current, elevationRef.current, cameraTargetRef.current,
    );
    baseDistRef.current = distRef.current; // 1x reference
    distRef.current = Math.max(
      2,
      Math.min(baseDistRef.current, baseDistRef.current / DEFAULT_VIEW3D_ZOOM),
    );
    defaultTargetRef.current.copy(cameraTargetRef.current);
    defaultDistRef.current = distRef.current;
    updateCamera(
      camera, distRef.current, azimuthRef.current, elevationRef.current, cameraTargetRef.current,
    );

    if (DEBUG) {
      console.log(`[3D] model ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}, minY=${modelMinY.toFixed(2)}, dist=${distRef.current.toFixed(2)}`);
    }

    // Initialise clip so entire model is hidden before Play is pressed
    // (show nothing below minY  i.e. constant = modelMinY means nothing visible yet)
    clipPlane.constant = modelMinY;

    // -- Scanline band --------------------------------------------------------
    // A horizontal PlaneGeometry that travels up with the clip front.
    // It has NO clippingPlanes so it is always drawn on top of the reveal edge.
    const footprintR = Math.max(size.x, size.z) * 0.6;
    const scanlineMat = new THREE.MeshBasicMaterial({
      color:      0x44ccff,
      transparent: true,
      opacity:    SCANLINE_OPACITY,
      side:       THREE.DoubleSide,
      depthWrite: false,
    });
    const scanline     = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 1.4, size.z * 1.4), scanlineMat);
    scanline.rotation.x = -Math.PI / 2;
    scanline.position.y = modelMinY;
    scanline.visible    = false;
    scene.add(scanline);

    setLoadState('ready');

    // -- Render loop ----------------------------------------------------------
    let lastBufW = bufW;
    let lastBufH = bufH;
    let lastTime = 0;
    // Snapshot animKey at loop start so we detect restarts
    let loopAnimKey = animKeyRef.current;
    let loopZoomCommandId = zoomCommandIdRef.current;

    const animate = (time: number = 0) => {
      if (contextSessionRef.current !== sessionId) return;
      raffRef.current = requestAnimationFrame(animate);

      if (!isActiveRef.current) {
        lastTime = time;
        return;
      }

      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      if (zoomCommandIdRef.current !== loopZoomCommandId) {
        loopZoomCommandId = zoomCommandIdRef.current;
        const wantsZoomIn = zoomCommandDirRef.current === 'in';
        const limits = zoomLimitsRef.current;
        if ((wantsZoomIn && limits.canZoomIn) || (!wantsZoomIn && limits.canZoomOut)) {
          userInteractedRef.current = true;
          applyZoomStep(wantsZoomIn);
        }
      }
      if (zoomHoldDirRef.current !== 0 && dt > 0) {
        const limits = zoomLimitsRef.current;
        const allowHold =
          (zoomHoldDirRef.current === 1 && limits.canZoomIn) ||
          (zoomHoldDirRef.current === -1 && limits.canZoomOut);
        if (allowHold) {
          userInteractedRef.current = true;
          const zoomSpeed = Math.max(ZOOM_HOLD_SPEED_BASE, distRef.current * 1.2);
          const nextDist = distRef.current - zoomHoldDirRef.current * zoomSpeed * dt;
          const maxZoomOutDist = Math.max(2, Math.min(80, baseDistRef.current || 80));
          distRef.current = Math.max(2, Math.min(maxZoomOutDist, nextDist));
        }
      }

      const manualControl = manualControlRef.current;
      if (dt > 0) {
        if (manualControl.azimuthDir !== 0) {
          azimuthRef.current += manualControl.azimuthDir * ROTATE_AZIMUTH_SPEED * dt;
        }
        if (manualControl.elevationDir !== 0) {
          elevationRef.current = Math.max(
            0.087,
            Math.min(1.484, elevationRef.current + manualControl.elevationDir * ROTATE_ELEVATION_SPEED * dt),
          );
        }
        if (manualControl.moveYDir !== 0) {
          const moveSpeed = Math.max(MOVE_TARGET_Y_SPEED_BASE, distRef.current * 0.85);
          cameraTargetRef.current.y = Math.max(
            -80,
            Math.min(80, cameraTargetRef.current.y + manualControl.moveYDir * moveSpeed * dt),
          );
        }
      }

      // Detect Play restart (animKey bumped)
      if (animKeyRef.current !== loopAnimKey) {
        loopAnimKey       = animKeyRef.current;
        buildTRef.current = 0;
      }

      // Advance buildT while playing
      const cfg = configRef.current;
      const maxFloors = MAX_FLOORS_FIXED;
      const usedFloors = Math.max(1, Math.min(maxFloors, cfg.floorCount));
      // targetFraction: how much of the model height to reveal, driven by floorCount
      const targetFraction = Math.max(0.05, Math.min(1, usedFloors / maxFloors));
      // Duration respects both floorCount and buildSpeed
      const buildDuration  = (usedFloors * FLOOR_BUILD_SEC) /
                              Math.max(0.1, cfg.buildSpeed);
      if (isPlayingRef.current && buildTRef.current < 1) {
        buildTRef.current = Math.min(1, buildTRef.current + dt / buildDuration);
      }

      const buildT = buildTRef.current;
      if (
        dt > 0 &&
        isPlayingRef.current &&
        buildT < 1 &&
        !userInteractedRef.current &&
        manualControl.azimuthDir === 0
      ) {
        azimuthRef.current += AUTO_ROTATE_RIGHT_SPEED * dt;
      }
      if (isPlayingRef.current && buildT >= 1 && !completionSentRef.current) {
        completionSentRef.current = true;
        onBuildCompleteRef.current?.();
      }

      // Compute revealY with per-floor softstepping, capped at targetFraction of model height.
      // This means +/- floor buttons immediately change how high the reveal goes.
      const progress = floorSmoothStep(buildT, usedFloors);
      const revealY  = modelMinY + progress * targetFraction * modelH;

      // Update clipping plane constant (geometry above revealY is invisible)
      clipPlane.constant = revealY;

      // Update scanline position and visibility.
      // Guard with isPlayingRef so the scanline hides immediately when play
      // stops (via STOP, timer, or build-complete) even if buildT is mid-range.
      if (isPlayingRef.current && buildT > 0.001 && buildT < 0.999) {
        scanline.visible    = true;
        scanline.position.y = revealY;
        const pulse = 0.55 + 0.45 * Math.sin(time * 0.008);
        scanlineMat.opacity = SCANLINE_OPACITY * pulse;
      } else {
        scanline.visible = false;
      }

      // Dynamic resize
      const curBufW = gl.drawingBufferWidth;
      const curBufH = gl.drawingBufferHeight;
      if (curBufW <= 0 || curBufH <= 0) return;
      const viewW = layoutSizeRef.current.width > 0 ? layoutSizeRef.current.width : curBufW;
      const viewH = layoutSizeRef.current.height > 0 ? layoutSizeRef.current.height : curBufH;
      if (curBufW !== lastBufW || curBufH !== lastBufH) {
        lastBufW = curBufW; lastBufH = curBufH;
        renderer.setSize(curBufW, curBufH, false);
        renderer.setViewport(0, 0, curBufW, curBufH);
        if (cameraRef.current) {
          cameraRef.current.aspect = viewW / Math.max(1, viewH);
          cameraRef.current.updateProjectionMatrix();
        }
      }

      // Orbit camera
      if (cameraRef.current && distRef.current > 0) {
        const targetAspect = viewW / Math.max(1, viewH);
        if (Math.abs(cameraRef.current.aspect - targetAspect) > 0.0001) {
          cameraRef.current.aspect = targetAspect;
          cameraRef.current.updateProjectionMatrix();
        }
        updateCamera(
          cameraRef.current, distRef.current,
          azimuthRef.current, elevationRef.current, cameraTargetRef.current,
        );
      }

      const camForMetrics = cameraRef.current ?? camera;
      const boxNow = new THREE.Box3().setFromObject(modelRoot);
      const worldCenter = boxNow.getCenter(new THREE.Vector3());
      let modelScreenX = viewW / 2;
      let modelScreenY = viewH / 2;
      let rectX = 0;
      let rectY = 0;
      let rectW = 0;
      let rectH = 0;
      const ndc = worldCenter.clone().project(camForMetrics);
      if (Number.isFinite(ndc.x) && Number.isFinite(ndc.y)) {
        modelScreenX = (ndc.x * 0.5 + 0.5) * viewW;
        modelScreenY = (-ndc.y * 0.5 + 0.5) * viewH;
      }
      const screenRect = getBBoxScreenRect(camForMetrics, boxNow, viewW, viewH);
      if (screenRect) {
        rectX = screenRect.x;
        rectY = screenRect.y;
        rectW = screenRect.w;
        rectH = screenRect.h;
      }
      const MIN_DIST = 2.0001;
      const MAX_DIST = Math.max(MIN_DIST, Math.min(79.9999, baseDistRef.current || 79.9999));
      let canZoomIn = distRef.current > MIN_DIST;
      const canZoomOut = distRef.current < MAX_DIST - 0.0001;
      if (screenRect && viewW > 0) {
        const edgeSlack = 2;
        const hitHorizontalEdge =
          screenRect.x <= edgeSlack ||
          screenRect.x + screenRect.w >= viewW - edgeSlack;
        const reachedWidthLimit = screenRect.w >= viewW * 0.96;
        if (hitHorizontalEdge || reachedWidthLimit) {
          canZoomIn = false;
        }
      }
      zoomLimitsRef.current = { canZoomIn, canZoomOut };
      const baseDist = Math.max(0.001, baseDistRef.current);
      const zoomValue = Math.max(
        1.0,
        Math.min(9.9, baseDist / Math.max(0.001, distRef.current)),
      );
      const nowMs = Date.now();
      if (DEBUG && nowMs - metricsTimeRef.current >= 120) {
        metricsTimeRef.current = nowMs;
        setDebugMetrics({
          previewCenterX: viewW / 2,
          previewCenterY: viewH / 2,
          glCenterX: viewW / 2,
          glCenterY: viewH / 2,
          modelScreenX,
          modelScreenY,
          modelRectX: rectX,
          modelRectY: rectY,
          modelRectW: rectW,
          modelRectH: rectH,
          modelWorldX: worldCenter.x,
          modelWorldY: worldCenter.y,
          modelWorldZ: worldCenter.z,
        });
      }
      const lastZoom = lastZoomReportRef.current;
      const roundedZoom = +zoomValue.toFixed(1);
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

      try {
        renderer.setRenderTarget(null);
        renderer.render(scene, cameraRef.current ?? camera);
        gl.endFrameEXP();
        if (warmupPendingRef.current) {
          warmupPendingRef.current = false;
          setIsWarmingUp(false);
        }
      } catch (err) {
        if (DEBUG) console.warn('[Building3DOverlay] render skipped:', err);
        if (contextSessionRef.current === sessionId) {
          contextSessionRef.current += 1;
          cancelAnimationFrame(raffRef.current);
        }
      }
    };

    raffRef.current = requestAnimationFrame(animate);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Building3DOverlay] Context init failed:', msg);
      if (contextSessionRef.current === sessionId) {
        setErrorMsg(msg);
        setLoadState('error');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    contextSessionRef.current += 1;
    cancelAnimationFrame(raffRef.current);
    if (sceneRef.current) { disposeObject3D(sceneRef.current); sceneRef.current = null; }
    if (rendererRef.current) { disposeRenderer(rendererRef.current); rendererRef.current = null; }
    rafLoopStats.active -= 1;
    if (__DEV__) logGlbStats();
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} onLayout={onRootLayout}>
      {/* PanResponder lives here — captures all touches before parent sees them */}
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      </View>

      {DEBUG && (
        <View style={styles.debugCoordsPanel} pointerEvents="none">
          <Text style={styles.debugCoordsText}>
            Preview center: ({(debugMetrics?.previewCenterX ?? 0).toFixed(1)}, {(debugMetrics?.previewCenterY ?? 0).toFixed(1)})
          </Text>
          <Text style={styles.debugCoordsText}>
            GL center: ({(debugMetrics?.glCenterX ?? 0).toFixed(1)}, {(debugMetrics?.glCenterY ?? 0).toFixed(1)})
          </Text>
          <Text style={styles.debugCoordsText}>
            Model screen: ({(debugMetrics?.modelScreenX ?? 0).toFixed(1)}, {(debugMetrics?.modelScreenY ?? 0).toFixed(1)})
          </Text>
          <Text style={styles.debugCoordsText}>
            Model box: x={(debugMetrics?.modelRectX ?? 0).toFixed(1)} y={(debugMetrics?.modelRectY ?? 0).toFixed(1)} w={(debugMetrics?.modelRectW ?? 0).toFixed(1)} h={(debugMetrics?.modelRectH ?? 0).toFixed(1)}
          </Text>
          <Text style={styles.debugCoordsText}>
            Delta model-vs-GL: ({((debugMetrics?.modelScreenX ?? 0) - (debugMetrics?.glCenterX ?? 0)).toFixed(1)},{' '}
            {((debugMetrics?.modelScreenY ?? 0) - (debugMetrics?.glCenterY ?? 0)).toFixed(1)})
          </Text>
          <Text style={styles.debugCoordsText}>
            Model world: ({(debugMetrics?.modelWorldX ?? 0).toFixed(2)}, {(debugMetrics?.modelWorldY ?? 0).toFixed(2)}, {(debugMetrics?.modelWorldZ ?? 0).toFixed(2)})
          </Text>
        </View>
      )}

      {(loadState === 'loading' || isWarmingUp) && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color="#00d4ff" size="large" />
          <Text style={styles.overlayText}>
            {loadState === 'loading' ? 'Loading model...' : 'Preparing view...'}
          </Text>
        </View>
      )}

      {loadState === 'error' && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.errorText}>Model failed to load</Text>
          <Text style={styles.errorDetail} numberOfLines={12}>{errorMsg}</Text>
        </View>
      )}

      {loadState === 'ready' && (
        <View style={styles.controlsRack}>
          <TouchableOpacity
            style={[styles.controlBtn, gesturesEnabled && styles.controlBtnActive]}
            onPress={() => setGesturesEnabled((v) => !v)}
            activeOpacity={0.8}
          >
            <Text style={styles.controlBtnText}>{'\u270B'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPressIn={() => setManualAzimuthDir(-1)}
            onPressOut={() => setManualAzimuthDir(0)}
            activeOpacity={0.8}
          >
            <Text style={[styles.controlBtnText, styles.circleLeft]}>{'\u27F3'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPressIn={() => setManualAzimuthDir(1)}
            onPressOut={() => setManualAzimuthDir(0)}
            activeOpacity={0.8}
          >
            <Text style={[styles.controlBtnText, styles.circleRight]}>{'\u27F3'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPressIn={() => setManualElevationDir(1)}
            onPressOut={() => setManualElevationDir(0)}
            activeOpacity={0.8}
          >
            <Text style={[styles.controlBtnText, styles.circleUp]}>{'\u27F3'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPressIn={() => setManualElevationDir(-1)}
            onPressOut={() => setManualElevationDir(0)}
            activeOpacity={0.8}
          >
            <Text style={[styles.controlBtnText, styles.circleDown]}>{'\u27F3'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPressIn={() => setManualMoveYDir(-1)}
            onPressOut={() => setManualMoveYDir(0)}
            activeOpacity={0.8}
          >
            <Text style={styles.controlBtnText}>{'\u2191'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPressIn={() => setManualMoveYDir(1)}
            onPressOut={() => setManualMoveYDir(0)}
            activeOpacity={0.8}
          >
            <Text style={styles.controlBtnText}>{'\u2193'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loadState === 'ready' && (
        <TouchableOpacity
          style={styles.resetBtn}
          onPress={resetCamera}
          activeOpacity={0.7}
        >
          <Text style={styles.resetBtnText}>{'\u27F3'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden', // never let content shift layout
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            12,
  },
  overlayText: {
    color:         '#00d4ff',
    fontSize:      13,
    letterSpacing: 1,
  },
  errorText: {
    color:      '#ff6b6b',
    fontSize:   15,
    fontWeight: '600',
  },
  errorDetail: {
    color:             'rgba(255,255,255,0.6)',
    fontSize:          11,
    textAlign:         'center',
    paddingHorizontal: 24,
  },
  debugCoordsPanel: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
    maxWidth: '84%',
  },
  debugCoordsText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  controlsRack: {
    position: 'absolute',
    right: 14,
    bottom: 72,
    gap: 6,
    alignItems: 'flex-end',
  },
  controlBtn: {
    width: 46,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnActive: {
    borderColor: '#00d4ff',
    backgroundColor: 'rgba(0,212,255,0.18)',
  },
  controlBtnText: {
    color: '#ffffff',
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
  circleLeft: {
    transform: [{ rotate: '180deg' }],
  },
  circleRight: {
    transform: [{ rotate: '0deg' }],
  },
  circleUp: {
    transform: [{ rotate: '-90deg' }],
  },
  circleDown: {
    transform: [{ rotate: '90deg' }],
  },
  resetBtn: {
    position:        'absolute',
    bottom:          16,
    right:           16,
    width:           46,
    height:          42,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  resetBtnText: {
    color:      '#ffffff',
    fontSize:   22,
    lineHeight: 24,
    fontWeight: '700',
  },
});

export default Building3DOverlay;
