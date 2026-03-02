import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import {
  useSharedValue,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { BlueprintOverlay } from './BlueprintOverlay';
import { FloatingParticles } from './FloatingParticles';
import { GroundShadow } from './GroundShadow';
import { BuildingConfig } from '../types';
import { loadTexturelessGlb, disposeObject3D, disposeRenderer, rafLoopStats, logGlbStats } from '../lib/glbLoader';

const PIXEL_TO_WORLD = 1 / 18;
const FLOOR_BUILD_SEC = 0.7 / 6; // blueprint speed x6
const FRUSTUM_PADDING = 1.25;
const PHASE2_BASE_DELAY = 1200;
const PHASE3_DELAY = 1200;
const PHASE4_DURATION = 3000;
const MODEL_ASSET = require('../../assets/models/EEB_015.glb');
const MAX_FLOORS_FIXED = 20;
const MODEL_LOAD_TIMEOUT_MS = 25000;
const BLUEPRINT_GRID_WORLD_SIZE = 22;
const BLUEPRINT_GRID_DIVISIONS = 10;
const BLUEPRINT_GRID_MAJOR_EVERY = 5;
const BLUEPRINT_GRID_MINOR_COLOR = 0x0b7ea0;
const BLUEPRINT_GRID_MAJOR_COLOR = 0x00d4ff;
const BLUEPRINT_GRID_OPACITY = 0.22;
const BLUEPRINT_EDGE_THRESHOLD_DEG = 35;
const BLUEPRINT_VIEW_AZIMUTH = Math.PI / 4;
const BLUEPRINT_VIEW_ELEVATION = (26 * Math.PI) / 180; // semi-isometric
const BLUEPRINT_MIN_ELEVATION = 0.087;
const BLUEPRINT_MAX_ELEVATION = 1.484;
const BLUEPRINT_ROTATE_AZIMUTH_SPEED = 1.9;
const BLUEPRINT_ROTATE_ELEVATION_SPEED = 1.2;
const BLUEPRINT_MOVE_TARGET_Y_SPEED_BASE = 2.4;
const BLUEPRINT_MIN_ZOOM = 0.6;
const BLUEPRINT_MAX_ZOOM = 3.4;

interface ManualControlState {
  azimuthDir: -1 | 0 | 1;
  elevationDir: -1 | 0 | 1;
  moveYDir: -1 | 0 | 1;
}

type CameraBasis = {
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
};

function createCameraBasis(azimuth: number, elevation: number): CameraBasis {
  const forward = new THREE.Vector3(
    -Math.cos(elevation) * Math.sin(azimuth),
    -Math.sin(elevation),
    -Math.cos(elevation) * Math.cos(azimuth),
  ).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp);
  if (right.lengthSq() < 1e-8) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { right, up, forward };
}

function projectPointToCameraPlane(point: THREE.Vector3, basis: CameraBasis): { x: number; y: number } {
  return {
    x: point.dot(basis.right),
    y: point.dot(basis.up),
  };
}

function getProjectedBoxExtents(
  box: THREE.Box3,
  basis: CameraBasis,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const min = box.min;
  const max = box.max;
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  corners.forEach((corner) => {
    const p = projectPointToCameraPlane(corner, basis);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });

  return { minX, maxX, minY, maxY };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
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

function updateBlueprintCamera(
  camera: THREE.OrthographicCamera,
  dist: number,
  azimuth: number,
  elevation: number,
  target: THREE.Vector3,
  zoom: number,
): void {
  const cosEl = Math.cos(elevation);
  camera.position.set(
    target.x + dist * cosEl * Math.sin(azimuth),
    target.y + dist * Math.sin(elevation),
    target.z + dist * cosEl * Math.cos(azimuth),
  );
  camera.lookAt(target);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}

function createBlueprintGrid(options: {
  size: number;
  divisions: number;
  majorEvery: number;
  minorColor: number;
  majorColor: number;
  opacity: number;
}): THREE.LineSegments {
  const size = Math.max(1, options.size);
  const divisions = Math.max(1, Math.floor(options.divisions));
  const majorEvery = Math.max(1, Math.floor(options.majorEvery));
  const half = size / 2;
  const step = size / divisions;
  const linesPerAxis = divisions + 1;
  const totalLines = linesPerAxis * 2;
  const vertexCount = totalLines * 2;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const minor = new THREE.Color(options.minorColor);
  const major = new THREE.Color(options.majorColor);

  let p = 0;
  let c = 0;
  const pushColor = (col: THREE.Color) => {
    colors[c++] = col.r; colors[c++] = col.g; colors[c++] = col.b;
    colors[c++] = col.r; colors[c++] = col.g; colors[c++] = col.b;
  };

  for (let i = 0; i <= divisions; i++) {
    const v = -half + i * step;
    const isMajor = i % majorEvery === 0 || i === 0 || i === divisions;
    const col = isMajor ? major : minor;

    // X-parallel line at z=v
    positions[p++] = -half; positions[p++] = 0; positions[p++] = v;
    positions[p++] = half; positions[p++] = 0; positions[p++] = v;
    pushColor(col);

    // Z-parallel line at x=v
    positions[p++] = v; positions[p++] = 0; positions[p++] = -half;
    positions[p++] = v; positions[p++] = 0; positions[p++] = half;
    pushColor(col);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: options.opacity,
  });

  const grid = new THREE.LineSegments(geometry, material);
  grid.position.set(0, 0, 0); // centered at world origin
  return grid;
}

interface Props {
  config: BuildingConfig;
  /** Optional GLB URL — if provided the blueprint renders this model instead of the bundled default. */
  modelUri?: string | null;
  active: boolean;
  animKey?: number;
  containerWidth?: number;
  containerHeight?: number;
  onBuildComplete?: () => void;
}

export const IsometricBlueprintView: React.FC<Props> = ({
  config,
  modelUri,
  active,
  animKey = 0,
  containerWidth = 300,
  containerHeight = 300,
  onBuildComplete,
}) => {
  const [phase, setPhase] = useState(0);
  const [gesturesEnabled, setGesturesEnabled] = useState(true);
  const [isGlReady, setIsGlReady] = useState(false);
  const [overlayFootprint, setOverlayFootprint] = useState(() => ({
    w: config.footprintW,
    h: config.footprintH,
  }));
  const [overlayModelHeight, setOverlayModelHeight] = useState(() =>
    Math.max(1, config.floorCount),
  );
  const shadowProgress = useSharedValue(0);

  const raffRef = useRef<number>(0);
  const isActiveRef = useRef(active);
  const buildTRef = useRef(0);
  const clipPlaneRef = useRef<THREE.Plane | null>(null);
  const totalHRef = useRef(0);
  const scanlineRef = useRef<THREE.Mesh | null>(null);
  const scanlineMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const onBuildCompleteRef = useRef<Props['onBuildComplete']>(onBuildComplete);
  const completionSentRef = useRef(false);
  const contextSessionRef = useRef(0);
  const rafActiveRef = useRef(false);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const azimuthRef = useRef(BLUEPRINT_VIEW_AZIMUTH);
  const elevationRef = useRef(BLUEPRINT_VIEW_ELEVATION);
  const cameraDistRef = useRef(0);
  const cameraZoomRef = useRef(1);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  const baseHalfWRef = useRef(1);
  const baseHalfHRef = useRef(1);
  const layoutSizeRef = useRef({ width: 0, height: 0 });
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const pinchDistRef = useRef(0);
  const gesturesEnabledRef = useRef(true);
  const manualControlRef = useRef<ManualControlState>({
    azimuthDir: 0,
    elevationDir: 0,
    moveYDir: 0,
  });

  useEffect(() => { isActiveRef.current = active; }, [active]);
  useEffect(() => { onBuildCompleteRef.current = onBuildComplete; }, [onBuildComplete]);
  useEffect(() => { gesturesEnabledRef.current = gesturesEnabled; }, [gesturesEnabled]);
  useEffect(() => {
    if (!active) {
      manualControlRef.current.azimuthDir = 0;
      manualControlRef.current.elevationDir = 0;
      manualControlRef.current.moveYDir = 0;
    }
  }, [active]);
  useEffect(() => {
    setOverlayFootprint({ w: config.footprintW, h: config.footprintH });
  }, [config.footprintW, config.footprintH]);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      buildTRef.current = 0;
      shadowProgress.value = 0;
      completionSentRef.current = false;
      return;
    }

    setPhase(1);
    const t2 = setTimeout(() => setPhase(2), PHASE2_BASE_DELAY);
    const t3 = setTimeout(() => setPhase(3), PHASE3_DELAY);

    shadowProgress.value = withDelay(
      PHASE2_BASE_DELAY,
      withTiming(1, { duration: PHASE4_DURATION, easing: Easing.out(Easing.cubic) }),
    );

    buildTRef.current = 0;
    completionSentRef.current = false;

    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, animKey]);

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      layoutSizeRef.current = { width, height };
    }
  }, []);

  const resetCamera = useCallback(() => {
    azimuthRef.current = BLUEPRINT_VIEW_AZIMUTH;
    elevationRef.current = BLUEPRINT_VIEW_ELEVATION;
    cameraTargetRef.current.set(0, 0, 0);
    cameraZoomRef.current = 1;
    manualControlRef.current.azimuthDir = 0;
    manualControlRef.current.elevationDir = 0;
    manualControlRef.current.moveYDir = 0;
  }, []);

  const setManualAzimuthDir = useCallback((dir: -1 | 0 | 1) => {
    manualControlRef.current.azimuthDir = dir;
  }, []);

  const setManualElevationDir = useCallback((dir: -1 | 0 | 1) => {
    manualControlRef.current.elevationDir = dir;
  }, []);

  const setManualMoveYDir = useCallback((dir: -1 | 0 | 1) => {
    manualControlRef.current.moveYDir = dir;
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => gesturesEnabledRef.current && isActiveRef.current,
      onMoveShouldSetPanResponder: () => gesturesEnabledRef.current && isActiveRef.current,
      onStartShouldSetPanResponderCapture: () => gesturesEnabledRef.current && isActiveRef.current,
      onMoveShouldSetPanResponderCapture: () => gesturesEnabledRef.current && isActiveRef.current,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          pinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
        } else if (touches.length === 1) {
          lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          pinchDistRef.current = 0;
        }
      },

      onPanResponderMove: (evt) => {
        if (!gesturesEnabledRef.current || !isActiveRef.current) return;
        const touches = evt.nativeEvent.touches;

        if (touches.length >= 2) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (pinchDistRef.current > 0) {
            const scaleDelta = dist / pinchDistRef.current;
            cameraZoomRef.current = Math.max(
              BLUEPRINT_MIN_ZOOM,
              Math.min(BLUEPRINT_MAX_ZOOM, cameraZoomRef.current * scaleDelta),
            );
          }
          pinchDistRef.current = dist;
          return;
        }

        if (touches.length === 1) {
          pinchDistRef.current = 0;
          const tx = touches[0].pageX;
          const ty = touches[0].pageY;
          const ddx = tx - lastTouchRef.current.x;
          const ddy = ty - lastTouchRef.current.y;
          lastTouchRef.current = { x: tx, y: ty };

          azimuthRef.current -= ddx * 0.008;
          elevationRef.current = Math.max(
            BLUEPRINT_MIN_ELEVATION,
            Math.min(BLUEPRINT_MAX_ELEVATION, elevationRef.current - ddy * 0.008),
          );

          const verticalSpeed = Math.max(0.01, cameraDistRef.current * 0.0035);
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
  ).current;

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    const sessionId = contextSessionRef.current + 1;
    contextSessionRef.current = sessionId;
    cancelAnimationFrame(raffRef.current);
    setIsGlReady(false);

    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;

    const renderer = new Renderer({ gl, width: bufW, height: bufH, pixelRatio: 1, alpha: true });
    if (renderer.debug && typeof renderer.debug.checkShaderErrors === 'boolean') {
      renderer.debug.checkShaderErrors = false;
    }
    renderer.setSize(bufW, bufH, false);
    renderer.setViewport(0, 0, bufW, bufH);
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;
    rendererRef.current = renderer as unknown as THREE.WebGLRenderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const blueprintGrid = createBlueprintGrid({
      size: BLUEPRINT_GRID_WORLD_SIZE,
      divisions: BLUEPRINT_GRID_DIVISIONS,
      majorEvery: BLUEPRINT_GRID_MAJOR_EVERY,
      minorColor: BLUEPRINT_GRID_MINOR_COLOR,
      majorColor: BLUEPRINT_GRID_MAJOR_COLOR,
      opacity: BLUEPRINT_GRID_OPACITY,
    });
    scene.add(blueprintGrid);

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    clipPlaneRef.current = clipPlane;
    const CYAN = 0x00d4ff;

    const makeFallbackModel = (): THREE.Group => {
      const group = new THREE.Group();
      const fw = Math.max(2, config.footprintW * PIXEL_TO_WORLD);
      const fd = Math.max(2, config.footprintH * PIXEL_TO_WORLD);
      const fh = Math.max(4, config.floorCount * 0.9);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(fw, fh, fd),
        new THREE.MeshBasicMaterial({
          color: CYAN,
          wireframe: true,
          transparent: true,
          opacity: 0.85,
          clippingPlanes: [clipPlane],
          depthWrite: false,
        }),
      );
      group.add(mesh);
      return group;
    };

    let modelRoot: THREE.Group;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelSource = modelUri?.trim() ? modelUri.trim() : MODEL_ASSET;
      const gltf: any = await withTimeout(
        loadTexturelessGlb(modelSource),
        MODEL_LOAD_TIMEOUT_MS,
        'Blueprint GLB loading timed out',
      );
      modelRoot = (gltf.scene ?? gltf) as THREE.Group;
    } catch {
      modelRoot = makeFallbackModel();
    }

    let sourceBox = new THREE.Box3().setFromObject(modelRoot);
    if (sourceBox.isEmpty()) {
      modelRoot = makeFallbackModel();
      sourceBox = new THREE.Box3().setFromObject(modelRoot);
    }

    const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
    modelRoot.position.sub(sourceCenter);
    const centeredBox = new THREE.Box3().setFromObject(modelRoot);

    modelRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (!(child.geometry instanceof THREE.BufferGeometry)) return;

      const edgeGeometry = new THREE.EdgesGeometry(child.geometry, BLUEPRINT_EDGE_THRESHOLD_DEG);
      const edgeVertexCount = edgeGeometry.attributes.position?.count ?? 0;
      if (edgeVertexCount === 0) {
        edgeGeometry.dispose();
        return;
      }

      const edgeMaterial = new THREE.LineBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.9,
        clippingPlanes: [clipPlane],
        depthWrite: false,
      });
      const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      edgeLines.position.copy(child.position);
      edgeLines.quaternion.copy(child.quaternion);
      edgeLines.scale.copy(child.scale);
      edgeLines.renderOrder = 3;
      child.parent?.add(edgeLines);
      child.visible = false;
    });

    scene.add(modelRoot);

    const box = centeredBox;
    const size = box.getSize(new THREE.Vector3());
    const bW = Math.max(0.1, size.x);
    const bD = Math.max(0.1, size.z);
    const modelMinY = box.min.y;
    const modelMaxY = box.max.y;
    const modelH = Math.max(0.001, modelMaxY - modelMinY);
    totalHRef.current = modelH;
    setOverlayModelHeight((prev) => (Math.abs(prev - modelH) < 0.01 ? prev : modelH));
    const detectedFootprintW = Math.max(1, bW / PIXEL_TO_WORLD);
    const detectedFootprintH = Math.max(1, bD / PIXEL_TO_WORLD);
    setOverlayFootprint((prev) => {
      if (
        Math.abs(prev.w - detectedFootprintW) < 0.1 &&
        Math.abs(prev.h - detectedFootprintH) < 0.1
      ) {
        return prev;
      }
      return { w: detectedFootprintW, h: detectedFootprintH };
    });

    const cameraBasis = createCameraBasis(BLUEPRINT_VIEW_AZIMUTH, BLUEPRINT_VIEW_ELEVATION);
    const projected = getProjectedBoxExtents(box, cameraBasis);
    const baseHalfW = Math.max(
      0.1,
      Math.max(Math.abs(projected.minX), Math.abs(projected.maxX)) * FRUSTUM_PADDING,
    );
    const baseHalfH = Math.max(
      0.1,
      Math.max(Math.abs(projected.minY), Math.abs(projected.maxY)) * FRUSTUM_PADDING,
    );

    const initialViewW = layoutSizeRef.current.width > 0 ? layoutSizeRef.current.width : bufW;
    const initialViewH = layoutSizeRef.current.height > 0 ? layoutSizeRef.current.height : bufH;
    const screenAspect = initialViewW / Math.max(1, initialViewH);
    let viewHalfH = baseHalfH;
    let viewHalfW = viewHalfH * screenAspect;
    if (viewHalfW < baseHalfW) {
      viewHalfW = baseHalfW;
      viewHalfH = viewHalfW / screenAspect;
    }

    const camDist = Math.max(bW, bD, modelH) * 2.5;
    const cam = new THREE.OrthographicCamera(
      -viewHalfW,
      viewHalfW,
      viewHalfH,
      -viewHalfH,
      0.01,
      camDist * 6,
    );
    cameraRef.current = cam;
    cameraDistRef.current = camDist;
    baseHalfWRef.current = baseHalfW;
    baseHalfHRef.current = baseHalfH;
    resetCamera();
    updateBlueprintCamera(
      cam,
      cameraDistRef.current,
      azimuthRef.current,
      elevationRef.current,
      cameraTargetRef.current,
      cameraZoomRef.current,
    );

    const scanlineMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.30,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanSize = Math.max(bW, bD) * 1.2;
    const scanGeo = new THREE.PlaneGeometry(scanSize, scanSize);
    scanGeo.rotateX(-Math.PI / 2);
    const scanline = new THREE.Mesh(scanGeo, scanlineMat);
    scanline.visible = false;
    scene.add(scanline);
    scanlineRef.current = scanline;
    scanlineMatRef.current = scanlineMat;

    clipPlane.constant = modelMinY - 0.01;
    if (contextSessionRef.current === sessionId) {
      setIsGlReady(true);
    }

    let lastTime = 0;
    let lastBufW = bufW;
    let lastBufH = bufH;
    const usedFloors = Math.max(1, Math.min(MAX_FLOORS_FIXED, config.floorCount));

    const animate = (time: number = 0) => {
      if (contextSessionRef.current !== sessionId) return;
      raffRef.current = requestAnimationFrame(animate);

      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      const manualControl = manualControlRef.current;
      if (dt > 0) {
        if (manualControl.azimuthDir !== 0) {
          azimuthRef.current += manualControl.azimuthDir * BLUEPRINT_ROTATE_AZIMUTH_SPEED * dt;
        }
        if (manualControl.elevationDir !== 0) {
          elevationRef.current = Math.max(
            BLUEPRINT_MIN_ELEVATION,
            Math.min(
              BLUEPRINT_MAX_ELEVATION,
              elevationRef.current + manualControl.elevationDir * BLUEPRINT_ROTATE_ELEVATION_SPEED * dt,
            ),
          );
        }
        if (manualControl.moveYDir !== 0) {
          const moveSpeed = Math.max(
            BLUEPRINT_MOVE_TARGET_Y_SPEED_BASE,
            cameraDistRef.current * 0.85,
          );
          cameraTargetRef.current.y = Math.max(
            -80,
            Math.min(80, cameraTargetRef.current.y + manualControl.moveYDir * moveSpeed * dt),
          );
        }
      }

      const dur = usedFloors * FLOOR_BUILD_SEC;
      if (isActiveRef.current && buildTRef.current < 1) {
        buildTRef.current = Math.min(1, buildTRef.current + dt / dur);
      }

      const t = buildTRef.current;
      if (isActiveRef.current && t >= 1 && !completionSentRef.current) {
        completionSentRef.current = true;
        onBuildCompleteRef.current?.();
      }

      const tH = totalHRef.current;
      const cp = clipPlaneRef.current;
      const sl = scanlineRef.current;
      const sm = scanlineMatRef.current;

      if (cp && tH > 0) {
        if (!isActiveRef.current && t <= 0) {
          cp.constant = modelMinY - 0.01;
          if (scanlineRef.current) {
            scanlineRef.current.visible = false;
          }
          return;
        }

        const scaled = t * usedFloors;
        const floorIdx = Math.floor(Math.min(scaled, usedFloors - 0.001));
        const local = scaled - floorIdx;
        const eased = local * local * (3 - 2 * local);
        const revealFrac = (floorIdx + eased) / usedFloors;
        const targetFraction = Math.max(0.05, Math.min(1, usedFloors / MAX_FLOORS_FIXED));
        const revealY = modelMinY + revealFrac * targetFraction * tH;

        cp.constant = revealY;

        if (sl && sm) {
          if (t > 0.001 && t < 0.999) {
            sl.visible = true;
            sl.position.y = revealY;
            sm.opacity = 0.20 + 0.15 * Math.sin(time * 0.006);
          } else {
            sl.visible = false;
          }
        }
      }

      const cw = gl.drawingBufferWidth;
      const ch = gl.drawingBufferHeight;
      if (cw !== lastBufW || ch !== lastBufH) {
        lastBufW = cw;
        lastBufH = ch;
        renderer.setSize(cw, ch, false);
        renderer.setViewport(0, 0, cw, ch);

        const viewW = layoutSizeRef.current.width > 0 ? layoutSizeRef.current.width : cw;
        const viewH = layoutSizeRef.current.height > 0 ? layoutSizeRef.current.height : ch;
        const newAspect = viewW / Math.max(1, viewH);
        let newHalfH = baseHalfHRef.current;
        let newHalfW = newHalfH * newAspect;
        if (newHalfW < baseHalfWRef.current) {
          newHalfW = baseHalfWRef.current;
          newHalfH = newHalfW / newAspect;
        }
        cam.left = -newHalfW;
        cam.right = newHalfW;
        cam.top = newHalfH;
        cam.bottom = -newHalfH;
        cam.updateProjectionMatrix();
      }

      try {
        updateBlueprintCamera(
          cam,
          cameraDistRef.current,
          azimuthRef.current,
          elevationRef.current,
          cameraTargetRef.current,
          cameraZoomRef.current,
        );
        renderer.render(scene, cam);
        gl.endFrameEXP();
      } catch {
        cancelAnimationFrame(raffRef.current);
      }
    };

    if (!rafActiveRef.current) { rafActiveRef.current = true; rafLoopStats.active += 1; }
    if (__DEV__) console.log(`[IsometricBlueprintView] GL session #${sessionId} RAF started, activeRAF=${rafLoopStats.active}`);
    raffRef.current = requestAnimationFrame(animate);
  }, [config.floorCount, config.footprintW, config.footprintH, resetCamera]);

  useEffect(() => () => {
    contextSessionRef.current += 1;
    cancelAnimationFrame(raffRef.current);
    if (sceneRef.current) { disposeObject3D(sceneRef.current); sceneRef.current = null; }
    if (rendererRef.current) { disposeRenderer(rendererRef.current); rendererRef.current = null; }
    if (rafActiveRef.current) { rafActiveRef.current = false; rafLoopStats.active -= 1; }
    if (__DEV__) logGlbStats();
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} onLayout={onRootLayout}>
      <BlueprintOverlay
        active={phase >= 1}
        opacity={phase === 0 ? 0 : phase >= 2 ? 0.18 : 1}
        width={containerWidth}
        height={containerHeight}
        footprintW={overlayFootprint.w}
        footprintH={overlayFootprint.h}
        floorCount={overlayModelHeight}
        viewAzimuth={BLUEPRINT_VIEW_AZIMUTH}
        viewElevation={BLUEPRINT_VIEW_ELEVATION}
      />

      <GroundShadow
        progress={shadowProgress}
        width={containerWidth}
        height={containerHeight}
      />

      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      </View>

      <FloatingParticles
        active={phase >= 3}
        width={containerWidth}
        height={containerHeight}
        count={40}
        color="#00d4ff"
      />

      {isGlReady && active && (
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

      {isGlReady && active && (
        <TouchableOpacity style={styles.resetBtn} onPress={resetCamera} activeOpacity={0.7}>
          <Text style={styles.resetBtnText}>{'\u27F3'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
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
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 46,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtnText: {
    color: '#ffffff',
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
});

export default IsometricBlueprintView;
