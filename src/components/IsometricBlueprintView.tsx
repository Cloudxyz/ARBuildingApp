/**
 * src/components/IsometricBlueprintView.tsx
 *
 * Replaces <BuildingAnimation> in the BLUEPRINT demo mode only.
 *
 * TRUE ISOMETRIC PROJECTION
 * ─────────────────────────
 *   THREE.OrthographicCamera positioned at (d, d, d) relative to the
 *   building centroid.  This gives:
 *     azimuth   = 45°
 *     elevation = arctan(1/√2) ≈ 35.264°   — the canonical isometric angle
 *
 *   With equal XYZ offsets → all three axes project at equal angles.
 *   Parallel lines remain parallel; no FOV distortion.
 *
 * COORDINATE SPACE
 * ─────────────────
 *   +Y  = up (building height)
 *   XZ  = footprint plane
 *   Building centroid = (0, 0, 0); top of building = (0, totalH, 0)
 *
 * ANIMATION
 * ─────────
 *   Clip plane at Y=0 reveals the building bottom-to-top per floor,
 *   with the same smoothstep easing as Procedural3DBuilding.
 *   Phase timings mirror BuildingAnimation so the surrounding UI
 *   (particles, shadow, blueprint SVG grid) stays in sync.
 *
 * DOES NOT TOUCH:
 *   src/ar/Building3DOverlay.tsx  (3D View)
 *   src/magic/Procedural3DBuilding.tsx  (3D Magic)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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

// ── Tunables ──────────────────────────────────────────────────────────────────

/** Converts footprint pixels (e.g. 160 px) → world metres. */
const PIXEL_TO_WORLD = 1 / 18;

/** Seconds of reveal per floor (matches Procedural3DBuilding 3× speed). */
const FLOOR_BUILD_SEC = 0.4;

/** How much empty space around the building inside the frustum (1.0 = tight). */
const FRUSTUM_PADDING = 1.25;

// Phase timings — mirror BuildingAnimation.tsx so the composited layers sync
const PHASE2_BASE_DELAY = 1200;   // ms — when floors start / blueprint fades
const PHASE3_DELAY      = 1200;   // ms — floating particles start
const PHASE4_DURATION   = 3000;   // ms — shadow builds

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  config: BuildingConfig;
  active: boolean;
  containerWidth?: number;
  containerHeight?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
export const IsometricBlueprintView: React.FC<Props> = ({
  config,
  active,
  containerWidth  = 300,
  containerHeight = 300,
}) => {
  // Phase for composited 2-D layers (blueprint grid, particles, shadow)
  const [phase, setPhase]     = useState(0);
  const shadowProgress        = useSharedValue(0);

  // GL refs
  const raffRef        = useRef<number>(0);
  const isActiveRef    = useRef(active);
  const buildTRef      = useRef(0);
  const clipPlaneRef   = useRef<THREE.Plane | null>(null);
  const totalHRef      = useRef(0);
  const scanlineRef    = useRef<THREE.Mesh | null>(null);
  const scanlineMatRef = useRef<THREE.MeshBasicMaterial | null>(null);

  // Keep isActiveRef current
  useEffect(() => { isActiveRef.current = active; }, [active]);

  // ── Phase control (mirrors BuildingAnimation timing) ─────────────────────
  useEffect(() => {
    if (!active) {
      setPhase(0);
      buildTRef.current    = 0;
      shadowProgress.value = 0;
      return;
    }

    setPhase(1);   // blueprint grid visible
    const t2 = setTimeout(() => setPhase(2), PHASE2_BASE_DELAY);  // floors/isometric appear
    const t3 = setTimeout(() => setPhase(3), PHASE3_DELAY);        // particles

    shadowProgress.value = withDelay(
      PHASE2_BASE_DELAY,
      withTiming(1, { duration: PHASE4_DURATION, easing: Easing.out(Easing.cubic) }),
    );

    // Start clip animation when entering active state
    buildTRef.current = 0;

    return () => { clearTimeout(t2); clearTimeout(t3); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── GL context creation ───────────────────────────────────────────────────
  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;

    const renderer = new Renderer({ gl, width: bufW, height: bufH, pixelRatio: 1, alpha: true });
    renderer.setSize(bufW, bufH, false);
    renderer.setViewport(0, 0, bufW, bufH);
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    // ── Building dimensions ──────────────────────────────────────────────────
    //   footprintW / footprintH are in screen pixels; convert to world metres.
    const bW     = config.footprintW * PIXEL_TO_WORLD;   // X extent
    const bD     = config.footprintH * PIXEL_TO_WORLD;   // Z extent
    const floorH = 1.0;                                   // world metres per floor
    const floors = config.floorCount;
    const totalH = floors * floorH;
    totalHRef.current = totalH;

    // Building centroid for camera target (vertically centred)
    const center = new THREE.Vector3(0, totalH / 2, 0);

    // ── TRUE ISOMETRIC OrthographicCamera ────────────────────────────────────
    //
    //   Camera at (d, d, d) relative to building centroid.
    //
    //   In this configuration the three world axes project as follows:
    //     +Y  → screen-up               (vertical edges stay vertical ✓)
    //     +X  → screen down-right at 30°
    //     +Z  → screen down-left  at 30°
    //   This is the canonical true isometric angle.
    //
    //   projected screen widths of the building footprint:
    //     x_proj = (bW + bD) * cos(30°) = (bW + bD) * √3/2
    //   projected screen height:
    //     y_proj = (bW + bD) * sin(30°) + totalH = (bW + bD)/2 + totalH
    //
    const projW = Math.sqrt(3) / 2 * (bW + bD);
    const projH = (bW + bD) / 2 + totalH;

    // Choose a frustum half-height so the full projected building fits,
    // then set the width from the actual screen aspect ratio.
    const screenAspect = bufW / bufH;
    let viewHalfH = (projH / 2) * FRUSTUM_PADDING;
    let viewHalfW = viewHalfH * screenAspect;
    // If width doesn't fit, grow both dimensions proportionally
    if (viewHalfW < (projW / 2) * FRUSTUM_PADDING) {
      viewHalfW = (projW / 2) * FRUSTUM_PADDING;
      viewHalfH = viewHalfW / screenAspect;
    }

    const camDist = Math.max(bW, bD, totalH) * 2.5;

    const cam = new THREE.OrthographicCamera(
      -viewHalfW, viewHalfW,
       viewHalfH, -viewHalfH,
      0.01, camDist * 6,
    );

    // Position at equal XYZ offset → azimuth 45°, elevation 35.264°
    cam.position.set(
      center.x + camDist,
      center.y + camDist,
      center.z + camDist,
    );
    cam.lookAt(center);
    cam.updateProjectionMatrix();

    // ── Clip plane — reveals building bottom-to-top ──────────────────────────
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    clipPlaneRef.current = clipPlane;

    // ── Materials ────────────────────────────────────────────────────────────
    const CYAN = 0x00d4ff;

    const edgeMat = new THREE.LineBasicMaterial({
      color:          CYAN,
      clippingPlanes: [clipPlane],
    });
    const faceMat = new THREE.MeshBasicMaterial({
      color:       CYAN,
      transparent: true,
      opacity:     0.04,
      side:        THREE.DoubleSide,
      clippingPlanes: [clipPlane],
      depthWrite:  false,
    });
    const floorLineMat = new THREE.LineBasicMaterial({
      color:          0x0099cc,
      clippingPlanes: [clipPlane],
    });
    const winMat = new THREE.LineBasicMaterial({
      color:          0x44aaff,
      clippingPlanes: [clipPlane],
      transparent:    true,
      opacity:        0.75,
    });

    // ── Building box ─────────────────────────────────────────────────────────
    // Edges wireframe (the ful outer silhouette)
    const boxGeo = new THREE.BoxGeometry(bW, totalH, bD);
    boxGeo.translate(0, totalH / 2, 0);
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), edgeMat));

    // Transparent face fill (very subtle, keeps blueprint feel)
    const fillGeo = new THREE.BoxGeometry(bW, totalH, bD);
    fillGeo.translate(0, totalH / 2, 0);
    scene.add(new THREE.Mesh(fillGeo, faceMat));

    // ── Floor separation lines ────────────────────────────────────────────────
    //   Loop for each floor slab edge (inner lines between floors).
    //   Lines are horizontal rectangles at each y = f * floorH.
    const hW = bW / 2;
    const hD = bD / 2;
    for (let f = 1; f < floors; f++) {
      const y = f * floorH;
      const pts = [
        new THREE.Vector3(-hW, y, -hD),
        new THREE.Vector3( hW, y, -hD),
        new THREE.Vector3( hW, y,  hD),
        new THREE.Vector3(-hW, y,  hD),
        new THREE.Vector3(-hW, y, -hD),  // close loop
      ];
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        floorLineMat,
      ));
    }

    // ── Window outlines (front +Z face and right +X face) ─────────────────────
    //   Windows are LineLoop rectangles slightly proud of the wall face.
    //   We only draw on two visible faces from the isometric camera +X/+Z
    //   vantage (the camera is at +X,+Z so those two faces are visible).
    const WIN_OFFSET = 0.02;  // prevents z-fighting

    // Helper: add a wireframe window loop to the scene
    const addWindow = (pts: THREE.Vector3[]) => {
      const closed = [...pts, pts[0]];
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(closed),
        winMat,
      ));
    };

    // Front face: z = +hD, windows walk along X
    {
      const numWin = Math.max(1, Math.round(bW / 2.0));
      const winW   = (bW / numWin) * 0.45;
      const winH   = floorH * 0.42;
      const z      = hD + WIN_OFFSET;
      for (let f = 0; f < floors; f++) {
        const cy = (f + 0.5) * floorH;
        for (let w = 0; w < numWin; w++) {
          const cx = -hW + (w + 0.5) * (bW / numWin);
          addWindow([
            new THREE.Vector3(cx - winW / 2, cy - winH / 2, z),
            new THREE.Vector3(cx + winW / 2, cy - winH / 2, z),
            new THREE.Vector3(cx + winW / 2, cy + winH / 2, z),
            new THREE.Vector3(cx - winW / 2, cy + winH / 2, z),
          ]);
        }
      }
    }

    // Right face: x = +hW, windows walk along Z
    {
      const numWin = Math.max(1, Math.round(bD / 2.0));
      const winW   = (bD / numWin) * 0.45;
      const winH   = floorH * 0.42;
      const x      = hW + WIN_OFFSET;
      for (let f = 0; f < floors; f++) {
        const cy = (f + 0.5) * floorH;
        for (let w = 0; w < numWin; w++) {
          const cz = -hD + (w + 0.5) * (bD / numWin);
          addWindow([
            new THREE.Vector3(x, cy - winH / 2, cz - winW / 2),
            new THREE.Vector3(x, cy - winH / 2, cz + winW / 2),
            new THREE.Vector3(x, cy + winH / 2, cz + winW / 2),
            new THREE.Vector3(x, cy + winH / 2, cz - winW / 2),
          ]);
        }
      }
    }

    // ── Scanline highlight ────────────────────────────────────────────────────
    const scanlineMat = new THREE.MeshBasicMaterial({
      color:       CYAN,
      transparent: true,
      opacity:     0.30,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    });
    const scanGeo  = new THREE.PlaneGeometry(bW * 1.1, bD * 1.1);
    scanGeo.rotateX(-Math.PI / 2);
    const scanline = new THREE.Mesh(scanGeo, scanlineMat);
    scanline.visible = false;
    scene.add(scanline);
    scanlineRef.current    = scanline;
    scanlineMatRef.current = scanlineMat;

    // Start fully hidden
    clipPlane.constant = 0;

    // ── Render loop ───────────────────────────────────────────────────────────
    let lastTime = 0;
    let lastBufW = bufW;
    let lastBufH = bufH;

    const animate = (time: number = 0) => {
      raffRef.current = requestAnimationFrame(animate);

      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // Advance clip progress while active
      const dur = floors * FLOOR_BUILD_SEC;
      if (isActiveRef.current && buildTRef.current < 1) {
        buildTRef.current = Math.min(1, buildTRef.current + dt / dur);
      }

      const t   = buildTRef.current;
      const tH  = totalHRef.current;
      const cp  = clipPlaneRef.current;
      const sl  = scanlineRef.current;
      const sm  = scanlineMatRef.current;

      if (cp && tH > 0) {
        // Per-floor smoothstep reveal (same as Procedural3DBuilding)
        const scaled     = t * floors;
        const floorIdx   = Math.floor(Math.min(scaled, floors - 0.001));
        const local      = scaled - floorIdx;
        const eased      = local * local * (3 - 2 * local);
        const revealFrac = (floorIdx + eased) / floors;
        const revealY    = revealFrac * tH;

        cp.constant = revealY;

        if (sl && sm) {
          if (t > 0.001 && t < 0.999) {
            sl.visible    = true;
            sl.position.y = revealY;
            sm.opacity    = 0.20 + 0.15 * Math.sin(time * 0.006);
          } else {
            sl.visible = false;
          }
        }
      }

      // Handle canvas resize
      const cw = gl.drawingBufferWidth;
      const ch = gl.drawingBufferHeight;
      if (cw !== lastBufW || ch !== lastBufH) {
        lastBufW = cw; lastBufH = ch;
        renderer.setSize(cw, ch, false);
        renderer.setViewport(0, 0, cw, ch);
        // Recompute frustum for new aspect ratio (maintain world-space fit)
        const newAspect = cw / ch;
        let newHalfH = (projH / 2) * FRUSTUM_PADDING;
        let newHalfW = newHalfH * newAspect;
        if (newHalfW < (projW / 2) * FRUSTUM_PADDING) {
          newHalfW = (projW / 2) * FRUSTUM_PADDING;
          newHalfH = newHalfW / newAspect;
        }
        cam.left   = -newHalfW;
        cam.right  =  newHalfW;
        cam.top    =  newHalfH;
        cam.bottom = -newHalfH;
        cam.updateProjectionMatrix();
      }

      renderer.render(scene, cam);
      gl.endFrameEXP();
    };

    raffRef.current = requestAnimationFrame(animate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelAnimationFrame(raffRef.current), []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Blueprint SVG grid — fades to subtle once isometric building appears */}
      <BlueprintOverlay
        active={phase >= 1}
        opacity={phase >= 2 ? 0.18 : 1}
        width={containerWidth}
        height={containerHeight}
        footprintW={config.footprintW}
        footprintH={config.footprintH}
        floorCount={config.floorCount}
      />

      {/* Ground shadow (driven by Reanimated SharedValue) */}
      <GroundShadow
        progress={shadowProgress}
        width={containerWidth}
        height={containerHeight}
      />

      {/* Isometric wireframe building — GL layer on top of grid */}
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />

      {/* Floating particles appear in phase 3 */}
      <FloatingParticles
        active={phase >= 3}
        width={containerWidth}
        height={containerHeight}
        count={40}
        color="#00d4ff"
      />
    </View>
  );
};

export default IsometricBlueprintView;
