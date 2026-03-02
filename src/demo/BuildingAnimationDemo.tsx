/**
 * BuildingAnimationDemo
 * =============================================
 * Standalone demo — NO Supabase, NO production data.
 * Lives exclusively under /src/demo.
 * Uses fictional unit data.
 * =============================================
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  useWindowDimensions,
  StatusBar,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BuildingAnimation } from '../components/BuildingAnimation';
import { BuildingConfig, BuildingType } from '../types';

// =============================================
// Fictional demo unit data — no real data used
// =============================================
const DEMO_UNIT = {
  name: 'Sunset Ridge Estate',
  id: 'demo-0001',
  area_sqm: 2400,
  city: 'Horizon Falls',
  state: 'NV',
  country: 'US',
  price: 284_000,
  status: 'available' as const,
  description:
    'A breathtaking plot overlooking the valley with panoramic sunset views. Utilities on site.',
};

const BUILDING_PRESETS: Array<{ label: string; config: BuildingConfig }> = [
  {
    label: 'Bungalow',
    config: {
      floorCount: 2,
      scale: 1,
      rotationDeg: 0,
      buildingType: 'residential',
      footprintW: 140,
      footprintH: 90,
      colorScheme: 'blueprint',
    },
  },
  {
    label: 'Villa',
    config: {
      floorCount: 4,
      scale: 1,
      rotationDeg: 0,
      buildingType: 'residential',
      footprintW: 160,
      footprintH: 100,
      colorScheme: 'blueprint',
    },
  },
  {
    label: 'Office',
    config: {
      floorCount: 8,
      scale: 1,
      rotationDeg: 0,
      buildingType: 'commercial',
      footprintW: 120,
      footprintH: 80,
      colorScheme: 'neon',
    },
  },
  {
    label: 'Tower',
    config: {
      floorCount: 14,
      scale: 1,
      rotationDeg: 0,
      buildingType: 'mixed',
      footprintW: 100,
      footprintH: 70,
      colorScheme: 'neon',
    },
  },
];

// =============================================
// Demo component
// =============================================
export default function BuildingAnimationDemo() {
  const { width, height } = useWindowDimensions();
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [phase, setPhase] = useState(0);
  const [key, setKey] = useState(0); // reset key forces remount

  const config = BUILDING_PRESETS[selectedPreset].config;

  const handlePlay = useCallback(() => {
    setKey((k) => k + 1);
    setPhase(0);
    setIsPlaying(true);
  }, []);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    setPhase(0);
  }, []);

  const handlePreset = useCallback(
    (idx: number) => {
      setSelectedPreset(idx);
      setIsPlaying(false);
      setPhase(0);
    },
    []
  );

  const phaseLabel = ['READY', 'SCANNING…', 'BUILDING…', 'LIVE'][phase] ?? 'LIVE';
  const phaseColor =
    phase === 0 ? '#666' : phase === 1 ? '#00d4ff' : phase === 2 ? '#00ffaa' : '#ffe044';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#070714" />
      <GestureHandlerRootView style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerBadge}>DEMO MODE</Text>
          <Text style={styles.headerTitle}>Building AR Preview</Text>
          <Text style={styles.headerSub}>No real data • Gestures: pinch to scale, rotate</Text>
        </View>

        {/* Unit Card */}
        <View style={styles.unitCard}>
          <View style={styles.unitCardLeft}>
            <Text style={styles.unitName}>{DEMO_UNIT.name}</Text>
            <Text style={styles.unitMeta}>
              {DEMO_UNIT.city}, {DEMO_UNIT.state} · {DEMO_UNIT.area_sqm.toLocaleString()} m²
            </Text>
            <Text style={styles.unitDesc} numberOfLines={2}>
              {DEMO_UNIT.description}
            </Text>
          </View>
          <View style={styles.unitCardRight}>
            <Text style={styles.unitPrice}>${(DEMO_UNIT.price / 1000).toFixed(0)}K</Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: DEMO_UNIT.status === 'available' ? '#00aa5522' : '#aa220022' },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  { color: DEMO_UNIT.status === 'available' ? '#00ff88' : '#ff4444' },
                ]}
              >
                {DEMO_UNIT.status.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Animation stage */}
        <View style={[styles.stage, { height: height * 0.38 }]}>
          {/* Scanline overlay */}
          <View style={styles.scanlineOverlay} pointerEvents="none">
            {Array.from({ length: 20 }).map((_, i) => (
              <View key={i} style={styles.scanline} />
            ))}
          </View>

          <BuildingAnimation
            key={key}
            config={config}
            active={isPlaying}
            onPhaseChange={setPhase}
            containerWidth={width}
            containerHeight={height * 0.38}
          />

          {/* Corner decorations */}
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />

          {/* Phase HUD */}
          <View style={styles.hud} pointerEvents="none">
            <View style={[styles.hudDot, { backgroundColor: phaseColor }]} />
            <Text style={[styles.hudText, { color: phaseColor }]}>{phaseLabel}</Text>
          </View>

          {/* Building type badge */}
          <View style={styles.typeBadge} pointerEvents="none">
            <Text style={styles.typeBadgeText}>
              {BUILDING_PRESETS[selectedPreset].label.toUpperCase()} ·{' '}
              {config.floorCount}F
            </Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.btnPlay, isPlaying && styles.btnPlayActive]}
            onPress={isPlaying ? handleStop : handlePlay}
          >
            <Text style={styles.btnPlayText}>{isPlaying ? '■ STOP' : '▶ LAUNCH AR'}</Text>
          </TouchableOpacity>
        </View>

        {/* Presets */}
        <View style={styles.presetsSection}>
          <Text style={styles.presetsLabel}>BUILDING PRESET</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll}>
            {BUILDING_PRESETS.map((p, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.presetBtn, selectedPreset === idx && styles.presetBtnActive]}
                onPress={() => handlePreset(idx)}
              >
                <Text
                  style={[styles.presetBtnText, selectedPreset === idx && styles.presetBtnTextActive]}
                >
                  {p.label}
                </Text>
                <Text style={styles.presetFloors}>{p.config.floorCount} fl.</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {[
            { label: 'FLOORS', value: config.floorCount },
            { label: 'FOOTPRINT W', value: `${config.footprintW}u` },
            { label: 'FOOTPRINT H', value: `${config.footprintH}u` },
            { label: 'TYPE', value: config.buildingType.toUpperCase().slice(0, 3) },
          ].map((s) => (
            <View key={s.label} style={styles.statBox}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Isolation notice */}
        <View style={styles.isolationNotice} pointerEvents="none">
          <Text style={styles.isolationText}>
            ⬡ DEMO ISOLATED · Data is fictional · Not connected to Supabase
          </Text>
        </View>
      </GestureHandlerRootView>
    </SafeAreaView>
  );
}

// =============================================
// Styles
// =============================================
const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerBadge: {
    color: '#ffe044',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 3,
    marginBottom: 2,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  unitCard: {
    flexDirection: 'row',
    backgroundColor: CARD_BG,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  unitCardLeft: {
    flex: 1,
    marginRight: 12,
  },
  unitCardRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  unitName: {
    color: '#eeeeff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  unitMeta: {
    color: ACCENT,
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  unitDesc: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    lineHeight: 16,
  },
  unitPrice: {
    color: '#00ff88',
    fontSize: 18,
    fontWeight: '800',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 1,
    fontWeight: '700',
  },
  stage: {
    marginHorizontal: 0,
    backgroundColor: '#040410',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    position: 'relative',
  },
  scanlineOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
    justifyContent: 'space-between',
    zIndex: 1,
    pointerEvents: 'none',
  },
  scanline: {
    flex: 1,
    borderBottomWidth: 0.3,
    borderBottomColor: 'rgba(0,212,255,0.04)',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: ACCENT,
    opacity: 0.5,
    zIndex: 10,
  },
  cornerTL: { top: 8, left: 8, borderTopWidth: 2, borderLeftWidth: 2 },
  cornerTR: { top: 8, right: 8, borderTopWidth: 2, borderRightWidth: 2 },
  cornerBL: { bottom: 8, left: 8, borderBottomWidth: 2, borderLeftWidth: 2 },
  cornerBR: { bottom: 8, right: 8, borderBottomWidth: 2, borderRightWidth: 2 },
  hud: {
    position: 'absolute',
    top: 12,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  hudDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  hudText: {
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  typeBadge: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,212,255,0.1)',
    borderWidth: 1,
    borderColor: `${ACCENT}44`,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    color: ACCENT,
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  controls: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPlay: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: ACCENT,
    borderRadius: 6,
    paddingHorizontal: 48,
    paddingVertical: 14,
  },
  btnPlayActive: {
    backgroundColor: 'rgba(0,212,255,0.08)',
    borderColor: '#ff4444',
  },
  btnPlayText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    fontFamily: 'monospace',
  },
  presetsSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  presetsLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 8,
  },
  presetScroll: {
    flexDirection: 'row',
  },
  presetBtn: {
    marginRight: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
    alignItems: 'center',
    minWidth: 72,
  },
  presetBtnActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.07)',
  },
  presetBtnText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontWeight: '600',
  },
  presetBtnTextActive: {
    color: ACCENT,
  },
  presetFloors: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statValue: {
    color: '#eeeeff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 8,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  isolationNotice: {
    alignItems: 'center',
    paddingBottom: 12,
    paddingTop: 4,
  },
  isolationText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});
