/**
 * src/magic/Magic3DScreen.tsx
 *
 * Phase machine:
 *   'pick'    → Choose a photo (camera or library)
 *   'polygon' → Draw polygon on the photo
 *   '3d'      → View the procedural 3D building
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import ViewShot from 'react-native-view-shot';
import PhotoCanvasWithPolygon, { PhotoCanvasHandle } from './PhotoCanvasWithPolygon';
import { Procedural3DBuilding } from './Procedural3DBuilding';
import { BuildingFootprintConfig, MagicPhase } from './types';
import { normalizePoints, pixelBBoxToMeters } from './PolygonToFootprint';
import {
  DEV_SHOW_METRICS,
  computeFootprintMeasurements,
  computeBuildingMeasurements,
  type BuildingMeasurements,
} from './gridConfig';

interface Ctrl {
  floorCount:    number;
  floorHeightM:  number;
  footprintScale: number;
}

const DEFAULT_CTRL: Ctrl = {
  floorCount:    5,
  floorHeightM:  3,
  footprintScale: 1,
};

const MIN_FLOORS = 1;
const MAX_FLOORS = 40;
const CANVAS_RATIO = 0.58; // fraction of screen height for photo canvas

export default function Magic3DScreen() {
  const { width: winW, height: winH } = useWindowDimensions();
  const canvasH = winH * CANVAS_RATIO;

  const [phase, setPhase]       = useState<MagicPhase>('pick');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [ctrl, setCtrl]         = useState<Ctrl>(DEFAULT_CTRL);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animKey, setAnimKey]   = useState(0);
  /** Raw canvas-pixel points updated live via onPolygonChange; drives the drawing overlay. */
  const [livePoints, setLivePoints] = useState<{ x: number; y: number }[]>([]);
  /** Frozen footprint captured the moment Generate 3D is tapped (width/depth don't change after that). */
  const [frozenMeasurements, setFrozenMeasurements] = useState<BuildingMeasurements | null>(null);

  const canvasRef   = useRef<PhotoCanvasHandle>(null);
  const viewShotRef = useRef<ViewShot>(null);

  // ── Phase helpers ─────────────────────────────────────────────────────────
  const goTo = useCallback((p: MagicPhase) => setPhase(p), []);
  /** Receives every point/close update from PhotoCanvasWithPolygon; drives live measurements. */
  const handlePolygonChange = useCallback(
    (pts: { x: number; y: number }[]) => setLivePoints(pts),
    [],
  );
  const goPickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow media library access to pick a photo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (!res.canceled) {
      setPhotoUri(res.assets[0].uri);
      canvasRef.current?.reset();
      goTo('polygon');
    }
  }, [goTo]);

  const goTakePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: false,
    });
    if (!res.canceled) {
      setPhotoUri(res.assets[0].uri);
      canvasRef.current?.reset();
      goTo('polygon');
    }
  }, [goTo]);

  const goGenerate = useCallback(() => {
    const pts = canvasRef.current?.getPoints() ?? [];
    const closed = canvasRef.current?.isClosed() ?? false;
    if (pts.length < 3 || !closed) {
      Alert.alert('Not ready', 'Draw a closed polygon with at least 3 points first.');
      return;
    }
    // Freeze measurements at the moment the user commits
    const fp = computeFootprintMeasurements(pts);
    setFrozenMeasurements(computeBuildingMeasurements(fp, ctrl.floorCount, ctrl.floorHeightM));
    setIsPlaying(false);
    setAnimKey(k => k + 1);
    goTo('3d');
  }, [goTo, ctrl]);

  const goPlay = () => {
    setAnimKey(k => k + 1);
    setIsPlaying(true);
  };

  const goStop = () => setIsPlaying(false);

  // ── Snapshot ──────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow media library to save the image.');
      return;
    }
    try {
      const uri = await (viewShotRef.current as any).capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved!', 'Building snapshot saved to your gallery.');
    } catch (err) {
      Alert.alert('Error', 'Could not save snapshot.');
    }
  }, []);

  // ── Live measurement (updates every time polygon changes) ─────────────────
  const liveMeasurements = useMemo(
    () => computeFootprintMeasurements(livePoints),
    [livePoints],
  );
  /**
   * Display measurements for the 3D phase: footprint from frozen snapshot, but
   * height recomputed from the LIVE floor count so the stepper updates the label.
   */
  const displayMeasurements = useMemo(() => {
    if (!frozenMeasurements) return null;
    return computeBuildingMeasurements(frozenMeasurements, ctrl.floorCount, ctrl.floorHeightM);
  }, [frozenMeasurements, ctrl.floorCount, ctrl.floorHeightM]);
  // ── BuildingFootprintConfig from canvas ───────────────────────────────────
  const getConfig = useCallback((): BuildingFootprintConfig => {
    const pts  = canvasRef.current?.getPoints() ?? [];
    const norm = normalizePoints(pts, winW, canvasH);
    // shared helper: 1 grid cell = METERS_PER_CELL metres
    const { widthM: footprintWidthM, depthM: footprintDepthM } = pixelBBoxToMeters(pts);
    return {
      normPoints:      norm,
      floorCount:      ctrl.floorCount,
      floorHeightM:    ctrl.floorHeightM,
      footprintScale:  ctrl.footprintScale,
      footprintWidthM,
      footprintDepthM,
    };
  }, [ctrl, winW, canvasH]);

  // ── Control helpers ───────────────────────────────────────────────────────
  const adjFloors = (d: number) =>
    setCtrl(c => ({ ...c, floorCount: Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, c.floorCount + d)) }));

  // ========== RENDER =========================================================

  // ── Pick phase ──────────────────────────────────────────────────────────
  if (phase === 'pick') {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a2e" />
        <View style={styles.pickScreen}>
          <Text style={styles.pickTitle}>3D Magic</Text>
          <Text style={styles.pickSub}>Trace a building footprint on a photo, then watch it rise in 3D.</Text>
          <View style={styles.pickBtnRow}>
            <TouchableOpacity style={styles.pickBtn} onPress={goTakePhoto} activeOpacity={0.8}>
              <Text style={styles.pickBtnIcon}>📷</Text>
              <Text style={styles.pickBtnLabel}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickBtn} onPress={goPickFromLibrary} activeOpacity={0.8}>
              <Text style={styles.pickBtnIcon}>🖼</Text>
              <Text style={styles.pickBtnLabel}>Pick from Library</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Polygon phase ────────────────────────────────────────────────────────
  if (phase === 'polygon') {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a2e" />
        {/* Photo + SVG overlay — component handles its own photo render */}
        <View style={[styles.canvasContainer, { height: canvasH }]}>
          <PhotoCanvasWithPolygon
            ref={canvasRef}
            width={winW}
            height={canvasH}
            photoUri={photoUri ?? ''}
            onPolygonChange={handlePolygonChange}
          />
        </View>

        {/* Live measurement strip — above the Generate button; updates on every polygon change */}
        {livePoints.length >= 2 && (
          <View style={styles.measureStrip} pointerEvents="none">
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>Width</Text>
              <Text style={styles.measureValue}>{liveMeasurements.widthLabel}</Text>
            </View>
            <View style={styles.measureDivider} />
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>Depth</Text>
              <Text style={styles.measureValue}>{liveMeasurements.depthLabel}</Text>
            </View>
          </View>
        )}

        {/* Bottom controls */}
        <View style={styles.polygonBottom}>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => goTo('pick')} activeOpacity={0.8}>
            <Text style={styles.btnSecondaryText}>← Change Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrimary} onPress={goGenerate} activeOpacity={0.8}>
            <Text style={styles.btnPrimaryText}>Generate 3D ▶</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── 3D phase ─────────────────────────────────────────────────────────────
  const cfg3d = getConfig();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a2e" />

      {/* 3D Scene (snapshot area) */}
      {/* @ts-ignore – ViewShot ref typing quirk */}
      <ViewShot ref={viewShotRef} style={[styles.viewShot, { height: canvasH }]} options={{ format: 'jpg', quality: 0.9 }}>
        {/* Photo background */}
        {photoUri && (
          <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        {/* Dark overlay */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
        {/* 3D building */}
        <Procedural3DBuilding
          config={cfg3d}
          isPlaying={isPlaying}
          animKey={animKey}
        />
        {/* DEV: metric overlay — set DEV_SHOW_METRICS=true in gridConfig.ts to enable */}
        {DEV_SHOW_METRICS && (
          <View pointerEvents="none" style={{
            position: 'absolute', top: 8, left: 8,
            backgroundColor: 'rgba(0,0,0,0.70)',
            borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
            borderWidth: 1, borderColor: 'rgba(0,212,255,0.4)',
          }}>
            <Text style={{ color: '#00d4ff', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>
              {`Footprint: ${(cfg3d.footprintWidthM ?? 0).toFixed(1)}m × ${(cfg3d.footprintDepthM ?? 0).toFixed(1)}m`}
            </Text>
            <Text style={{ color: '#00d4ff', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>
              {`Height: ${cfg3d.floorCount} × ${cfg3d.floorHeightM}m = ${(cfg3d.floorCount * cfg3d.floorHeightM).toFixed(1)}m`}
            </Text>
          </View>
        )}
      </ViewShot>

      {/* Controls */}
      <ScrollView style={styles.controlsScroll} contentContainerStyle={styles.controlsContent} keyboardShouldPersistTaps="handled">
        {/* Measurement strip — above play button; updates height live when floors change */}
        {displayMeasurements && (
          <View style={styles.measureStrip}>
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>Width</Text>
              <Text style={styles.measureValue}>{displayMeasurements.widthLabel}</Text>
            </View>
            <View style={styles.measureDivider} />
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>Depth</Text>
              <Text style={styles.measureValue}>{displayMeasurements.depthLabel}</Text>
            </View>
            <View style={styles.measureDivider} />
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>Height</Text>
              <Text style={styles.measureValue}>{displayMeasurements.heightLabel}</Text>
            </View>
          </View>
        )}
        {/* Playback row */}}
        <View style={styles.row}>
          <TouchableOpacity style={styles.btnSecondary} onPress={goStop} activeOpacity={0.8}>
            <Text style={styles.btnSecondaryText}>■ Stop</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrimary} onPress={goPlay} activeOpacity={0.8}>
            <Text style={styles.btnPrimaryText}>▶ Build</Text>
          </TouchableOpacity>
        </View>

        {/* Floors stepper */}
        <View style={styles.ctrlRow}>
          <Text style={styles.ctrlLabel}>Floors</Text>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => adjFloors(-1)}>
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepVal}>{ctrl.floorCount}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => adjFloors(1)}>
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action row */}
        <View style={styles.row}>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => goTo('polygon')} activeOpacity={0.8}>
            <Text style={styles.btnSecondaryText}>✏ Edit Polygon</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnAccent} onPress={handleCapture} activeOpacity={0.8}>
            <Text style={styles.btnAccentText}>📸 Capture</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const PAD = 16;
const BTN_RADIUS = 8;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a2e' },

  // Pick
  pickScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  pickTitle:  { color: '#00d4ff', fontSize: 28, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 2, marginBottom: 10 },
  pickSub:    { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginBottom: 40, lineHeight: 20 },
  pickBtnRow: { flexDirection: 'row', gap: 16 },
  pickBtn:    {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,212,255,0.1)',
    borderColor: '#00d4ff',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 28,
    gap: 10,
  },
  pickBtnIcon:  { fontSize: 36 },
  pickBtnLabel: { color: '#00d4ff', fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // Polygon
  canvasContainer: { overflow: 'hidden' },
  polygonBottom: {
    flexDirection:   'row',
    padding:         PAD,
    gap:             12,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderTopWidth:  1,
    borderTopColor:  '#1a2a4a',
  },

  // 3D
  viewShot: { overflow: 'hidden' },

  // Shared controls
  controlsScroll:   { flex: 1 },
  controlsContent:  { padding: PAD, gap: 10 },
  row:              { flexDirection: 'row', gap: 12 },
  ctrlRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  ctrlLabel:        { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },

  stepper:          { flexDirection: 'row', alignItems: 'center', gap: 0 },
  stepBtn:          {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,212,255,0.12)',
    borderColor: '#1a3a5a', borderWidth: 1,
    borderRadius: 6,
  },
  stepBtnText:      { color: '#00d4ff', fontSize: 18, fontWeight: '700' },
  stepVal:          { color: '#ffffff', fontSize: 16, fontWeight: '700', minWidth: 36, textAlign: 'center' },

  btnPrimary: {
    flex: 1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: '#00d4ff',
    borderRadius:    BTN_RADIUS,
    paddingVertical: 12,
  },
  btnPrimaryText: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },

  btnSecondary: {
    flex: 1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor:     '#2a3a5a',
    borderWidth:     1,
    borderRadius:    BTN_RADIUS,
    paddingVertical: 12,
  },
  btnSecondaryText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },

  btnAccent: {
    flex: 1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: '#00ff88',
    borderRadius:    BTN_RADIUS,
    paddingVertical: 12,
  },
  btnAccentText: { color: '#000', fontSize: 14, fontWeight: '800' },

  // ── Measurement overlays ─────────────────────────────────────────────────
  /** Inline horizontal strip, full width, above the button row below it. */
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
  /** Unused — kept as no-op so any stale ref doesn't crash */
  measureOverlayLive:   { position: 'absolute' as const, bottom: -9999, opacity: 0 },
  measureOverlayFrozen: { position: 'absolute' as const, bottom: -9999, opacity: 0 },
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
});
