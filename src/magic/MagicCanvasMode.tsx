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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FloorPicker } from '../tours/FloorPicker';
import { FloorTourModal } from './FloorTourModal';
import { normalizeFloors, getFloorsTotalFromArr, getTourUrlFromArr } from '../lib/floors';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';
import { Procedural3DBuilding } from './Procedural3DBuilding';

import { NormPoint, BuildingFootprintConfig } from './types';
import Building3DOverlay from '../ar/Building3DOverlay';
import { ARModelConfig, resolveGlbSource, UnitType } from '../types';
import { useUnitTypeModels, useUnitGlbModels } from '../hooks/useUnits';
import { polygonToFootprint } from './PolygonToFootprint';
import {
  GRID_SIZE,
  DEV_SHOW_METRICS,
  computeFootprintMeasurements,
  computeBuildingMeasurements,
  type BuildingMeasurements,
} from './gridConfig'; // single source of truth — edit gridConfig.ts to change grid size

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
  displayMeasurements: BuildingMeasurements | null;
}

// ── Snap (draw phase only) ────────────────────────────────────────────────────
const CLOSE_RADIUS = 24;
const AXIS_RATIO   = 0.28;
// GRID_SIZE is imported from gridConfig.ts above — do not redeclare it here.
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
  // ── Exploded View ─────────────────────────────────────────────────
  explodeEnabled?: boolean;
  explodeSeparation?: number;
  explodeSelectedFloor?: number | 'all';
  onFloorGroupsReady?: (count: number) => void;
  /** Unit id used to look up per-floor Matterport tour URLs. Optional. */
  unitId?: string;
  /** Matterport URL array for this unit's floors (units.floors column). */
  floors?: string[];
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
  explodeEnabled = false,
  explodeSeparation = 0,
  explodeSelectedFloor = 'all' as number | 'all',
  onFloorGroupsReady,
  unitId = '',
  floors = [],
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
  /** Frozen snapshot of footprint + height taken the moment Generate (or Place Model) is tapped. */
  const [frozenMeasurements, setFrozenMeasurements] = useState<BuildingMeasurements | null>(null);
  // ── Floor Tour state ────────────────────────────────────────────────────────
  const [tourFloor,        setTourFloor]        = useState(1);
  const [tourModalVisible, setTourModalVisible] = useState(false);
  const normFloors = normalizeFloors(floors);
  /** Instant lookup — no parse hit when tapping a floor chip. */
  const tourUrl = getTourUrlFromArr(normFloors, tourFloor);
  /** Number of floors derived from saved tours — source of truth for tour navigation. */
  const floorsFromTours = getFloorsTotalFromArr(normFloors);
  /** True when the user left the tab while in build3d and we reset to draw. */
  const [pausedMsg, setPausedMsg] = useState(false);
  const floorSyncDoneRef = useRef(false);
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

  // Global type model URLs (for model mode - fallback when no per-unit model exists)
  const { modelsByType } = useUnitTypeModels();
  // Per-unit GLB models — same source as 3D View (unit_glb_models table)
  const { byType: unitGlbByType } = useUnitGlbModels(unitId);
  const resolvedModelUrl = useMemo(() => {
    // Prefer per-unit model (mirrors exactly what 3D View shows)
    if (unitId) {
      const perUnit = resolveGlbSource(unitGlbByType, selectedModelType as UnitType);
      if (perUnit) return perUnit;
    }
    // Fall back to global type template
    const m = modelsByType[selectedModelType];
    return m?.model_glb_url ?? m?.external_model_glb_url ?? null;
  }, [unitId, unitGlbByType, modelsByType, selectedModelType]);

  // Track actual canvas layout (may differ from prop if parent resizes)
  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setCanvasW(e.nativeEvent.layout.width);
    setCanvasH(e.nativeEvent.layout.height);
  }, []);
  React.useEffect(() => { buildStateCbRef.current = onBuildStateChange; }, [onBuildStateChange]);

  // Reset tour floor selection when floor count shrinks below selected
  useEffect(() => {
    setTourFloor(f => Math.min(f, floorCount));
  }, [floorCount]);

  // Seed floorCount from saved floor data once (generate mode only)
  useEffect(() => {
    if (floorSyncDoneRef.current || magicMode !== 'generate') return;
    if (floorsFromTours > 1) setFloorCount(floorsFromTours);
    floorSyncDoneRef.current = true;
  }, [floors, floorsFromTours, magicMode]);

  // Reset floors to mode default when mode switches
  React.useEffect(() => {
    if (magicMode === 'model') {
      setFloorCount(20);
    } else {
      // Respect tour-derived count when switching back to generate
      setFloorCount(floorSyncDoneRef.current && floorsFromTours > 1 ? floorsFromTours : 5);
    }
  }, [magicMode]);

  // Tab lifecycle:
  //   blur → if in build3d, retreat to draw so the GLView unmounts cleanly.
  //          Photo + polygon points remain in state; no GL rebuild needed.
  //   focus → nothing to do; draw phase already shows photo + vectors + Generate button.
  //   mode switch model→generate (same active session) → still replay the build.
  React.useEffect(() => {
    const becameInactive = !active && wasActiveRef.current;
    const switchedToGenerate = magicMode === 'generate' && prevMagicModeRef.current === 'model';
    wasActiveRef.current = active;
    prevMagicModeRef.current = magicMode;

    // On tab blur while generating/previewing: retreat to draw, GLView unmounts harmlessly.
    if (becameInactive && phase === 'build3d') {
      setIsPlaying(false);
      setPhase('draw');
      setPausedMsg(true);
      return;
    }

    // Mode switch model→generate inside the same active session (not a tab-return).
    if (switchedToGenerate && active && phase === 'build3d') {
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

  // ── Live polygon measurements (metres + feet) ───────────────────────────
  // Declared HERE — before the state emission effect — so it is a real value
  // in the deps array and the effect re-fires on every polygon change.
  const footprintMeasurements = useMemo(
    () => computeFootprintMeasurements(points),
    [points],
  );

  React.useEffect(() => {
    let displayMeasurements: BuildingMeasurements | null = null;
    if (phase === 'draw') {
      // Show live Width/Depth/Height in the footer while the user is drawing.
      // widthM > 0 means at least 2 distinct points exist (bbox is non-zero).
      if (footprintMeasurements.widthM > 0 || footprintMeasurements.depthM > 0) {
        displayMeasurements = computeBuildingMeasurements(footprintMeasurements, floorCount);
      }
    } else if (frozenMeasurements) {
      displayMeasurements = computeBuildingMeasurements(frozenMeasurements, floorCount);
    }
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
      displayMeasurements,
    });
  }, [phase, isPlaying, floorCount, zoomUi, canZoomIn, canZoomOut, magicMode, selectedModelType, resolvedModelUrl, frozenMeasurements, footprintMeasurements]);

  // ── Computed image rect ──────────────────────────────────────────────────
  const imgRect = useMemo(
    () => computeImageRect(canvasW, canvasH, photoNatW, photoNatH),
    [canvasW, canvasH, photoNatW, photoNatH],
  );

  // ── Photo picking ─────────────────────────────────────────────────────────
  const resetDraw = () => { setPoints([]); setClosed(false); setIsPlaying(false); setAnimKey(0); setFrozenMeasurements(null); };

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
    // Freeze measurements the moment the user commits — floor height is always 3 m (default)
    const fp = computeFootprintMeasurements(points);
    setFrozenMeasurements(computeBuildingMeasurements(fp, floorCount));
    setPausedMsg(false);
    setAnimKey(k => k + 1);
    setIsPlaying(true);
    setPhase('build3d');
  }, [points, closed, floorCount]);

  // ── Place GLB model ───────────────────────────────────────────────────────
  const handlePlaceModel = useCallback(() => {
    if (!resolvedModelUrl || points.length < 3 || !closed) return;
    const fp = computeFootprintMeasurements(points);
    setFrozenMeasurements(computeBuildingMeasurements(fp, floorCount));
    setPausedMsg(false);
    setAnimKey(k => k + 1);
    setIsPlaying(true);
    setPhase('build3d');
  }, [resolvedModelUrl, points, closed, floorCount]);

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
  // Memoized: change only when the points array reference changes.
  const polyStr = useMemo(() => points.map(p => `${p.x},${p.y}`).join(' '), [points]);
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

  // footprintMeasurements is declared above the state emission effect (search for
  // "Live polygon measurements" near the top of this component).

  const config3d: BuildingFootprintConfig = useMemo(() => ({
    normPoints,
    floorCount,
    floorHeightM:    3,
    footprintScale:  1,
    imageAspect:     imgRect.w > 0 ? imgRect.h / imgRect.w : 1,
    footprintWidthM: footprintMeasurements.widthM,
    footprintDepthM: footprintMeasurements.depthM,
  }), [normPoints, floorCount, imgRect, footprintMeasurements]);

  // ── Memoized SVG grid lines (expensive when canvas is large) ─────────────
  // Regenerated only when grid is toggled or canvas size changes — never on tap.
  const svgGridLines = useMemo(() => {
    if (!gridOn) return null;
    const lines: React.ReactElement[] = [];
    const cols = Math.ceil(canvasW / GRID_SIZE);
    const rows = Math.ceil(canvasH / GRID_SIZE);
    for (let c = 1; c < cols; c++) {
      lines.push(
        <Line key={`gv${c}`}
          x1={c * GRID_SIZE} y1={0} x2={c * GRID_SIZE} y2={canvasH}
          stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />,
      );
    }
    for (let r = 1; r < rows; r++) {
      lines.push(
        <Line key={`gh${r}`}
          x1={0} y1={r * GRID_SIZE} x2={canvasW} y2={r * GRID_SIZE}
          stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />,
      );
    }
    return lines;
  }, [gridOn, canvasW, canvasH]);

  // ARModelConfig for model mode — footprint derived from the drawn polygon
  const derivedConfig: ARModelConfig = useMemo(() => {
    const fp = polygonToFootprint(
      normPoints,
      12,                         // legacy scaleM (ignored when metric dims present)
      footprintMeasurements.widthM || undefined,
      footprintMeasurements.depthM || undefined,
    );
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
  }, [normPoints, floorCount, footprintMeasurements]);

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

        {/* "Generation paused" banner — shown when user returns after leaving mid-build */}
        {pausedMsg && (
          <TouchableOpacity
            style={styles.pausedBanner}
            onPress={() => setPausedMsg(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.pausedBannerTxt}>
              {'Generation paused.\nTap Generate 3D\nto resume  \u00d7'}
            </Text>
          </TouchableOpacity>
        )}

        {/* SVG polygon overlay — uses canvas coords (same space as taps) */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* Grid lines — memoized; only re-generated when grid toggled or canvas resizes */}
          {svgGridLines}
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

        {/* Bottom area: hint/generate bar (measurements now live in the parent footer) */}
        <View style={styles.drawBottomArea} pointerEvents="box-none">
          <View style={styles.drawBottom}>
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
              explodeEnabled={explodeEnabled}
              explodeSeparation={explodeSeparation}
              selectedFloor={explodeSelectedFloor}
              onFloorGroupsReady={onFloorGroupsReady}
            />
          ) : (
            <Building3DOverlay
              key={resolvedModelUrl ?? '__no_model__'}
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

      {/* DEV: metric overlay — set DEV_SHOW_METRICS=true in gridConfig.ts to enable */}
      {DEV_SHOW_METRICS && (
        <View pointerEvents="none" style={{
          position: 'absolute', top: 8, left: 8,
          backgroundColor: 'rgba(0,0,0,0.70)',
          borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
          borderWidth: 1, borderColor: 'rgba(0,212,255,0.4)',
        }}>
          <Text style={{ color: '#00d4ff', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>
            {`Footprint: ${footprintMeasurements.widthM.toFixed(1)}m × ${footprintMeasurements.depthM.toFixed(1)}m`}
          </Text>
          <Text style={{ color: '#00d4ff', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>
            {`Height: ${floorCount} × ${config3d.floorHeightM}m = ${(floorCount * config3d.floorHeightM).toFixed(1)}m`}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>
            {`Mode: ${magicMode}`}
          </Text>
        </View>
      )}

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

      {/* ── Floor Tour bar ── shown in build3d when a unit is linked ── */}
      {!!unitId && phase === 'build3d' && (
        <View style={styles.tourBar}>
          <FloorPicker value={tourFloor} count={floorsFromTours} onChange={setTourFloor} compact />
          <View style={styles.tourCta}>
            {tourUrl ? (
              <TouchableOpacity
                style={styles.tourBtn}
                onPress={() => setTourModalVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.tourBtnTxt}>▶ Tour</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.tourNone}>No tour</Text>
            )}
          </View>
        </View>
      )}

      <FloorTourModal
        visible={tourModalVisible}
        floorsTotal={floorsFromTours}
        initialFloorIndex={tourFloor}
        getTourUrlForFloor={(fl) => getTourUrlFromArr(normFloors, fl)}
        onFloorChange={setTourFloor}
        onClose={() => setTourModalVisible(false)}
      />
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
  drawBottomArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  drawBottom: {
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

  // ── Measurement strip (inline, full-width, above generate/play button) ──────
  measureStrip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,212,255,0.30)',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  measureCell: {
    flex: 1,
    alignItems: 'center' as const,
  },
  measureDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(0,212,255,0.25)',
  },
  measureLabel: {
    color: 'rgba(0,212,255,0.82)',
    fontSize: 8,
    fontWeight: '700' as const,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  measureValue: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 0.2,
    marginTop: 1,
  },
  // kept as hidden no-ops so any lingering JSX refs don't crash
  measureOverlay: { position: 'absolute' as const, bottom: -9999, left: 0, opacity: 0 },
  measureOverlayFrozen: { position: 'absolute' as const, bottom: -9999, left: 0, opacity: 0 },

  // ── "Generation paused" banner (draw phase, after tab-switch) ──────────────────
  pausedBanner: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    maxWidth: 160,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pausedBannerTxt: {
    color: 'rgba(0,212,255,0.9)',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 0.3,
    lineHeight: 15,
    textAlign: 'right' as const,
  },

  // ── Floor Tour bar ───────────────────────────────────────────────────────
  tourBar: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,212,255,0.2)',
    paddingVertical: 7,
    paddingHorizontal: 8,
    gap: 8,
  },
  tourChips: { flexDirection: 'row' as const, gap: 6, paddingRight: 8 },
  tourChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  tourChipActive: { borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.15)' },
  tourChipTxt: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  tourChipTxtActive: { color: '#00d4ff' },
  tourCta: { minWidth: 68, alignItems: 'center' as const },
  tourBtn: {
    backgroundColor: '#00d4ff',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  tourBtnTxt: { color: '#000', fontWeight: '800' as const, fontSize: 11 },
  tourNone: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
});

