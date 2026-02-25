/**
 * src/demo/ARViewsDemoScreen.tsx
 *
 * Preview all three view modes on a plain background — no camera needed.
 *
 * Modes:
 *   'blueprint' — 2D animated blueprint
 *   '3d'        — GLView 3D building (PanResponder-based gestures)
 *   'magic3d'   — Photo + polygon draw + procedural 3D (self-contained)
 *
 * IMPORTANT: When 'magic3d' is active, the GestureDetector is NOT rendered
 * so Pressable taps inside MagicCanvasMode are never stolen.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
// BuildingAnimation kept for non-blueprint usage; blueprint now uses IsometricBlueprintView
import { IsometricBlueprintView } from '../components/IsometricBlueprintView';
import { Building3DOverlay }  from '../ar/Building3DOverlay';
import MagicCanvasMode        from '../magic/MagicCanvasMode';
import { ARModelConfig, BuildingType } from '../types';
import { DEFAULT_AR_CONFIG }  from '../ar/useARBuildingModel';

// ── Local mode type (extends ARViewMode with 'magic3d') ───────────────────────
type DemoViewMode = 'blueprint' | '3d' | 'magic3d';

// ── Constants ─────────────────────────────────────────────────────────────────
const ACCENT = '#00d4ff';
const BG     = '#070714';
const BORDER = '#1a1a3a';

const BUILDING_TYPES: BuildingType[] = ['residential', 'commercial', 'industrial', 'mixed'];

// ── Component ─────────────────────────────────────────────────────────────────
export default function ARViewsDemoScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const previewH      = Math.round(height * 0.50);
  const magicPreviewH = Math.round(height * 0.65);

  const [viewMode, setViewMode]   = useState<DemoViewMode>('blueprint');
  const [isPlaying, setIsPlaying] = useState(false);
  const [animKey, setAnimKey]     = useState(0);
  const [config, setConfig]       = useState<ARModelConfig>(DEFAULT_AR_CONFIG);

  const updateConfig = useCallback(
    <K extends keyof ARModelConfig>(key: K, value: ARModelConfig[K]) =>
      setConfig((c) => ({ ...c, [key]: value })),
    [],
  );

  // Gesture shared values (only wired when viewMode !== 'magic3d')
  const gestureScale    = useSharedValue(1);
  const savedScale      = useSharedValue(1);
  const gestureRotation = useSharedValue(0);
  const savedRotation   = useSharedValue(0);
  const offsetX         = useSharedValue(0);
  const savedOffsetX    = useSharedValue(0);
  const offsetY         = useSharedValue(0);
  const savedOffsetY    = useSharedValue(0);

  const pinch  = Gesture.Pinch()
    .onUpdate((e) => { gestureScale.value = Math.min(4, Math.max(0.25, savedScale.value * e.scale)); })
    .onEnd(()    => { savedScale.value = gestureScale.value; });

  const rotate = Gesture.Rotation()
    .onUpdate((e) => { gestureRotation.value = savedRotation.value + (e.rotation * 180) / Math.PI; })
    .onEnd(()    => { savedRotation.value = gestureRotation.value; });

  const panG = Gesture.Pan()
    .minPointers(1).maxPointers(1)
    .onUpdate((e) => { offsetX.value = savedOffsetX.value + e.translationX; offsetY.value = savedOffsetY.value + e.translationY; })
    .onEnd(()    => { savedOffsetX.value = offsetX.value; savedOffsetY.value = offsetY.value; });

  const composedGesture = Gesture.Simultaneous(pinch, rotate, panG);

  // Kept for possible future animated overlay
  const _animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: gestureScale.value },
      { rotate: `${gestureRotation.value}deg` },
    ],
  }));

  const handlePlay = () => { setAnimKey((k) => k + 1); setIsPlaying(true); };
  const handleStop = () => setIsPlaying(false);

  const switchMode = (mode: DemoViewMode) => {
    if (mode === viewMode) return;
    setIsPlaying(false);
    setViewMode(mode);
  };

  // ── Mode toggle pill ──────────────────────────────────────────────────────
  const togglePill = (
    <View style={styles.togglePill} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.pillBtn, viewMode === 'blueprint' && styles.pillBtnActive]}
        onPress={() => switchMode('blueprint')}
      >
        <Text style={[styles.pillBtnText, viewMode === 'blueprint' && styles.pillBtnTextActive]}>
          BLUEPRINT
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.pillBtn, viewMode === '3d' && styles.pillBtnActive]}
        onPress={() => switchMode('3d')}
      >
        <Text style={[styles.pillBtnText, viewMode === '3d' && styles.pillBtnTextActive]}>
          3D VIEW
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.pillBtn, viewMode === 'magic3d' && styles.pillBtnMagicActive]}
        onPress={() => switchMode('magic3d')}
      >
        <Text style={[styles.pillBtnText, viewMode === 'magic3d' && styles.pillBtnMagicText]}>
          3D MAGIC
        </Text>
      </TouchableOpacity>
    </View>
  );

  const labelBadge = (
    <View style={styles.labelBadge} pointerEvents="none">
      <Text style={styles.labelText}>
        {viewMode === 'magic3d' ? 'MAGIC · PHOTO → 3D' : 'AR DEMO · NO CAMERA'}
      </Text>
    </View>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // MAGIC3D PATH — no GestureDetector, no controls panel
  // ══════════════════════════════════════════════════════════════════════════
  if (viewMode === 'magic3d') {
    return (
      <GestureHandlerRootView style={styles.root}>
        {/* Mode toggle — above the preview, not floating over it */}
        <View style={styles.togglePillBar}>{togglePill}</View>
        {/* Preview — plain View, no GestureDetector so Pressable taps reach MagicCanvasMode */}
        <View style={[styles.preview, { height: magicPreviewH }]}>
          <MagicCanvasMode width={width} height={magicPreviewH} />
        </View>
        {/* Label below canvas */}
        {labelBadge}
        {/* Minimal hint row below preview */}
        <View style={styles.magicHintRow}>
          <Text style={styles.magicHint}>
            Pick a photo · trace footprint · generate 3D building
          </Text>
        </View>
      </GestureHandlerRootView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BLUEPRINT / 3D PATH — keep GestureDetector + controls panel
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <GestureHandlerRootView style={styles.root}>
      {/* Mode toggle — above the preview, not floating over it */}
      <View style={styles.togglePillBar}>{togglePill}</View>
      <GestureDetector gesture={composedGesture}>
        <View style={[styles.preview, { height: previewH }]}>
          {viewMode === 'blueprint' ? (
            <IsometricBlueprintView
              key={`demo-bp-${animKey}`}
              config={{
                floorCount:   config.floorCount,
                scale:        config.scale,
                rotationDeg:  config.rotationDeg,
                buildingType: config.buildingType,
                footprintW:   config.footprintW,
                footprintH:   config.footprintH,
                colorScheme:  config.colorScheme,
              }}
              active={isPlaying}
              containerWidth={width}
              containerHeight={previewH}
            />
          ) : (
            <>
              <Building3DOverlay
                key={`demo-3d-${animKey}`}
                config={config}
                isPlaying={isPlaying}
                animKey={animKey}
                width={width}
                height={previewH}
              />
              {/* Idle hint — shown whenever not playing (resets on tab switch) */}
              {!isPlaying && (
                <View style={styles.idlePlaceholder} pointerEvents="none">
                  <Text style={styles.idlePlaceholderIcon}>▶</Text>
                  <Text style={styles.idlePlaceholderText}>PRESIONA PLAY{`\n`}PARA CONSTRUIR</Text>
                </View>
              )}
            </>
          )}
        </View>
      </GestureDetector>
      {/* Label below canvas */}
      {labelBadge}

      <ScrollView
        style={styles.panel}
        contentContainerStyle={[styles.panelContent, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Play / Stop */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.playBtn, isPlaying && styles.stopBtn]}
            onPress={isPlaying ? handleStop : handlePlay}
          >
            <Text style={[styles.playBtnText, isPlaying && { color: '#ff4444' }]}>
              {isPlaying ? '■ STOP' : '▶ PLAY'}
            </Text>
          </TouchableOpacity>
        </View>

        <ControlRow label="FLOORS">
          <Stepper
            value={config.floorCount}
            onDec={() => updateConfig('floorCount', Math.max(1,   config.floorCount - 1))}
            onInc={() => updateConfig('floorCount', Math.min(20,  config.floorCount + 1))}
          />
        </ControlRow>

        <ControlRow label="SPEED">
          <Stepper
            value={`${config.buildSpeed.toFixed(2)}×`}
            onDec={() => updateConfig('buildSpeed', Math.max(0.25, +(config.buildSpeed - 0.25).toFixed(2)))}
            onInc={() => updateConfig('buildSpeed', Math.min(4,    +(config.buildSpeed + 0.25).toFixed(2)))}
          />
        </ControlRow>

        {/* TYPE — hidden for now; will be used when multiple GLB models per type are available
        <View style={styles.controlCol}>
          <Text style={styles.label}>TYPE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {BUILDING_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, config.buildingType === t && styles.chipActive]}
                onPress={() => updateConfig('buildingType', t)}
              >
                <Text style={[styles.chipText, config.buildingType === t && { color: ACCENT }]}>
                  {t.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        */}

        <Text style={styles.hint}>Pinch · Rotate · Drag — gestures active on preview</Text>
      </ScrollView>
    </GestureHandlerRootView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
const ControlRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <View style={styles.controlRow}>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);

interface StepperProps { value: number | string; onDec: () => void; onInc: () => void; }
const Stepper: React.FC<StepperProps> = ({ value, onDec, onInc }) => (
  <View style={styles.stepper}>
    <TouchableOpacity style={styles.stepBtn} onPress={onDec}><Text style={styles.stepBtnText}>−</Text></TouchableOpacity>
    <Text style={styles.stepValue}>{value}</Text>
    <TouchableOpacity style={styles.stepBtn} onPress={onInc}><Text style={styles.stepBtnText}>+</Text></TouchableOpacity>
  </View>
);

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  preview: {
    width:             '100%',
    backgroundColor:   '#050510',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    overflow:          'hidden',
  },

  // Toggle pill bar — sits above the preview in normal document flow
  togglePillBar: {
    width:            '100%',
    alignItems:       'center',
    paddingVertical:  8,
    backgroundColor:  BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  togglePill: {
    flexDirection:   'row',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     BORDER,
    overflow:        'hidden',
  },
  pillBtn:             { paddingHorizontal: 13, paddingVertical: 8 },
  pillBtnActive:       { backgroundColor: ACCENT },
  pillBtnMagicActive:  { backgroundColor: '#00ff88' },
  pillBtnText:         { color: '#444466', fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
  pillBtnTextActive:   { color: BG },
  pillBtnMagicText:    { color: '#002211' },

  // Label badge — sits below the canvas in normal document flow
  labelBadge: {
    alignSelf:         'center',
    backgroundColor:   'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical:   3,
    borderRadius:      4,
    marginTop:         4,
    marginBottom:      2,
  },
  labelText: { color: '#333366', fontSize: 9, fontFamily: 'monospace', letterSpacing: 2 },

  // Controls panel
  panel:        { flex: 1 },
  panelContent: { padding: 16, gap: 12, paddingBottom: 32 },
  row:          { flexDirection: 'row' },
  playBtn: {
    flex: 1, borderWidth: 1.5, borderColor: ACCENT,
    borderRadius: 6, paddingVertical: 12, alignItems: 'center',
  },
  stopBtn:     { borderColor: '#ff4444' },
  playBtnText: { color: ACCENT, fontWeight: '700', fontSize: 13, letterSpacing: 2, fontFamily: 'monospace' },
  controlRow:  {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10,
  },
  controlCol:  { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10 },
  label:       { color: '#444466', fontSize: 9, fontFamily: 'monospace', letterSpacing: 2 },
  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: BG,
  },
  stepBtnText:  { color: ACCENT, fontSize: 18, lineHeight: 20 },
  stepValue:    { color: '#eeeeff', fontSize: 15, fontWeight: '700', minWidth: 40, textAlign: 'center' },
  chip: {
    marginRight: 8, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 4, borderWidth: 1, borderColor: BORDER,
  },
  chipActive:  { borderColor: ACCENT, backgroundColor: 'rgba(0,212,255,0.08)' },
  chipText:    { color: '#555577', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 },
  hint: { color: '#333355', fontSize: 10, fontFamily: 'monospace', textAlign: 'center', paddingTop: 4 },

  // 3D View idle placeholder
  idlePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems:     'center',
    gap:            10,
  },
  idlePlaceholderIcon: {
    fontSize:   42,
    color:      'rgba(0,212,255,0.25)',
    lineHeight: 46,
  },
  idlePlaceholderText: {
    color:       'rgba(0,212,255,0.35)',
    fontSize:    11,
    fontFamily:  'monospace',
    letterSpacing: 2,
    textAlign:   'center',
    lineHeight:  18,
  },

  // Magic3D hint
  magicHintRow: { paddingHorizontal: 16, paddingVertical: 4, alignItems: 'center' },
  magicHint:    { color: '#334455', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 0.8, textAlign: 'center' },
});
