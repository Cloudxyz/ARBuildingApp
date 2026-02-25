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
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer, loadAsync } from 'expo-three';
import * as THREE from 'three';
import { ARModelConfig } from '../types';

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------
const MODEL_ASSET = require('../../assets/models/EEB_015.glb');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
/** Seconds to reveal each floor when buildSpeed === 1 */
const FLOOR_BUILD_SEC  = 0.8;
/** Peak opacity of the scan-plane at the reveal front (0 = off) */
const SCANLINE_OPACITY = 0.18;

// ---------------------------------------------------------------------------
// Camera defaults
// ---------------------------------------------------------------------------
const DEFAULT_AZIMUTH   = Math.PI / 4;
const DEFAULT_ELEVATION = 0.775;

const DEBUG = false;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Building3DOverlayProps {
  config: ARModelConfig;
  isPlaying: boolean;
  animKey: number;
  width: number;
  height: number;
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
  const dist   = Math.max(4, (radius * 1.35) / Math.tan(fovRad / 2));
  updateCamera(camera, dist, azimuth, elevation, target);
  return dist;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const Building3DOverlay: React.FC<Building3DOverlayProps> = ({
  config,
  isPlaying,
  animKey,
}) => {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg]   = useState('');

  // Refs used inside the render-loop closure (avoids stale captures)
  const isPlayingRef = useRef(isPlaying);
  const configRef    = useRef(config);
  const animKeyRef   = useRef(animKey);
  const buildTRef    = useRef(0);      // animation progress [0..1]
  const raffRef      = useRef<number>(0);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);

  const azimuthRef      = useRef(DEFAULT_AZIMUTH);
  const elevationRef    = useRef(DEFAULT_ELEVATION);
  const distRef         = useRef(0);
  const lastTouchRef    = useRef({ x: 0, y: 0 });
  const cameraTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  // Multi-touch pinch & 2-finger pan
  const pinchDistRef    = useRef(0);          // previous distance between 2 fingers
  const lastMidRef      = useRef({ x: 0, y: 0 }); // previous midpoint of 2 fingers

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { configRef.current    = config;    }, [config]);
  useEffect(() => {
    // animKey changes when Play is pressed  restart the reveal
    if (animKeyRef.current !== animKey) {
      animKeyRef.current = animKey;
      buildTRef.current  = 0;
    }
  }, [animKey]);

  const resetCamera = useCallback(() => {
    azimuthRef.current   = DEFAULT_AZIMUTH;
    elevationRef.current = DEFAULT_ELEVATION;
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture immediately so no parent (ScrollView, GestureDetector) steals the touch
        onStartShouldSetPanResponder:         () => true,
        onMoveShouldSetPanResponder:          () => true,
        onStartShouldSetPanResponderCapture:  () => true,
        onMoveShouldSetPanResponderCapture:   () => true,

        onPanResponderGrant: (evt) => {
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
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            // ── Pinch → zoom (scale orbit distance) ──────────────────────
            const dx   = touches[1].pageX - touches[0].pageX;
            const dy   = touches[1].pageY - touches[0].pageY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const midX = (touches[0].pageX + touches[1].pageX) / 2;
            const midY = (touches[0].pageY + touches[1].pageY) / 2;

            if (pinchDistRef.current > 0) {
              // Pinch: shrink/grow orbit dist inversely
              const scaleDelta = dist / pinchDistRef.current;
              distRef.current  = Math.max(2, Math.min(80, distRef.current / scaleDelta));

              // 2-finger drag → pan camera target in world space
              const dmx      = midX - lastMidRef.current.x;
              const dmy      = midY - lastMidRef.current.y;
              const panSpeed = distRef.current * 0.003;
              const cosAz    = Math.cos(azimuthRef.current);
              const sinAz    = Math.sin(azimuthRef.current);
              // Left/right → world XZ relative to camera azimuth; up/down → world Y
              cameraTargetRef.current.x -= dmx * cosAz * panSpeed;
              cameraTargetRef.current.z += dmx * sinAz * panSpeed;
              cameraTargetRef.current.y -= dmy * panSpeed * 0.6;
            }

            pinchDistRef.current = dist;
            lastMidRef.current   = { x: midX, y: midY };
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
    renderer.setSize(bufW, bufH, false);
    renderer.setViewport(0, 0, bufW, bufH);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace    = THREE.SRGBColorSpace;
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.shadowMap.enabled   = true;
    renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    // Required for per-material clipping planes
    renderer.localClippingEnabled = true;

    // -- Scene ----------------------------------------------------------------
    const scene = new THREE.Scene();

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gltf: any = await loadAsync(MODEL_ASSET);
      modelRoot = (gltf.scene ?? gltf) as THREE.Group;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Building3DOverlay] GLB load failed:', msg);
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
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        mat.clippingPlanes  = [clipPlane];
        mat.clipShadows     = true;
        if (mat instanceof THREE.MeshStandardMaterial) {
          if (mat.map)         mat.map.colorSpace         = THREE.SRGBColorSpace;
          if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        }
        mat.needsUpdate = true;
      });
    });

    // -- Center model ---------------------------------------------------------
    const box = new THREE.Box3().setFromObject(modelRoot);
    if (box.isEmpty()) {
      const msg = 'EEB_015.glb contains no visible geometry.\nReplace assets/models/EEB_015.glb with the real model file and reload.';
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

    const animate = (time: number = 0) => {
      raffRef.current = requestAnimationFrame(animate);

      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // Detect Play restart (animKey bumped)
      if (animKeyRef.current !== loopAnimKey) {
        loopAnimKey       = animKeyRef.current;
        buildTRef.current = 0;
      }

      // Advance buildT while playing
      const cfg = configRef.current;
      // MAX_FLOORS matches the stepper ceiling in the camera screen (Math.min(20, ...))
      const MAX_FLOORS     = 20;
      // targetFraction: how much of the model height to reveal, driven by floorCount
      const targetFraction = Math.max(0.05, Math.min(1, cfg.floorCount / MAX_FLOORS));
      // Duration respects both floorCount and buildSpeed
      const buildDuration  = (Math.max(1, cfg.floorCount) * FLOOR_BUILD_SEC) /
                              Math.max(0.1, cfg.buildSpeed);
      if (isPlayingRef.current && buildTRef.current < 1) {
        buildTRef.current = Math.min(1, buildTRef.current + dt / buildDuration);
      }

      const buildT = buildTRef.current;

      // Compute revealY with per-floor softstepping, capped at targetFraction of model height.
      // This means +/- floor buttons immediately change how high the reveal goes.
      const progress = floorSmoothStep(buildT, Math.max(1, cfg.floorCount));
      const revealY  = modelMinY + progress * targetFraction * modelH;

      // Update clipping plane constant (geometry above revealY is invisible)
      clipPlane.constant = revealY;

      // Update scanline position and visibility
      if (buildT > 0.001 && buildT < 0.999) {
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
      if (curBufW !== lastBufW || curBufH !== lastBufH) {
        lastBufW = curBufW; lastBufH = curBufH;
        renderer.setSize(curBufW, curBufH, false);
        renderer.setViewport(0, 0, curBufW, curBufH);
        if (cameraRef.current) {
          cameraRef.current.aspect = curBufW / curBufH;
          cameraRef.current.updateProjectionMatrix();
        }
      }

      // Orbit camera
      if (cameraRef.current && distRef.current > 0) {
        updateCamera(
          cameraRef.current, distRef.current,
          azimuthRef.current, elevationRef.current, cameraTargetRef.current,
        );
      }

      renderer.render(scene, cameraRef.current ?? camera);
      gl.endFrameEXP();
    };

    raffRef.current = requestAnimationFrame(animate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cancelAnimationFrame(raffRef.current); }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      {/* PanResponder lives here — captures all touches before parent sees them */}
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      </View>

      {loadState === 'loading' && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color="#00d4ff" size="large" />
          <Text style={styles.overlayText}>Loading model...</Text>
        </View>
      )}

      {loadState === 'error' && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.errorText}>Model failed to load</Text>
          <Text style={styles.errorDetail} numberOfLines={4}>{errorMsg}</Text>
        </View>
      )}

      {loadState === 'ready' && (
        <TouchableOpacity
          style={styles.resetBtn}
          onPress={resetCamera}
          activeOpacity={0.7}
        >
          <Text style={styles.resetBtnText}>{'⟳'}</Text>
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
  resetBtn: {
    position:        'absolute',
    bottom:          16,
    right:           16,
    width:           44,
    height:          44,
    borderRadius:    22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  resetBtnText: {
    color:      '#ffffff',
    fontSize:   22,
    lineHeight: 26,
  },
});

export default Building3DOverlay;