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

// ── Tunables ──────────────────────────────────────────────────────────────────
const FLOOR_BUILD_SEC  = 0.7 / 3;   // seconds per floor (default 3× speed)
const SCANLINE_OPACITY = 0.20;
const DEFAULT_AZIMUTH   = Math.PI / 6;
const DEFAULT_ELEVATION = 0.6;

// World plane scale: the full image rect = WORLD_W x (WORLD_W * imageAspect) metres
const WORLD_W = 20;

// UV tiling repeat for PBR textures (higher = smaller tiles on facade)
const TEXTURE_SCALE = 4;

// Set to true during development to see a red sphere at the polygon centroid
const DEBUG_CENTROID = false;

// ── Props ─────────────────────────────────────────────────────────────────────
interface Procedural3DBuildingProps {
  config: BuildingFootprintConfig;
  isPlaying: boolean;
  animKey: number;
  cameraResetKey?: number;
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

// ── Component ─────────────────────────────────────────────────────────────────
export const Procedural3DBuilding: React.FC<Procedural3DBuildingProps> = ({
  config,
  isPlaying,
  animKey,
  cameraResetKey,
}) => {
  const [glReady, setGlReady] = useState(false);

  const raffRef      = useRef<number>(0);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const configRef    = useRef(config);
  const animKeyRef   = useRef(animKey);
  const buildTRef    = useRef(0);

  const azimuthRef      = useRef(DEFAULT_AZIMUTH);
  const elevationRef    = useRef(DEFAULT_ELEVATION);
  const distRef         = useRef(30);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  // Stores the world-space centroid so resetCamera() can return to the right spot
  const centroidRef     = useRef(new THREE.Vector3(0, 0, 0));
  const pinchDistRef    = useRef(0);
  const lastMidRef      = useRef({ x: 0, y: 0 });
  const lastTouchRef    = useRef({ x: 0, y: 0 });

  // ── Scene-object refs (allow rebuild without recreating GL context) ────────
  const sceneRef         = useRef<THREE.Scene | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const clipPlaneRef     = useRef<THREE.Plane | null>(null);
  const totalHRef        = useRef(0);
  const scanlineRef      = useRef<THREE.Mesh | null>(null);
  const scanlineMatRef   = useRef<THREE.MeshBasicMaterial | null>(null);
  const texRef           = useRef<BuildingTextures | null>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { configRef.current    = config;    }, [config]);
  useEffect(() => {
    if (animKeyRef.current !== animKey) {
      animKeyRef.current = animKey;
      buildTRef.current  = 0;
    }
  }, [animKey]);

  // ── Rebuild geometry whenever floor-count or footprint-scale changes ──────
  // (normPoints stringify to detect polygon changes without infinite loops)
  const normPointsKey = config.normPoints.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('|');
  useEffect(() => {
    // Delay slightly so configRef is updated before we read it
    const id = setTimeout(() => { buildGeometry(); }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.floorCount, config.footprintScale, normPointsKey]);

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
      });
      buildingGroupRef.current = null;
    }

    const cfg    = configRef.current;
    const totalH = cfg.floorCount * cfg.floorHeightM;
    totalHRef.current = totalH;

    const npts   = cfg.normPoints;
    const WORLD_H = WORLD_W * (cfg.imageAspect ?? 1);
    let cX = 0, cZ = 0;
    if (npts.length >= 3) {
      for (const p of npts) { cX += (p.x - 0.5) * WORLD_W; cZ += (p.y - 0.5) * WORLD_H; }
      cX /= npts.length; cZ /= npts.length;
    }
    centroidRef.current.set(cX, totalH / 2, cZ);

    const footprint     = polygonToFootprint(npts, cfg.footprintScale * 12);
    const buildingGroup = new THREE.Group();
    buildingGroup.position.set(cX, 0, cZ);
    scene.add(buildingGroup);
    buildingGroupRef.current = buildingGroup;

    // Shape + extrude
    const shape = new THREE.Shape();
    footprint.points.forEach((p, i) => { if (i === 0) shape.moveTo(p.x, p.z); else shape.lineTo(p.x, p.z); });
    shape.closePath();
    const extrudeGeo = new THREE.ExtrudeGeometry(shape, { depth: totalH, bevelEnabled: false });
    extrudeGeo.rotateX(-Math.PI / 2);
    const uvAttr = extrudeGeo.getAttribute('uv');
    if (uvAttr) extrudeGeo.setAttribute('uv2', uvAttr);

    // PBR material — reuse cached textures so rebuild is fast
    let buildMat: THREE.MeshStandardMaterial;
    try {
      const tex = texRef.current ?? await loadBuildingTextures(TEXTURE_SCALE);
      texRef.current = tex;
      buildMat = new THREE.MeshStandardMaterial({
        map:            tex.albedo,
        aoMap:          tex.ao,
        aoMapIntensity: 1.0,
        normalMap:      tex.normal,
        roughnessMap:   tex.roughness,
        roughness:      1.0,
        metalness:      0.05,
      });
    } catch {
      buildMat = new THREE.MeshStandardMaterial({ color: 0x6699bb, roughness: 0.65, metalness: 0.15 });
    }

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    buildMat.clippingPlanes = [clipPlane];
    buildMat.clipShadows    = true;
    clipPlaneRef.current    = clipPlane;

    const buildMesh = new THREE.Mesh(extrudeGeo, buildMat);
    buildMesh.castShadow = buildMesh.receiveShadow = true;
    buildingGroup.add(buildMesh);

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

    const WIN_OFFSET = 0.07;  // metres proud of wall (prevents z-fighting)
    const WIN_BAY_W  = 2.2;   // target bay width
    const WIN_W_FRAC = 0.52;  // window width as fraction of bay
    const WIN_H_FRAC = 0.50;  // window height as fraction of floor height
    const MIN_WALL   = 1.2;   // walls shorter than this get no windows

    const windowMat = new THREE.MeshStandardMaterial({
      color:             0x0a1e30,
      emissive:          0x1a5090,
      emissiveIntensity: 0.45,
      roughness:         0.08,
      metalness:         0.85,
      transparent:       true,
      opacity:           0.80,
      clippingPlanes:    [clipPlane],
      side:              THREE.FrontSide,
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

      const numWin = Math.max(1, Math.round(wallLen / WIN_BAY_W));
      const winW   = (wallLen / numWin) * WIN_W_FRAC;
      const winH   = cfg.floorHeightM * WIN_H_FRAC;

      for (let f = 0; f < cfg.floorCount; f++) {
        const centerY = (f + 0.5) * cfg.floorHeightM;   // +Y is up ✓

        for (let w = 0; w < numWin; w++) {
          const t  = (w + 0.5) / numWin;
          const px = ax + t * ddx + nx * WIN_OFFSET;   // step along wall in X
          const pz = az + t * ddz + nz * WIN_OFFSET;   // step along wall in Z (post-rotation)

          const winGeo = new THREE.PlaneGeometry(winW, winH);
          winGeo.rotateY(faceAngle);
          const winMesh = new THREE.Mesh(winGeo, windowMat);
          winMesh.position.set(px, centerY, pz);
          winMesh.castShadow = false;
          buildingGroup.add(winMesh);
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

    // Auto-reframe camera to fit the new building
    const bbox    = new THREE.Box3().setFromObject(buildingGroup);
    const bsize   = bbox.getSize(new THREE.Vector3());
    const cam     = cameraRef.current;
    if (cam) {
      const radius = Math.max(bsize.x, bsize.y, bsize.z) * 0.75;
      const fovR   = (cam.fov * Math.PI) / 180;
      distRef.current = Math.max(5, (radius * 1.4) / Math.tan(fovR / 2));
    }
    cameraTargetRef.current.copy(centroidRef.current);

    // Reset animation progress so the building re-reveals
    buildTRef.current = 0;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetCamera = useCallback(() => {
    azimuthRef.current   = DEFAULT_AZIMUTH;
    elevationRef.current = DEFAULT_ELEVATION;
    // Also reframe distance around centroid
    const cam = cameraRef.current;
    if (cam && buildingGroupRef.current) {
      const bbox   = new THREE.Box3().setFromObject(buildingGroupRef.current);
      const bsize  = bbox.getSize(new THREE.Vector3());
      const radius = Math.max(bsize.x, bsize.y, bsize.z) * 0.75;
      const fovR   = (cam.fov * Math.PI) / 180;
      distRef.current = Math.max(5, (radius * 1.4) / Math.tan(fovR / 2));
    }
    cameraTargetRef.current.copy(centroidRef.current);
  }, []);

  useEffect(() => {
    if (cameraResetKey !== undefined) resetCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraResetKey]);

  // ── Multi-touch PanResponder ──────────────────────────────────────────────
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder:        () => true,
        onMoveShouldSetPanResponder:         () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture:  () => true,

        onPanResponderGrant: (evt) => {
          const touches = evt.nativeEvent.touches;
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
          if (touches.length >= 2) {
            const dx   = touches[1].pageX - touches[0].pageX;
            const dy   = touches[1].pageY - touches[0].pageY;
            const d    = Math.hypot(dx, dy);
            const midX = (touches[0].pageX + touches[1].pageX) / 2;
            const midY = (touches[0].pageY + touches[1].pageY) / 2;

            if (pinchDistRef.current > 0 && d > 0) {
              // Pinch → zoom
              const scale = d / pinchDistRef.current;
              distRef.current = Math.max(3, Math.min(100, distRef.current / scale));

              // 2-finger pan → move camera target
              const dmx = midX - lastMidRef.current.x;
              const dmy = midY - lastMidRef.current.y;
              const sp  = distRef.current * 0.003;
              const cosAz = Math.cos(azimuthRef.current);
              const sinAz = Math.sin(azimuthRef.current);
              cameraTargetRef.current.x -= dmx * cosAz * sp;
              cameraTargetRef.current.z += dmx * sinAz * sp;
              cameraTargetRef.current.y -= dmy * sp * 0.6;
            }

            pinchDistRef.current = d;
            lastMidRef.current   = { x: midX, y: midY };
          } else if (touches.length === 1) {
            // orbit
            pinchDistRef.current = 0;
            const tx  = touches[0].pageX;
            const ty  = touches[0].pageY;
            const ddx = tx - lastTouchRef.current.x;
            const ddy = ty - lastTouchRef.current.y;
            lastTouchRef.current = { x: tx, y: ty };
            azimuthRef.current   -= ddx * 0.008;
            elevationRef.current  = Math.max(0.05, Math.min(1.48, elevationRef.current - ddy * 0.008));
          }
        },

        onPanResponderRelease: () => { pinchDistRef.current = 0; },
        onPanResponderTerminate: () => { pinchDistRef.current = 0; },
      }),
    [],
  );

  // ── GL context ───────────────────────────────────────────────────────────
  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
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

    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;

    const renderer = new Renderer({ gl, width: bufW, height: bufH, pixelRatio: 1, alpha: true });
    renderer.setSize(bufW, bufH, false);
    renderer.setViewport(0, 0, bufW, bufH);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace     = THREE.SRGBColorSpace;
    renderer.toneMapping          = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure  = 1.2;
    renderer.shadowMap.enabled    = true;
    renderer.shadowMap.type       = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Lighting
    scene.add(new THREE.HemisphereLight(0xc8d8f0, 0x6b4f2a, 0.5));
    const sun = new THREE.DirectionalLight(0xfff6e0, 2.8);
    sun.position.set(8, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.bias           = -0.0005;
    scene.add(sun);
    scene.add(new THREE.DirectionalLight(0xb0c8f0, 0.4).translateX(-6).translateY(4).translateZ(-5));

    // Shadow catcher (static — centred at origin; building group moves to centroid)
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.25 }),
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    scene.add(catcher);

    // Camera
    const cam = new THREE.PerspectiveCamera(40, bufW / bufH, 0.1, 500);
    cameraRef.current = cam;

    // Pre-load textures (cached — subsequent calls are instant)
    try { texRef.current = await loadBuildingTextures(TEXTURE_SCALE); } catch { /* fallback handled in buildGeometry */ }

    // Build initial geometry
    await buildGeometry();

    setGlReady(true);

    // Render loop
    let lastBufW  = bufW;
    let lastBufH  = bufH;
    let lastTime  = 0;
    let loopKey   = animKeyRef.current;

    const animate = (time: number = 0) => {
      raffRef.current = requestAnimationFrame(animate);

      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime  = time;

      // Reset on new animKey
      if (animKeyRef.current !== loopKey) {
        loopKey           = animKeyRef.current;
        buildTRef.current = 0;
      }

      const cfg2   = configRef.current;
      const floors = Math.max(1, cfg2.floorCount);
      const dur    = floors * FLOOR_BUILD_SEC;
      if (isPlayingRef.current && buildTRef.current < 1) {
        buildTRef.current = Math.min(1, buildTRef.current + dt / dur);
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

        clipPlane.constant = revealY;

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

      // Resize
      const cw = gl.drawingBufferWidth;
      const ch = gl.drawingBufferHeight;
      if (cw !== lastBufW || ch !== lastBufH) {
        lastBufW = cw; lastBufH = ch;
        renderer.setSize(cw, ch, false);
        renderer.setViewport(0, 0, cw, ch);
        if (cameraRef.current) {
          cameraRef.current.aspect = cw / ch;
          cameraRef.current.updateProjectionMatrix();
        }
      }

      // Orbit
      if (cameraRef.current) {
        updateCamera(cameraRef.current, distRef.current, azimuthRef.current, elevationRef.current, cameraTargetRef.current);
      }

      renderer.render(scene, cameraRef.current ?? cam);
      gl.endFrameEXP();
    };

    raffRef.current = requestAnimationFrame(animate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cancelAnimationFrame(raffRef.current); }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      </View>

      {!glReady && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="#00d4ff" />
          <Text style={styles.loadingText}>Building scene…</Text>
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

});
