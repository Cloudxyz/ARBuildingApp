/**
 * src/magic/MagicCanvasMode.tsx
 *
 * 3D Magic — three internal phases, zero new routes.
 *
 * KEY DESIGN DECISIONS
 * ─────────────────────
 * • Photo is rendered at an EXPLICIT absolute rect (bottom-aligned contain)
 *   rather than absoluteFill+resizeMode so we know exactly where pixels are.
 * • Polygon points are stored in CANVAS coordinates (natural for SVG overlay).
 * • For 3D footprint, each point is converted to IMAGE-LOCAL (u,v) ∈ [0,1]
 *   by subtracting imageRect offset and dividing by imageRect size.
 *   This gives the correct proportions regardless of letterboxing.
 * • In build3d the GLView is positioned over the polygon bounding box on screen
 *   (canvas coords), so the building appears in the right place visually.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';
import { Procedural3DBuilding } from './Procedural3DBuilding';

import { NormPoint, BuildingFootprintConfig } from './types';
import Building3DOverlay from '../ar/Building3DOverlay';
import { ARModelConfig } from '../types';
import { useUnitTypeModels } from '../hooks/useUnits';
import { polygonToFootprint } from './PolygonToFootprint';

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = 'pick' | 'draw' | 'build3d';
interface Pt { x: number; y: number; }
export interface MagicBuildPanelState {
  phase: Phase;
  isPlaying: boolean;
  floorCount: number;
  zoomValue: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  magicMode: 'generate' | 'model';
  selectedModelType: 'house' | 'building' | 'commercial';
  resolvedModelUrl: string | null;
}

// ── Snap (draw phase only) ────────────────────────────────────────────────────
const CLOSE_RADIUS = 24;
const AXIS_RATIO   = 0.28;
const GRID_SIZE    = 16;
const ZOOM_HOLD_DELAY_MS = 140;

function snap(raw: Pt, pts: Pt[], grid: boolean): { pt: Pt; close: boolean } {
  if (pts.length >= 3) {
    const f = pts[0];
    if (Math.hypot(raw.x - f.x, raw.y - f.y) < CLOSE_RADIUS) return { pt: f, close: true };
  }
  let { x, y } = raw;
  if (pts.length >= 1) {
    const l = pts[pts.length - 1];
    const adx = Math.abs(raw.x - l.x), ady = Math.abs(raw.y - l.y);
    if (ady < adx * AXIS_RATIO) y = l.y;
    else if (adx < ady * AXIS_RATIO) x = l.x;
  }
  if (grid) { x = Math.round(x / GRID_SIZE) * GRID_SIZE; y = Math.round(y / GRID_SIZE) * GRID_SIZE; }
  return { pt: { x, y }, close: false };
}

// ── Image-rect helper (contain + bottom-align) ─────────────────────────────
interface ImgRect { left: number; top: number; w: number; h: number; }

function computeImageRect(
  canvasW: number, canvasH: number,
  photoW: number,  photoH: number,
): ImgRect {
  if (!photoW || !photoH || !canvasW || !canvasH) {
    return { left: 0, top: 0, w: canvasW, h: canvasH };
  }
  const scale  = Math.min(canvasW / photoW, canvasH / photoH);
  const dW     = photoW * scale;
  const dH     = photoH * scale;
  const left   = (canvasW - dW) / 2;
  const top    = canvasH - dH; // bottom-aligned contain (preserves aspect ratio)
  return { left, top, w: dW, h: dH };
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  width: number;
  height: number;
  active?: boolean;
  showBuildToolbar?: boolean;
  playCommandId?: number;
  stopCommandId?: number;
  incFloorCommandId?: number;
  decFloorCommandId?: number;
  externalZoomCommandId?: number;
  externalZoomCommandDir?: 'in' | 'out';
  externalZoomHoldDir?: -1 | 0 | 1;
  onBuildStateChange?: (state: MagicBuildPanelState) => void;
  magicMode?: 'generate' | 'model';
  selectedModelType?: 'house' | 'building' | 'commercial';
  onMagicModeChange?: (mode: 'generate' | 'model') => void;
  onModelTypeChange?: (type: 'house' | 'building' | 'commercial') => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MagicCanvasMode({
  width,
  height,
  active = true,
  showBuildToolbar = true,
  playCommandId = 0,
  stopCommandId = 0,
  incFloorCommandId = 0,
  decFloorCommandId = 0,
  externalZoomCommandId = 0,
  externalZoomCommandDir = 'in',
  externalZoomHoldDir = 0,
  onBuildStateChange,
  magicMode = 'generate',
  selectedModelType = 'house',
  onMagicModeChange,
  onModelTypeChange,
}: Props) {
  const [phase,       setPhase]     = useState<Phase>('pick');
  const [photoUri,    setPhotoUri]  = useState<string | null>(null);
  const [photoNatW,   setPhotoNatW] = useState(0);  // natural / original pixel size
  const [photoNatH,   setPhotoNatH] = useState(0);
  const [canvasW,     setCanvasW]   = useState(width);
  const [canvasH,     setCanvasH]   = useState(height);
  const [points,      setPoints]    = useState<Pt[]>([]);
  const [closed,      setClosed]    = useState(false);
  const [gridOn,      setGridOn]    = useState(true);
  const [floorCount,  setFloorCount] = useState(magicMode === 'model' ? 20 : 5);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [animKey,        setAnimKey]        = useState(0);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [zoomCmdId, setZoomCmdId] = useState(0);
  const [zoomCmdDir, setZoomCmdDir] = useState<'in' | 'out'>('in');
  const [zoomHoldDir, setZoomHoldDir] = useState<-1 | 0 | 1>(0);
  const [zoomUi, setZoomUi] = useState(1.0);
  const [canZoomIn, setCanZoomIn] = useState(true);
  const [canZoomOut, setCanZoomOut] = useState(true);
  const [manualAzimuthDir,   setManualAzimuthDir]   = useState<-1 | 0 | 1>(0);
  const [manualElevationDir, setManualElevationDir] = useState<-1 | 0 | 1>(0);
  const [manualMoveYDir,     setManualMoveYDir]     = useState<-1 | 0 | 1>(0);
  const [gesturesDisabled,   setGesturesDisabled]   = useState(false);
  const zoomHoldStartedRef = useRef(false);
  const zoomHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playCommandRef = useRef(playCommandId);
  const stopCommandRef = useRef(stopCommandId);
  const incFloorCommandRef = useRef(incFloorCommandId);
  const decFloorCommandRef = useRef(decFloorCommandId);
  const externalZoomCommandRef = useRef(externalZoomCommandId);
  const buildStateCbRef = useRef(onBuildStateChange);
  const wasActiveRef = useRef(active);
  const prevMagicModeRef = useRef(magicMode);

  const viewShotRef = useRef<ViewShot>(null);

  // Global type model URLs (for model mode)
  const { modelsByType } = useUnitTypeModels();
  const resolvedModelUrl = useMemo(() => {
    const m = modelsByType[selectedModelType];
    return m?.model_glb_url ?? m?.external_model_glb_url ?? null;
  }, [modelsByType, selectedModelType]);

  // Track actual canvas layout (may differ from prop if parent resizes)
  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setCanvasW(e.nativeEvent.layout.width);
    setCanvasH(e.nativeEvent.layout.height);
  }, []);
  React.useEffect(() => { buildStateCbRef.current = onBuildStateChange; }, [onBuildStateChange]);
  // Reset floors to mode default when mode switches
  React.useEffect(() => {
    setFloorCount(magicMode === 'model' ? 20 : 5);
  }, [magicMode]);

  // Auto-replay when returning to the tab in Generate mode, or when switching
  // from Model → Generate, so the building never appears "cut".
  React.useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    const switchedToGenerate = magicMode === 'generate' && prevMagicModeRef.current === 'model';
    wasActiveRef.current = active;
    prevMagicModeRef.current = magicMode;
    if ((becameActive || switchedToGenerate) && phase === 'build3d' && magicMode === 'generate') {
      setAnimKey((k) => k + 1);
      setIsPlaying(true);
    }
  }, [active, phase, magicMode]);
  const handleZoomMetrics = useCallback((metrics: {
    zoomValue: number;
    canZoomIn: boolean;
    canZoomOut: boolean;
  }) => {
    setZoomUi(+metrics.zoomValue.toFixed(1));
    setCanZoomIn(metrics.canZoomIn);
    setCanZoomOut(metrics.canZoomOut);
  }, []);

  const triggerZoom = useCallback((dir: 'in' | 'out') => {
    if (dir === 'in' && !canZoomIn) return;
    if (dir === 'out' && !canZoomOut) return;
    setZoomCmdDir(dir);
    setZoomCmdId((k) => k + 1);
  }, [canZoomIn, canZoomOut]);

  const startZoomHold = useCallback((dir: -1 | 1) => {
    if ((dir === 1 && !canZoomIn) || (dir === -1 && !canZoomOut)) return;
    zoomHoldStartedRef.current = false;
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
      zoomHoldTimerRef.current = null;
    }
    zoomHoldTimerRef.current = setTimeout(() => {
      zoomHoldStartedRef.current = true;
      setZoomHoldDir(dir);
    }, ZOOM_HOLD_DELAY_MS);
  }, [canZoomIn, canZoomOut]);

  const stopZoomHold = useCallback(() => {
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
      zoomHoldTimerRef.current = null;
    }
    setZoomHoldDir(0);
  }, []);

  const handleZoomTap = useCallback((dir: -1 | 1) => {
    if (zoomHoldStartedRef.current) {
      zoomHoldStartedRef.current = false;
      return;
    }
    if (dir === 1) {
      triggerZoom('in');
    } else {
      triggerZoom('out');
    }
  }, [triggerZoom]);

  React.useEffect(() => {
    if (zoomHoldDir === 1 && !canZoomIn) {
      setZoomHoldDir(0);
    } else if (zoomHoldDir === -1 && !canZoomOut) {
      setZoomHoldDir(0);
    }
  }, [zoomHoldDir, canZoomIn, canZoomOut]);

  React.useEffect(() => () => {
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (playCommandRef.current !== playCommandId) {
      playCommandRef.current = playCommandId;
      if (phase === 'build3d') {
        setAnimKey((k) => k + 1);
        setIsPlaying(true);
      }
    }
  }, [playCommandId, phase]);

  React.useEffect(() => {
    if (stopCommandRef.current !== stopCommandId) {
      stopCommandRef.current = stopCommandId;
      setIsPlaying(false);
    }
  }, [stopCommandId]);

  React.useEffect(() => {
    if (incFloorCommandRef.current !== incFloorCommandId) {
      incFloorCommandRef.current = incFloorCommandId;
      setFloorCount((f) => Math.min(40, f + 1));
    }
  }, [incFloorCommandId]);

  React.useEffect(() => {
    if (decFloorCommandRef.current !== decFloorCommandId) {
      decFloorCommandRef.current = decFloorCommandId;
      setFloorCount((f) => Math.max(1, f - 1));
    }
  }, [decFloorCommandId]);

  React.useEffect(() => {
    if (externalZoomCommandRef.current !== externalZoomCommandId) {
      externalZoomCommandRef.current = externalZoomCommandId;
      triggerZoom(externalZoomCommandDir);
    }
  }, [externalZoomCommandId, externalZoomCommandDir, triggerZoom]);

  React.useEffect(() => {
    if (externalZoomHoldDir === 1 && !canZoomIn) {
      setZoomHoldDir(0);
      return;
    }
    if (externalZoomHoldDir === -1 && !canZoomOut) {
      setZoomHoldDir(0);
      return;
    }
    setZoomHoldDir(externalZoomHoldDir);
  }, [externalZoomHoldDir, canZoomIn, canZoomOut]);

  React.useEffect(() => {
    buildStateCbRef.current?.({
      phase,
      isPlaying,
      floorCount,
      zoomValue: zoomUi,
      canZoomIn,
      canZoomOut,
      magicMode,
      selectedModelType,
      resolvedModelUrl: resolvedModelUrl ?? null,
    });
  }, [phase, isPlaying, floorCount, zoomUi, canZoomIn, canZoomOut, magicMode, selectedModelType, resolvedModelUrl]);

  // ── Computed image rect ──────────────────────────────────────────────────
  const imgRect = useMemo(
    () => computeImageRect(canvasW, canvasH, photoNatW, photoNatH),
    [canvasW, canvasH, photoNatW, photoNatH],
  );

  // ── Photo picking ─────────────────────────────────────────────────────────
  const resetDraw = () => { setPoints([]); setClosed(false); setIsPlaying(false); setAnimKey(0); };

  const applyAsset = useCallback((asset: ImagePicker.ImagePickerAsset) => {
    setPhotoUri(asset.uri);
    setPhotoNatW(asset.width  ?? 0);
    setPhotoNatH(asset.height ?? 0);
    resetDraw();
    setPhase('draw');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const takePhoto = useCallback(async () => {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) { Alert.alert('Permission', 'Allow camera access.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!r.canceled) applyAsset(r.assets[0]);
  }, [applyAsset]);

  const pickFromLibrary = useCallback(async () => {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) { Alert.alert('Permission', 'Allow media library access.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: false });
    if (!r.canceled) applyAsset(r.assets[0]);
  }, [applyAsset]);

  // ── Tap (draw phase) ──────────────────────────────────────────────────────
  const handleTap = useCallback((rawX: number, rawY: number) => {
    if (closed) return;
    const s = snap({ x: rawX, y: rawY }, points, gridOn);
    if (s.close) setClosed(true);
    else setPoints(prev => [...prev, s.pt]);
  }, [closed, points, gridOn]);

  const handleUndo = useCallback(() => {
    if (closed) { setClosed(false); return; }
    setPoints(p => p.slice(0, -1));
  }, [closed]);

  // ── Generate 3D ───────────────────────────────────────────────────────────
  const handleGenerate = useCallback(() => {
    if (points.length < 3 || !closed) {
      Alert.alert('Not ready', 'Close the polygon first (3+ points, tap near first dot).');
      return;
    }
    setAnimKey(k => k + 1);
    setIsPlaying(true);
    setPhase('build3d');
  }, [points, closed]);

  // ── Place GLB model ───────────────────────────────────────────────────────
  const handlePlaceModel = useCallback(() => {
    if (!resolvedModelUrl || points.length < 3 || !closed) return;
    setAnimKey(k => k + 1);
    setIsPlaying(true);
    setPhase('build3d');
  }, [resolvedModelUrl, points, closed]);

  // ── Capture / share ───────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    try {
      // @ts-ignore – ViewShot ref typing quirk
      const uri = await viewShotRef.current.capture();
      const ok  = await Sharing.isAvailableAsync();
      if (ok) await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Save snapshot' });
      else Alert.alert('Ready', `Image saved to:\n${uri}`);
    } catch {
      Alert.alert('Error', 'Could not capture snapshot.');
    }
  }, []);

  // ── Derived polygon display strings (canvas coords) ───────────────────────
  const polyStr = points.map(p => `${p.x},${p.y}`).join(' ');
  const firstPt = points[0];
  const lastPt  = points[points.length - 1];

  // ── Normalize points relative to IMAGE rect (not full canvas) ────────────
  // This ensures the 3D footprint proportions match the photo geometry.
  const normPoints: NormPoint[] = useMemo(() => {
    if (!imgRect.w || !imgRect.h) return [];
    return points.map(p => ({
      x: (p.x - imgRect.left) / imgRect.w,
      y: (p.y - imgRect.top)  / imgRect.h,
    }));
  }, [points, imgRect]);

  const config3d: BuildingFootprintConfig = useMemo(() => ({
    normPoints,
    floorCount,
    floorHeightM:   3,
    footprintScale: 1,
    imageAspect:    imgRect.w > 0 ? imgRect.h / imgRect.w : 1,
  }), [normPoints, floorCount, imgRect]);

  // ARModelConfig for model mode — footprint derived from the drawn polygon
  const derivedConfig: ARModelConfig = useMemo(() => {
    const fp = polygonToFootprint(normPoints);
    return {
      footprintW:       fp.width,
      footprintH:       fp.depth,
      floorCount,
      buildSpeed:       4,
      scale:            1,
      rotationDeg:      0,
      offsetX:          0,
      offsetY:          0,
      blueprintOpacity: 0,
      shadowStrength:   0,
      buildingType:     'residential',
      colorScheme:      'warm',
    };
  }, [normPoints, floorCount]);

  // ── GLView bounds (fixed to full preview) ─────────────────────────────────
  // GL fills entire preview bounds.

  // ─────────────────────────────────────────────────────────────────────────
  // PICK PHASE
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'pick') {
    return (
      <View style={styles.root} onLayout={onContainerLayout}>
        <Text style={styles.pickTitle}>3D MAGIC</Text>
        <Text style={styles.pickSub}>
          Trace a building footprint on a photo,{'\n'}then watch it rise floor by floor.
        </Text>
        <View style={styles.pickRow}>
          <TouchableOpacity style={styles.pickBtn} onPress={takePhoto} activeOpacity={0.8}>
            <Text style={styles.pickIcon}>📷</Text>
            <Text style={styles.pickLabel}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickBtn} onPress={pickFromLibrary} activeOpacity={0.8}>
            <Text style={styles.pickIcon}>🖼</Text>
            <Text style={styles.pickLabel}>Library</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRAW PHASE
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'draw') {
    return (
      <View style={styles.root} onLayout={onContainerLayout}>

        {/* Photo at bottom-aligned contain rect */}
        {photoUri && (
          <Image
            source={{ uri: photoUri }}
            style={{
              position: 'absolute',
              left:     imgRect.left,
              top:      imgRect.top,
              width:    imgRect.w,
              height:   imgRect.h,
            }}
            resizeMode="stretch"   // rect is already the right size — no letterboxing
          />
        )}

        {/* Tap receiver — full canvas area */}

        {!closed && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={(e) => handleTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
          />
        )}

        {/* SVG polygon overlay — uses canvas coords (same space as taps) */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* Grid lines — only visible when snap-to-grid is ON */}
          {gridOn && (() => {
            const lines: React.ReactElement[] = [];
            const cols = Math.ceil(canvasW / GRID_SIZE);
            const rows = Math.ceil(canvasH / GRID_SIZE);
            for (let c = 1; c < cols; c++) {
              lines.push(<Line key={`gv${c}`} x1={c * GRID_SIZE} y1={0} x2={c * GRID_SIZE} y2={canvasH}
                stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />);
            }
            for (let r = 1; r < rows; r++) {
              lines.push(<Line key={`gh${r}`} x1={0} y1={r * GRID_SIZE} x2={canvasW} y2={r * GRID_SIZE}
                stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />);
            }
            return lines;
          })()}
          {points.length >= 2 && (
            <Polyline points={polyStr} fill="none" stroke="#00d4ff"
              strokeWidth="2" strokeDasharray="6,4" />
          )}
          {closed && points.length >= 3 && lastPt && firstPt && (
            <Line x1={lastPt.x} y1={lastPt.y} x2={firstPt.x} y2={firstPt.y}
              stroke="#00d4ff" strokeWidth="2" strokeDasharray="6,4" />
          )}
          {!closed && points.length >= 3 && firstPt && (
            <Circle cx={firstPt.x} cy={firstPt.y} r={CLOSE_RADIUS}
              fill="rgba(0,212,255,0.12)" stroke="#00d4ff"
              strokeWidth="1.5" strokeOpacity="0.7" />
          )}
          {points.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y}
              r={i === 0 ? 9 : 5}
              fill={i === 0 ? '#00ff88' : '#00d4ff'}
              stroke="#fff" strokeWidth="1.5" />
          ))}
        </Svg>

        {/* Toolbar */}
        <View style={styles.toolbar} pointerEvents="box-none">
          <TouchableOpacity style={styles.toolBtn} onPress={handleUndo}>
            <Text style={styles.toolBtnText}>↩</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, gridOn && styles.toolBtnOn]}
            onPress={() => setGridOn(g => !g)}
          >
            <Text style={styles.toolBtnText}>⊞</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => { resetDraw(); setPhase('pick'); }}>
            <Text style={styles.toolBtnText}>⇦</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom bar */}
        <View style={styles.drawBottom} pointerEvents="box-none">
          <Text style={styles.drawHint} numberOfLines={1}>
            {closed
              ? `✓ ${points.length} pts · ready`
              : points.length === 0 ? 'Tap to place first vertex'
              : points.length < 3  ? `${points.length} pts — need 3+ to close`
              : 'Tap near ● to close'}
          </Text>
          {closed && (
            <TouchableOpacity style={styles.genBtn} onPress={handleGenerate} activeOpacity={0.85}>
              <Text style={styles.genBtnText}>Generate 3D ▶</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD 3D PHASE
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root} onLayout={onContainerLayout}>
      {/* @ts-ignore */}
      <ViewShot ref={viewShotRef} style={StyleSheet.absoluteFill}
        options={{ format: 'jpg', quality: 0.9 }}>

        {/* Photo + dim + polygon anchors — faded so 3D is unobstructed */}
        <View style={[StyleSheet.absoluteFill, { opacity: 0.18 }]} pointerEvents="none">
          {photoUri && (
            <Image
              source={{ uri: photoUri }}
              style={{
                position: 'absolute',
                left:     imgRect.left,
                top:      imgRect.top,
                width:    imgRect.w,
                height:   imgRect.h,
              }}
              resizeMode="stretch"
            />
          )}

          {/* Subtle dim */}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]}
          />

          {/* Polygon outline — reference footprint on the photo */}
          <Svg style={StyleSheet.absoluteFill}>
            <Polyline points={polyStr}
              fill="rgba(0,212,255,0.15)" stroke="#00d4ff"
              strokeWidth="2" strokeDasharray="5,4" />
            {points.length >= 3 && lastPt && firstPt && (
              <Line x1={lastPt.x} y1={lastPt.y} x2={firstPt.x} y2={firstPt.y}
                stroke="#00d4ff" strokeWidth="2" strokeDasharray="5,4" />
            )}
            {points.map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={4}
                fill="#00d4ff" stroke="#fff" strokeWidth="1.5" />
            ))}
          </Svg>
        </View>

        {/* 3D building / model */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: canvasW,
            height: canvasH,
            overflow: 'hidden',
          }}
        >
          {magicMode === 'generate' ? (
            <Procedural3DBuilding
              config={config3d}
              isPlaying={isPlaying}
              animKey={animKey}
              cameraResetKey={cameraResetKey}
              active={active}
              interactionMode="moveModel"
              initialZoom={2.5}
              onBuildComplete={() => setIsPlaying(false)}
              zoomCommandId={zoomCmdId}
              zoomCommandDir={zoomCmdDir}
              zoomHoldDir={zoomHoldDir}
              onZoomMetrics={handleZoomMetrics}
              manualAzimuthDir={manualAzimuthDir}
              manualElevationDir={manualElevationDir}
              manualMoveYDir={manualMoveYDir}
              gesturesDisabled={gesturesDisabled}
            />
          ) : (
            <Building3DOverlay
              config={derivedConfig}
              modelUri={resolvedModelUrl}
              constrainToFootprint
              isPlaying={isPlaying}
              animKey={animKey}
              active={active}
              width={canvasW}
              height={canvasH}
              zoomCommandId={zoomCmdId}
              zoomCommandDir={zoomCmdDir}
              zoomHoldDir={zoomHoldDir}
              onZoomMetrics={handleZoomMetrics}
              onBuildComplete={() => setIsPlaying(false)}
            />
          )}
        </View>
      </ViewShot>


      {showBuildToolbar && (
        <View style={styles.buildToolbar} pointerEvents="box-none">
          <TouchableOpacity style={styles.toolBtn}
            onPress={() => { setIsPlaying(false); setPhase('draw'); }}>
            <Text style={styles.toolBtnText}>✏</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, styles.toolBtnCamera]}
            onPress={() => { resetDraw(); setPhase('pick'); }}>
            <Text style={styles.toolBtnText}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, styles.toolBtnCapture]} onPress={handleCapture}>
            <Text style={styles.toolBtnText}>📤</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Right-side gesture / camera control rack — only in generate mode */}
      {magicMode === 'generate' && <View style={styles.controlsRack} pointerEvents="box-none">
        {/* Toggle gesture input */}
        <TouchableOpacity
          style={[styles.controlBtn, !gesturesDisabled && styles.controlBtnActive]}
          onPress={() => setGesturesDisabled(v => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.controlBtnText}>{'\u270B'}</Text>
        </TouchableOpacity>

        {/* Rotate model left (Y−) */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPressIn={() => setManualAzimuthDir(-1)}
          onPressOut={() => setManualAzimuthDir(0)}
          activeOpacity={0.8}
        >
          <Text style={[styles.controlBtnText, styles.circleLeft]}>{'\u27F3'}</Text>
        </TouchableOpacity>

        {/* Rotate model right (Y+) */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPressIn={() => setManualAzimuthDir(1)}
          onPressOut={() => setManualAzimuthDir(0)}
          activeOpacity={0.8}
        >
          <Text style={[styles.controlBtnText, styles.circleRight]}>{'\u27F3'}</Text>
        </TouchableOpacity>

        {/* Tilt model up (X−) */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPressIn={() => setManualElevationDir(1)}
          onPressOut={() => setManualElevationDir(0)}
          activeOpacity={0.8}
        >
          <Text style={[styles.controlBtnText, styles.circleUp]}>{'\u27F3'}</Text>
        </TouchableOpacity>

        {/* Tilt model down (X+) */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPressIn={() => setManualElevationDir(-1)}
          onPressOut={() => setManualElevationDir(0)}
          activeOpacity={0.8}
        >
          <Text style={[styles.controlBtnText, styles.circleDown]}>{'\u27F3'}</Text>
        </TouchableOpacity>
        {/* Move model / camera target UP */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPressIn={() => setManualMoveYDir(-1)}
          onPressOut={() => setManualMoveYDir(0)}
          activeOpacity={0.8}
        >
          <Text style={styles.controlBtnText}>{'↑'}</Text>
        </TouchableOpacity>

        {/* Move model / camera target DOWN */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPressIn={() => setManualMoveYDir(1)}
          onPressOut={() => setManualMoveYDir(0)}
          activeOpacity={0.8}
        >
          <Text style={styles.controlBtnText}>{'↓'}</Text>
        </TouchableOpacity>
        {/* Reset camera / model pose */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setCameraResetKey(k => k + 1)}
          activeOpacity={0.8}
        >
          <Text style={styles.controlBtnText}>{'\u27F3'}</Text>
        </TouchableOpacity>
      </View>}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const TOOL_BG = 'rgba(0,0,0,0.55)';
const ACCENT  = '#00d4ff';

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#050510' },

  // ── Pick ──────────────────────────────────────────────────────────────────
  pickTitle: {
    color:      ACCENT,
    fontSize:   22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 3,
    textAlign:  'center',
    marginTop:  Platform.OS === 'ios' ? 88 : 64,
  },
  pickSub: {
    color:      '#556688',
    fontSize:   12,
    textAlign:  'center',
    marginTop:  8,
    marginBottom: 32,
    lineHeight: 18,
    paddingHorizontal: 24,
  },
  pickRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  pickBtn: {
    flex: 1, maxWidth: 140,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 24, borderRadius: 10,
    borderWidth: 1.5, borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.07)', gap: 8,
  },
  pickIcon:  { fontSize: 30 },
  pickLabel: { color: ACCENT, fontSize: 12, fontWeight: '600' },

  // ── Toolbar (shared) ──────────────────────────────────────────────────────
  toolbar: {
    position: 'absolute', top: 8, left: 8,
    flexDirection: 'column', gap: 6, alignItems: 'center',
  },
  buildToolbar: {
    position: 'absolute', top: 8, left: 8,
    flexDirection: 'column', gap: 6, alignItems: 'center',
  },
  toolBtn: {
    width: 38, height: 38, borderRadius: 8,
    backgroundColor: TOOL_BG,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  toolBtnOn: { borderColor: ACCENT, backgroundColor: 'rgba(0,212,255,0.18)' },
  toolBtnCamera:  { borderColor: 'rgba(255,255,255,0.35)', backgroundColor: TOOL_BG },
  toolBtnCapture: { borderColor: 'rgba(255,255,255,0.35)', backgroundColor: TOOL_BG },
  toolBtnText: { color: '#ffffff', fontSize: 16, lineHeight: 20 },
  toolBtnTextDisabled: { color: 'rgba(221,238,255,0.35)' },

  // ── Bottom bar (draw) ─────────────────────────────────────────────────────
  drawBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.55)', gap: 8,
  },
  drawHint: { flex: 1, color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  genBtn:        { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: ACCENT, borderRadius: 6 },
  genBtnText:    { color: '#000', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  genBtnDisabled: { backgroundColor: 'rgba(0,212,255,0.3)' },

  // ── Mode toggle pill (draw bottom bar) ────────────────────────────────────
  // ── Floor label ───────────────────────────────────────────────────────────
  floorLabel:     { width: 38, height: 24, alignItems: 'center', justifyContent: 'center' },
  floorLabelText: { color: ACCENT, fontSize: 12, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },

  imageGuideBox: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(0,212,255,0.95)',
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  imageGuideLineH: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(0,212,255,0.85)',
  },
  imageGuideLineV: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(0,212,255,0.85)',
  },
  imageGuideLabel: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.55)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  imageGuideText: {
    color: '#dff7ff',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },

  // ── Right-side camera / gesture control rack ──────────────────────────────
  controlsRack: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'column',
    gap: 6,
    alignItems: 'center',
  },
  controlBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  controlBtnActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.18)',
  },
  controlBtnText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700' as const,
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
});

