import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, Stack } from 'expo-router';
import {
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useLands } from '../../../src/hooks/useLands';
import { BuildingAnimation } from '../../../src/components/BuildingAnimation';
import { Building3DOverlay } from '../../../src/ar/Building3DOverlay';
import { useARBuildingModel } from '../../../src/ar/useARBuildingModel';
import { ARViewMode, BuildingType } from '../../../src/types';

// ── Constants ────────────────────────────────────────────────────────────────
const ACCENT    = '#00d4ff';
const BG        = '#070714';
const CARD_BG   = 'rgba(7,7,20,0.92)';
const BORDER    = '#1a1a3a';
const GREEN     = '#00ff88';

const BUILDING_TYPES: BuildingType[] = ['residential', 'commercial', 'industrial', 'mixed'];

// ── Screen ───────────────────────────────────────────────────────────────────
export default function CameraARScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lands } = useLands();
  const land = lands.find((l) => l.id === id);

  const [permission, requestPermission] = useCameraPermissions();

  // Shared building state
  const ar = useARBuildingModel(id);

  // View mode — local only, does not affect land/nav state
  const [viewMode, setViewMode] = useState<ARViewMode>('blueprint');

  const { width: winW, height: winH } = useWindowDimensions();
  const cameraH = Math.round(winH * 0.57);

  // Switch views cleanly — preserves config, restarts animation
  const switchMode = useCallback(
    (mode: ARViewMode) => {
      if (mode === viewMode) return;
      ar.stop();
      setViewMode(mode);
    },
    [viewMode, ar]
  );

  const handleSave = async () => {
    const ok = await ar.save();
    if (ok) {
      Alert.alert('Saved', 'Building configuration saved.');
    } else {
      Alert.alert('Error', 'Failed to save. Check your connection.');
    }
  };

  // ── Permission gates ─────────────────────────────────────────────────────
  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permText}>Camera access is required for the AR preview.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>GRANT CAMERA PERMISSION</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const {
    config, updateConfig, isPlaying, phase, animKey,
    play, stop, isSaving,
  } = ar;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen
        options={{
          title: land?.name ?? 'AR Preview',
          headerTransparent: true,
          headerTintColor: ACCENT,
        }}
      />

      <GestureHandlerRootView style={styles.root}>
        {/* Camera + AR Overlay */}
        <CameraView style={[styles.camera, { height: cameraH }]} facing="back">
            {/* Blueprint (2D) mode — no gesture detector around it */}
            {viewMode === 'blueprint' && (
              <BuildingAnimation
                key={`bp-${animKey}`}
                config={{
                  floorCount: config.floorCount,
                  scale: config.scale,
                  rotationDeg: config.rotationDeg,
                  buildingType: config.buildingType,
                  footprintW: config.footprintW,
                  footprintH: config.footprintH,
                  colorScheme: config.colorScheme,
                }}
                active={isPlaying}
                onPhaseChange={ar.setPhase}
              />
            )}

            {/* 3D mode — all gestures handled internally via PanResponder */}
            {viewMode === '3d' && (
              <Building3DOverlay
                key={`3d-${animKey}`}
                config={config}
                isPlaying={isPlaying}
                animKey={animKey}
                width={winW}
                height={cameraH}
              />
            )}

            {/* HUD */}
            <View style={styles.hud}>
              <View>
                <Text style={styles.hudTitle}>
                  ⬡ {land?.name?.toUpperCase() ?? 'LAND'} · AR MODE
                </Text>
                <Text style={styles.hudPhase}>
                  {['STANDBY', 'SCANNING…', 'BUILDING…', 'PARTICLES…'][phase] ?? 'LIVE'}
                </Text>
              </View>

              {/* View mode toggle */}
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === 'blueprint' && styles.modeBtnActive]}
                  onPress={() => switchMode('blueprint')}
                >
                  <Text style={[styles.modeBtnText, viewMode === 'blueprint' && styles.modeBtnTextActive]}>
                    2D
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === '3d' && styles.modeBtnActive]}
                  onPress={() => switchMode('3d')}
                >
                  <Text style={[styles.modeBtnText, viewMode === '3d' && styles.modeBtnTextActive]}>
                    3D
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </CameraView>

        {/* Controls panel */}
        <ScrollView
          style={styles.panel}
          contentContainerStyle={styles.panelContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Play / Stop & Save */}
          <View style={styles.playRow}>
            <TouchableOpacity
              style={[styles.playBtn, isPlaying && styles.stopBtn]}
              onPress={isPlaying ? stop : play}
            >
              <Text style={[styles.playBtnText, isPlaying && { color: '#ff4444' }]}>
                {isPlaying ? '■ STOP' : '▶ START'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, isSaving && styles.btnDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color={GREEN} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>SAVE</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Floors */}
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>FLOORS</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => updateConfig('floorCount', Math.max(1, config.floorCount - 1))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{config.floorCount}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => updateConfig('floorCount', Math.min(20, config.floorCount + 1))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Footprint W */}
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>FOOTPRINT W</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => updateConfig('footprintW', Math.max(60, config.footprintW - 10))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{config.footprintW}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => updateConfig('footprintW', Math.min(280, config.footprintW + 10))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Build speed */}
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>SPEED</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() =>
                  updateConfig('buildSpeed', Math.max(0.25, +(config.buildSpeed - 0.25).toFixed(2)))
                }
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{config.buildSpeed.toFixed(2)}×</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() =>
                  updateConfig('buildSpeed', Math.min(4, +(config.buildSpeed + 0.25).toFixed(2)))
                }
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Building type */}
          <View style={styles.controlCol}>
            <Text style={styles.controlLabel}>TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              {BUILDING_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, config.buildingType === t && styles.typeChipActive]}
                  onPress={() => updateConfig('buildingType', t)}
                >
                  <Text style={[styles.typeChipText, config.buildingType === t && { color: ACCENT }]}>
                    {t.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Colour scheme */}
          <View style={styles.controlCol}>
            <Text style={styles.controlLabel}>COLOUR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              {(['blueprint', 'warm', 'neon'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.typeChip, config.colorScheme === s && styles.typeChipActive]}
                  onPress={() => updateConfig('colorScheme', s)}
                >
                  <Text style={[styles.typeChipText, config.colorScheme === s && { color: ACCENT }]}>
                    {s.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <Text style={styles.gestureHint}>
            Pinch to scale · Two-finger rotate · Drag to offset
          </Text>
        </ScrollView>
      </GestureHandlerRootView>
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: BG },
  camera:   { width: '100%' },
  centered: { flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center', padding: 24 },
  permText: { color: '#eeeeff', fontSize: 15, textAlign: 'center', marginBottom: 20 },
  permBtn:  { backgroundColor: ACCENT, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 14 },
  permBtnText: { color: BG, fontWeight: '800', fontSize: 13, letterSpacing: 2 },

  hud: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 70,
    left: 16, right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  hudTitle: { color: ACCENT, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1.5 },
  hudPhase: { color: '#ffe044', fontSize: 9, fontFamily: 'monospace', letterSpacing: 2, marginTop: 2 },

  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
  },
  modeBtn:         { paddingHorizontal: 14, paddingVertical: 7 },
  modeBtnActive:   { backgroundColor: ACCENT },
  modeBtnText:     { color: '#444466', fontSize: 11, fontFamily: 'monospace', fontWeight: '700' },
  modeBtnTextActive: { color: BG },

  panel:        { flex: 1, backgroundColor: CARD_BG, borderTopWidth: 1, borderTopColor: BORDER },
  panelContent: { padding: 16, gap: 12, paddingBottom: 24 },
  playRow:      { flexDirection: 'row', gap: 10 },
  playBtn: {
    flex: 1, borderWidth: 1.5, borderColor: ACCENT,
    borderRadius: 6, paddingVertical: 12, alignItems: 'center',
  },
  stopBtn:     { borderColor: '#ff4444' },
  playBtnText: { color: ACCENT, fontWeight: '700', fontSize: 13, letterSpacing: 2, fontFamily: 'monospace' },
  saveBtn: {
    borderWidth: 1, borderColor: GREEN, borderRadius: 6,
    paddingVertical: 12, paddingHorizontal: 20,
    alignItems: 'center', justifyContent: 'center', minWidth: 72,
  },
  saveBtnText:  { color: GREEN, fontWeight: '700', fontSize: 12, letterSpacing: 2, fontFamily: 'monospace' },
  btnDisabled:  { opacity: 0.5 },
  controlRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10,
  },
  controlCol:   { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10 },
  controlLabel: { color: '#444466', fontSize: 9, fontFamily: 'monospace', letterSpacing: 2 },
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: BG,
  },
  stepBtnText:  { color: ACCENT, fontSize: 18, lineHeight: 20 },
  stepValue:    { color: '#eeeeff', fontSize: 15, fontWeight: '700', minWidth: 40, textAlign: 'center' },
  typeChip: {
    marginRight: 8, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 4, borderWidth: 1, borderColor: BORDER,
  },
  typeChipActive: { borderColor: ACCENT, backgroundColor: 'rgba(0,212,255,0.08)' },
  typeChipText:   { color: '#555577', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 },
  gestureHint: {
    color: '#333355', fontSize: 10, fontFamily: 'monospace',
    textAlign: 'center', paddingTop: 4,
  },
});

