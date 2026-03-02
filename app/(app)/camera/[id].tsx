/**
 * app/(app)/camera/[id].tsx
 *
 * Unit AR Preview - same architecture as ARViewsDemoScreen but with:
 *  - Live camera feed as background (blueprint + 3d modes)
 *  - Unit-specific GLB model loaded in 3D view
 *  - Config persisted via useARBuildingModel / Supabase
 *
 * Modes:
 *  - blueprint  -> IsometricBlueprintView (solid dark background + blueprint grid)
 *  - 3d         -> Building3DOverlay with unit model (solid dark background)
 *  - magic3d    -> MagicCanvasMode (photo-to-3d, no camera feed)
 *
 * State rule: all mode trees stay mounted; only the active one is visible.
 * Do NOT modify src/demo/ARViewsDemoScreen.tsx -- this is an independent copy.
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useDialog } from '../../../src/lib/dialog';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUnitGlbModels, useUnits } from '../../../src/hooks/useUnits';
import { IsometricBlueprintView } from '../../../src/components/IsometricBlueprintView';
import { BuildIdlePlaceholder } from '../../../src/components/BuildIdlePlaceholder';
import { NoModelPlaceholder } from '../../../src/components/NoModelPlaceholder';
import { Building3DOverlay } from '../../../src/ar/Building3DOverlay';
import MagicCanvasMode, {
  type MagicBuildPanelState,
} from '../../../src/magic/MagicCanvasMode';
import { useARBuildingModel } from '../../../src/ar/useARBuildingModel';
import { ARViewMode, UnitType, resolveGlbSource } from '../../../src/types';

// -- Constants ----------------------------------------------------------------
const ACCENT     = '#00d4ff';
const BG         = '#070714';
const BORDER     = '#1a1a3a';
const GREEN      = '#00ff88';
const FOOTER_GUARD = 64;
const ANDROID_BOTTOM_INSET_FALLBACK = 36;
const ZOOM_HOLD_DELAY_MS     = 140;
const VIEW3D_FLOOR_BUILD_SEC = 0.8;
const BLUEPRINT_FLOOR_BUILD_SEC = 0.7 / 6;

const LAND_PREVIEW_TYPES: Array<Exclude<UnitType, 'land'>> = [
  'house',
  'building',
  'commercial',
];

// -- Screen -------------------------------------------------------------------
export default function UnitARPreviewScreen() {
  const isFocused = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const dialog = useDialog();
  const { units } = useUnits();
  const unit = units.find((u) => u.id === id);

  // Per-unit, per-type GLB models (Phase 1 data)
  const { byType, loading: glbLoading } = useUnitGlbModels(id ?? '');

  const [landPreviewType, setLandPreviewType] =
    useState<Exclude<UnitType, 'land'>>('house');

  // Resolve model URI using per-unit GLB records
  // land unit → resolve from the selected land-preview sub-type
  // non-land  → resolve from the unit's own type
  const resolvedModelUri = useMemo(() => {
    if (!unit) return null;
    if (unit.unit_type === 'land') {
      return resolveGlbSource(byType, landPreviewType);
    }
    return resolveGlbSource(byType, unit.unit_type);
  }, [byType, unit, landPreviewType]);

  // -- Layout -----------------------------------------------------------------
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [contentHeight, setContentHeight] = useState(height);

  const effectiveBottomInset = Math.max(
    insets.bottom,
    Platform.OS === 'android' ? ANDROID_BOTTOM_INSET_FALLBACK : 0,
  );
  const panelBottomPadding = 24 + effectiveBottomInset + FOOTER_GUARD;
  const minPanelSpace   = 240 + panelBottomPadding;
  const maxPreviewH     = Math.max(220, contentHeight - minPanelSpace);
  const desiredPreviewH = Math.round(contentHeight * 0.5);
  const previewH        = Math.min(desiredPreviewH, maxPreviewH);
  const magicPreviewH   = Math.round(height * 0.55);

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setContentHeight(h);
  }, []);

  // -- View mode --------------------------------------------------------------
  const [viewMode, setViewMode] = useState<ARViewMode>('blueprint');
  const isMagicMode = viewMode === 'magic3d';

  // -- Shared AR config (persisted via Supabase) ------------------------------
  const ar = useARBuildingModel(id);
  const { config, updateConfig, isSaving } = ar;

  const handleSave = async () => {
    const ok = await ar.save();
    if (ok) await dialog.alert({ title: 'Saved', message: 'Building configuration saved.' });
    else    await dialog.alert({ title: 'Error', message: 'Failed to save. Check your connection.' });
  };

  // -- Blueprint state --------------------------------------------------------
  const [blueprintIsPlaying, setBlueprintIsPlaying] = useState(false);
  const [blueprintAnimKey,   setBlueprintAnimKey]   = useState(0);
  const [blueprintCompleted, setBlueprintCompleted] = useState(false);
  const blueprintCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- 3D state ---------------------------------------------------------------
  const [view3dIsPlaying,   setView3dIsPlaying]   = useState(false);
  const [view3dAnimKey,     setView3dAnimKey]     = useState(0);
  const [view3dCompleted,   setView3dCompleted]   = useState(false);
  const [view3dZoomCmdId,   setView3dZoomCmdId]   = useState(0);
  const [view3dZoomCmdDir,  setView3dZoomCmdDir]  = useState<'in' | 'out'>('in');
  const [view3dZoomHoldDir, setView3dZoomHoldDir] = useState<-1 | 0 | 1>(0);
  const [view3dZoomUi,      setView3dZoomUi]      = useState(1.0);
  const [view3dCanZoomIn,   setView3dCanZoomIn]   = useState(true);
  const [view3dCanZoomOut,  setView3dCanZoomOut]  = useState(true);
  const view3dCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomHoldTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomHoldStartedRef     = useRef(false);

  // -- Magic3D state ----------------------------------------------------------
  const [magicPlayCmdId,     setMagicPlayCmdId]     = useState(0);
  const [magicStopCmdId,     setMagicStopCmdId]     = useState(0);
  const [magicIncFloorCmdId, setMagicIncFloorCmdId] = useState(0);
  const [magicDecFloorCmdId, setMagicDecFloorCmdId] = useState(0);
  const [magicZoomCmdId,     setMagicZoomCmdId]     = useState(0);
  const [magicZoomCmdDir,    setMagicZoomCmdDir]    = useState<'in' | 'out'>('in');
  const [magicZoomHoldDir,   setMagicZoomHoldDir]   = useState<-1 | 0 | 1>(0);
  const [magicBuildState,    setMagicBuildState]    = useState<MagicBuildPanelState>({
    phase: 'pick', isPlaying: false, floorCount: 5,
    zoomValue: 1, canZoomIn: true, canZoomOut: true,
    magicMode: 'generate', selectedModelType: 'house', resolvedModelUrl: null,
  });
  const [magicMode, setMagicMode] = useState<'generate' | 'model'>('generate');
  const [magicSelectedType, setMagicSelectedType] = useState<'house' | 'building' | 'commercial'>('house');
  const [showScrollHint, setShowScrollHint] = useState(false);
  const footerContentH = useRef(0);
  const footerContainerH = useRef(0);
  const footerScrollY = useRef(0);
  const scrollBounceY = useSharedValue(0);
  const animatedArrowStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollBounceY.value }],
  }));
  useEffect(() => {
    scrollBounceY.value = withRepeat(
      withSequence(
        withTiming(5, { duration: 380 }),
        withTiming(0, { duration: 380 }),
      ),
      -1,
      false,
    );
  }, [scrollBounceY]);
  const magicZoomHoldTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const magicZoomHoldStartedRef = useRef(false);

  // -- Gesture layer (blueprint + 3d) ----------------------------------------
  const gestureScale    = useSharedValue(1);
  const savedScale      = useSharedValue(1);
  const gestureRotation = useSharedValue(0);
  const savedRotation   = useSharedValue(0);
  const offsetX         = useSharedValue(0);
  const savedOffsetX    = useSharedValue(0);
  const offsetY         = useSharedValue(0);
  const savedOffsetY    = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      gestureScale.value = Math.min(4, Math.max(0.25, savedScale.value * e.scale));
    })
    .onEnd(() => { savedScale.value = gestureScale.value; });

  const rotate = Gesture.Rotation()
    .onUpdate((e) => {
      gestureRotation.value = savedRotation.value + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => { savedRotation.value = gestureRotation.value; });

  const panG = Gesture.Pan()
    .minPointers(1).maxPointers(1)
    .onUpdate((e) => {
      offsetX.value = savedOffsetX.value + e.translationX;
      offsetY.value = savedOffsetY.value + e.translationY;
    })
    .onEnd(() => {
      savedOffsetX.value = offsetX.value;
      savedOffsetY.value = offsetY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinch, rotate, panG);

  // -- Mode switch ------------------------------------------------------------
  const switchMode = useCallback((mode: ARViewMode) => {
    if (mode === viewMode) return;
    if (mode !== '3d')      setView3dZoomHoldDir(0);
    if (mode !== 'magic3d') setMagicZoomHoldDir(0);
    setViewMode(mode);
  }, [viewMode]);

  // -- Play / Stop ------------------------------------------------------------
  const handlePlay = useCallback(() => {
    if (viewMode === 'blueprint') {
      if (blueprintCompleteTimerRef.current) {
        clearTimeout(blueprintCompleteTimerRef.current);
        blueprintCompleteTimerRef.current = null;
      }
      setBlueprintCompleted(false);
      setBlueprintAnimKey((k) => k + 1);
      setBlueprintIsPlaying(true);
      const ms = Math.max(1, config.floorCount) * BLUEPRINT_FLOOR_BUILD_SEC * 1000;
      blueprintCompleteTimerRef.current = setTimeout(() => {
        setBlueprintCompleted(true);
        setBlueprintIsPlaying(false);
      }, ms + 40);
      return;
    }
    if (viewMode === '3d') {
      if (view3dCompleteTimerRef.current) {
        clearTimeout(view3dCompleteTimerRef.current);
        view3dCompleteTimerRef.current = null;
      }
      setView3dCompleted(false);
      setView3dAnimKey((k) => k + 1);
      setView3dIsPlaying(true);
      const floors = Math.max(1, Math.min(20, config.floorCount));
      const sec = (floors * VIEW3D_FLOOR_BUILD_SEC) / Math.max(0.1, config.buildSpeed);
      view3dCompleteTimerRef.current = setTimeout(() => {
        setView3dCompleted(true);
        setView3dIsPlaying(false);
      }, sec * 1000 + 40);
    }
  }, [viewMode, config.floorCount, config.buildSpeed]);

  const handleStop = useCallback(() => {
    if (viewMode === 'blueprint') {
      if (blueprintCompleteTimerRef.current) {
        clearTimeout(blueprintCompleteTimerRef.current);
        blueprintCompleteTimerRef.current = null;
      }
      setBlueprintIsPlaying(false);
      setBlueprintCompleted(false);
      return;
    }
    if (viewMode === '3d') {
      if (view3dCompleteTimerRef.current) {
        clearTimeout(view3dCompleteTimerRef.current);
        view3dCompleteTimerRef.current = null;
      }
      setView3dIsPlaying(false);
      setView3dCompleted(false);
    }
  }, [viewMode]);

  const handleBlueprintBuildComplete = useCallback(() => {
    if (blueprintCompleteTimerRef.current) {
      clearTimeout(blueprintCompleteTimerRef.current);
      blueprintCompleteTimerRef.current = null;
    }
    setBlueprintCompleted(true);
    setBlueprintIsPlaying(false);
  }, []);

  const handle3dBuildComplete = useCallback(() => {
    if (view3dCompleteTimerRef.current) {
      clearTimeout(view3dCompleteTimerRef.current);
      view3dCompleteTimerRef.current = null;
    }
    setView3dCompleted(true);
    setView3dIsPlaying(false);
  }, []);

  // -- 3D zoom controls -------------------------------------------------------
  const handleZoomIn = useCallback(() => {
    if (!view3dCanZoomIn) return;
    setView3dZoomCmdDir('in');
    setView3dZoomCmdId((k) => k + 1);
  }, [view3dCanZoomIn]);

  const handleZoomOut = useCallback(() => {
    if (!view3dCanZoomOut) return;
    setView3dZoomCmdDir('out');
    setView3dZoomCmdId((k) => k + 1);
  }, [view3dCanZoomOut]);

  const startZoomHold = useCallback((dir: -1 | 1) => {
    if ((dir === 1 && !view3dCanZoomIn) || (dir === -1 && !view3dCanZoomOut)) return;
    zoomHoldStartedRef.current = false;
    if (zoomHoldTimerRef.current) { clearTimeout(zoomHoldTimerRef.current); zoomHoldTimerRef.current = null; }
    zoomHoldTimerRef.current = setTimeout(() => {
      zoomHoldStartedRef.current = true;
      setView3dZoomHoldDir(dir);
    }, ZOOM_HOLD_DELAY_MS);
  }, [view3dCanZoomIn, view3dCanZoomOut]);

  const stopZoomHold = useCallback(() => {
    if (zoomHoldTimerRef.current) { clearTimeout(zoomHoldTimerRef.current); zoomHoldTimerRef.current = null; }
    setView3dZoomHoldDir(0);
  }, []);

  const handleZoomTap = useCallback((dir: -1 | 1) => {
    if (zoomHoldStartedRef.current) { zoomHoldStartedRef.current = false; return; }
    if (dir === -1) handleZoomOut(); else handleZoomIn();
  }, [handleZoomIn, handleZoomOut]);

  useEffect(() => {
    if      (view3dZoomHoldDir === 1  && !view3dCanZoomIn)  setView3dZoomHoldDir(0);
    else if (view3dZoomHoldDir === -1 && !view3dCanZoomOut) setView3dZoomHoldDir(0);
  }, [view3dZoomHoldDir, view3dCanZoomIn, view3dCanZoomOut]);

  const handle3dZoomMetrics = useCallback(
    (m: { zoomValue: number; canZoomIn: boolean; canZoomOut: boolean }) => {
      setView3dZoomUi(+m.zoomValue.toFixed(1));
      setView3dCanZoomIn(m.canZoomIn);
      setView3dCanZoomOut(m.canZoomOut);
    },
    [],
  );

  // -- Magic3D controls -------------------------------------------------------
  const handleMagicBuildState = useCallback(
    (state: MagicBuildPanelState) => setMagicBuildState(state),
    [],
  );

  const handleMagicPlay = useCallback(() => {
    if (magicBuildState.phase !== 'build3d') return;
    setMagicPlayCmdId((k) => k + 1);
  }, [magicBuildState.phase]);

  const handleMagicStop = useCallback(() => {
    setMagicStopCmdId((k) => k + 1);
  }, []);

  const handleMagicFloorDec = useCallback(() => {
    if (magicBuildState.phase !== 'build3d') return;
    setMagicDecFloorCmdId((k) => k + 1);
  }, [magicBuildState.phase]);

  const handleMagicFloorInc = useCallback(() => {
    if (magicBuildState.phase !== 'build3d') return;
    setMagicIncFloorCmdId((k) => k + 1);
  }, [magicBuildState.phase]);

  const handleMagicZoomIn = useCallback(() => {
    if (!magicBuildState.canZoomIn || magicBuildState.phase !== 'build3d') return;
    setMagicZoomCmdDir('in');
    setMagicZoomCmdId((k) => k + 1);
  }, [magicBuildState.canZoomIn, magicBuildState.phase]);

  const handleMagicZoomOut = useCallback(() => {
    if (!magicBuildState.canZoomOut || magicBuildState.phase !== 'build3d') return;
    setMagicZoomCmdDir('out');
    setMagicZoomCmdId((k) => k + 1);
  }, [magicBuildState.canZoomOut, magicBuildState.phase]);

  const startMagicZoomHold = useCallback((dir: -1 | 1) => {
    if (magicBuildState.phase !== 'build3d') return;
    if ((dir === 1 && !magicBuildState.canZoomIn) || (dir === -1 && !magicBuildState.canZoomOut)) return;
    magicZoomHoldStartedRef.current = false;
    if (magicZoomHoldTimerRef.current) {
      clearTimeout(magicZoomHoldTimerRef.current);
      magicZoomHoldTimerRef.current = null;
    }
    magicZoomHoldTimerRef.current = setTimeout(() => {
      magicZoomHoldStartedRef.current = true;
      setMagicZoomHoldDir(dir);
    }, ZOOM_HOLD_DELAY_MS);
  }, [magicBuildState.canZoomIn, magicBuildState.canZoomOut, magicBuildState.phase]);

  const stopMagicZoomHold = useCallback(() => {
    if (magicZoomHoldTimerRef.current) {
      clearTimeout(magicZoomHoldTimerRef.current);
      magicZoomHoldTimerRef.current = null;
    }
    setMagicZoomHoldDir(0);
  }, []);

  const handleMagicZoomTap = useCallback((dir: -1 | 1) => {
    if (magicZoomHoldStartedRef.current) { magicZoomHoldStartedRef.current = false; return; }
    if (dir === -1) handleMagicZoomOut(); else handleMagicZoomIn();
  }, [handleMagicZoomIn, handleMagicZoomOut]);

  useEffect(() => {
    if      (magicZoomHoldDir === 1  && !magicBuildState.canZoomIn)  setMagicZoomHoldDir(0);
    else if (magicZoomHoldDir === -1 && !magicBuildState.canZoomOut) setMagicZoomHoldDir(0);
  }, [magicZoomHoldDir, magicBuildState.canZoomIn, magicBuildState.canZoomOut]);

  // -- Cleanup timers ---------------------------------------------------------
  useEffect(() => () => {
    [
      zoomHoldTimerRef, magicZoomHoldTimerRef,
      blueprintCompleteTimerRef, view3dCompleteTimerRef,
    ].forEach((r) => { if (r.current) clearTimeout(r.current); });
  }, []);

  // -- Derived play state -----------------------------------------------------
  const panelIsPlaying = viewMode === '3d'
    ? (view3dIsPlaying && !view3dCompleted)
    : (blueprintIsPlaying && !blueprintCompleted);
  const magicPanelIsPlaying = magicBuildState.isPlaying;

  // -- Render -----------------------------------------------------------------
  return (
    <>
      <Stack.Screen
        options={{
          title: unit?.name ?? 'AR Preview',
          headerTintColor: ACCENT,
        }}
      />

      <GestureHandlerRootView style={styles.root} onLayout={onRootLayout}>

        {/* Mode pill */}
        <View style={styles.togglePillBar}>
          <View style={styles.togglePill} pointerEvents="box-none">
            {(['blueprint', '3d', 'magic3d'] as ARViewMode[]).map((m) => {
              const active = viewMode === m;
              const isMagic = m === 'magic3d';
              const label = m === 'blueprint' ? 'BLUEPRINT' : m === '3d' ? '3D VIEW' : '3D MAGIC';
              return (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.pillBtn,
                    active && (isMagic ? styles.pillBtnMagicActive : styles.pillBtnActive),
                  ]}
                  onPress={() => switchMode(m)}
                >
                  <Text
                    style={[
                      styles.pillBtnText,
                      active && (isMagic ? styles.pillBtnMagicText : styles.pillBtnTextActive),
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Preview area */}
        <View style={[styles.preview, { height: isMagicMode ? magicPreviewH : previewH }]}>

          {/* Magic3D layer */}
          <View
            style={[StyleSheet.absoluteFill, !isMagicMode && styles.hiddenLayer]}
            pointerEvents={isMagicMode ? 'auto' : 'none'}
          >
            <MagicCanvasMode
              width={width}
              height={magicPreviewH}
              active={isMagicMode}
              showBuildToolbar={true}
              playCommandId={magicPlayCmdId}
              stopCommandId={magicStopCmdId}
              incFloorCommandId={magicIncFloorCmdId}
              decFloorCommandId={magicDecFloorCmdId}
              externalZoomCommandId={magicZoomCmdId}
              externalZoomCommandDir={magicZoomCmdDir}
              externalZoomHoldDir={magicZoomHoldDir}
              onBuildStateChange={handleMagicBuildState}
              magicMode={magicMode}
              selectedModelType={magicSelectedType}
              onMagicModeChange={setMagicMode}
              onModelTypeChange={setMagicSelectedType}
            />
          </View>

          {/* Blueprint + 3D layers (solid background — same as Demo) */}
          <View
            style={[StyleSheet.absoluteFill, isMagicMode && styles.hiddenLayer]}
            pointerEvents={isMagicMode ? 'none' : 'auto'}
          >
            <GestureDetector gesture={composedGesture}>
              <View style={StyleSheet.absoluteFill}>

                {/* Blueprint */}
                <View
                  style={[StyleSheet.absoluteFill, viewMode !== 'blueprint' && styles.hiddenLayer]}
                  pointerEvents={viewMode === 'blueprint' ? 'auto' : 'none'}
                >
                  {isFocused && !glbLoading && (
                    <IsometricBlueprintView
                      key={`unit-bp-${id}-${landPreviewType}-${config.floorCount}-${config.footprintW}-${config.footprintH}`}
                      config={{
                        floorCount:   config.floorCount,
                        scale:        config.scale,
                        rotationDeg:  config.rotationDeg,
                        buildingType: config.buildingType,
                        footprintW:   config.footprintW,
                        footprintH:   config.footprintH,
                        colorScheme:  config.colorScheme,
                      }}
                      modelUri={resolvedModelUri}
                      active={blueprintIsPlaying || blueprintCompleted}
                      animKey={blueprintAnimKey}
                      containerWidth={width}
                      containerHeight={previewH}
                      onBuildComplete={handleBlueprintBuildComplete}
                    />
                  )}
                  <BuildIdlePlaceholder visible={!blueprintIsPlaying && !blueprintCompleted} />
                </View>

                {/* 3D + unit model */}
                <View
                  style={[StyleSheet.absoluteFill, viewMode !== '3d' && styles.hiddenLayer]}
                  pointerEvents={viewMode === '3d' ? 'auto' : 'none'}
                >
                  {isFocused && !glbLoading && (
                    <Building3DOverlay
                      key={`unit-3d-${id}-${unit?.unit_type ?? 'na'}-${landPreviewType}`}
                      config={config}
                      isPlaying={view3dIsPlaying}
                      animKey={view3dAnimKey}
                      modelUri={resolvedModelUri}
                      active={viewMode === '3d'}
                      width={width}
                      height={previewH}
                      zoomCommandId={view3dZoomCmdId}
                      zoomCommandDir={view3dZoomCmdDir}
                      zoomHoldDir={view3dZoomHoldDir}
                      onZoomMetrics={handle3dZoomMetrics}
                      onBuildComplete={handle3dBuildComplete}
                    />
                  )}
                  <BuildIdlePlaceholder visible={!view3dIsPlaying && !view3dCompleted && resolvedModelUri !== null} />
                  <NoModelPlaceholder
                    visible={resolvedModelUri === null}
                    unitType={unit?.unit_type === 'land' ? landPreviewType : (unit?.unit_type ?? 'land')}
                  />
                </View>

              </View>
            </GestureDetector>
          </View>
        </View>

        {/* Label badge */}
        <View style={styles.labelBadge} pointerEvents="none">
          <Text style={styles.labelText}>
            {isMagicMode
              ? 'MAGIC - PHOTO to 3D'
              : `${unit?.name?.toUpperCase() ?? 'UNIT'} - AR PREVIEW`}
          </Text>
        </View>

        {/* Controls panel */}
        <View style={{ flex: 1, maxHeight: isMagicMode ? Math.round(height * 0.38) : undefined }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: panelBottomPadding }}
          scrollEventThrottle={16}
          onScroll={({ nativeEvent }) => {
            footerScrollY.current = nativeEvent.contentOffset.y;
            setShowScrollHint(
              footerScrollY.current + footerContainerH.current < footerContentH.current - 8,
            );
          }}
          onContentSizeChange={(_w, h) => {
            footerContentH.current = h;
            setShowScrollHint(
              footerScrollY.current + footerContainerH.current < h - 8,
            );
          }}
          onLayout={({ nativeEvent: { layout } }) => {
            footerContainerH.current = layout.height;
            setShowScrollHint(
              footerScrollY.current + layout.height < footerContentH.current - 8,
            );
          }}
        >

          {/* Play / Stop + Save */}
          <View style={styles.row}>
            <TouchableOpacity
              style={[
                styles.playBtn,
                (isMagicMode ? magicPanelIsPlaying : panelIsPlaying) && styles.stopBtn,
                isMagicMode && magicBuildState.phase !== 'build3d' && styles.playBtnDisabled,
              ]}
              onPress={
                isMagicMode
                  ? (magicPanelIsPlaying ? handleMagicStop : handleMagicPlay)
                  : (panelIsPlaying      ? handleStop      : handlePlay)
              }
              disabled={isMagicMode && magicBuildState.phase !== 'build3d'}
            >
              <Text
                style={[
                  styles.playBtnText,
                  (isMagicMode ? magicPanelIsPlaying : panelIsPlaying) && { color: '#ff4444' },
                ]}
              >
                {(isMagicMode ? magicPanelIsPlaying : panelIsPlaying) ? 'STOP' : 'PLAY'}
              </Text>
            </TouchableOpacity>

            {!isMagicMode && (
              <TouchableOpacity
                style={[styles.saveBtn, isSaving && styles.btnDisabled]}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving
                  ? <ActivityIndicator color={GREEN} size="small" />
                  : <Text style={styles.saveBtnText}>SAVE</Text>}
              </TouchableOpacity>
            )}
          </View>

          {/* Land type selector */}
          {!isMagicMode && unit?.unit_type === 'land' && (
            <ControlRow label="LAND TYPE">
              <View style={styles.chipRow}>
                {LAND_PREVIEW_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, landPreviewType === t && styles.typeChipActive]}
                    onPress={() => setLandPreviewType(t)}
                  >
                    <Text
                      style={[
                        styles.typeChipText,
                        landPreviewType === t && { color: ACCENT },
                      ]}
                    >
                      {t.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ControlRow>
          )}

          {/* MODE selector — 3D Magic build3d only */}
          {isMagicMode && magicBuildState.phase === 'build3d' && (
            <ControlRow label="MODE">
              <View style={styles.chipRow}>
                {(['generate', 'model'] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.typeChip, magicMode === m && styles.typeChipActive]}
                    onPress={() => setMagicMode(m)}
                  >
                    <Text style={[styles.typeChipText, magicMode === m && { color: ACCENT }]}>
                      {m === 'generate' ? 'GENERATE' : 'MODEL'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ControlRow>
          )}

          {/* TYPE selector — magic model mode only */}
          {isMagicMode && magicBuildState.phase === 'build3d' && magicMode === 'model' && (
            <ControlRow label="TYPE">
              <View style={styles.chipRow}>
                {(['house', 'building', 'commercial'] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, magicSelectedType === t && styles.typeChipActive]}
                    onPress={() => setMagicSelectedType(t)}
                  >
                    <Text style={[styles.typeChipText, magicSelectedType === t && { color: ACCENT }]}>
                      {t.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ControlRow>
          )}

          {/* Floors */}
          <ControlRow label="FLOORS">
            <Stepper
              value={isMagicMode ? magicBuildState.floorCount : config.floorCount}
              onDec={
                isMagicMode
                  ? handleMagicFloorDec
                  : () => updateConfig('floorCount', Math.max(1, config.floorCount - 1))
              }
              onInc={
                isMagicMode
                  ? handleMagicFloorInc
                  : () => updateConfig('floorCount', Math.min(20, config.floorCount + 1))
              }
            />
          </ControlRow>

          {/* Zoom (3d + magic3d only) */}
          {(viewMode === '3d' || isMagicMode) && (
            <ControlRow label="ZOOM">
              <Stepper
                value={
                  isMagicMode
                    ? `${magicBuildState.zoomValue.toFixed(1)}x`
                    : `${view3dZoomUi.toFixed(1)}x`
                }
                onDec={isMagicMode ? () => handleMagicZoomTap(-1) : () => handleZoomTap(-1)}
                onInc={isMagicMode ? () => handleMagicZoomTap(1)  : () => handleZoomTap(1)}
                onDecPressIn={isMagicMode  ? () => startMagicZoomHold(-1) : () => startZoomHold(-1)}
                onDecPressOut={isMagicMode ? stopMagicZoomHold              : stopZoomHold}
                onIncPressIn={isMagicMode  ? () => startMagicZoomHold(1)  : () => startZoomHold(1)}
                onIncPressOut={isMagicMode ? stopMagicZoomHold              : stopZoomHold}
              />
            </ControlRow>
          )}

          <Text style={styles.hint}>
            {isMagicMode
              ? (magicBuildState.phase === 'build3d'
                ? 'Pinch / Rotate / Drag active on preview'
                : 'Generate 3D in Magic to unlock Play / Floors / Zoom')
              : 'Pinch / Rotate / Drag active on preview'}
          </Text>
        </ScrollView>
        {showScrollHint && (
          <Animated.View style={[styles.scrollHintArrow, animatedArrowStyle]} pointerEvents="none">
            <Text style={styles.scrollHintText}>{'▾'}</Text>
          </Animated.View>
        )}
        </View>

      </GestureHandlerRootView>
    </>
  );
}

// -- Sub-components -----------------------------------------------------------
const ControlRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <View style={styles.controlRow}>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);

interface StepperProps {
  value: number | string;
  onDec: () => void;
  onInc: () => void;
  onDecPressIn?:  () => void;
  onDecPressOut?: () => void;
  onIncPressIn?:  () => void;
  onIncPressOut?: () => void;
}

const Stepper: React.FC<StepperProps> = ({
  value,
  onDec,
  onInc,
  onDecPressIn,
  onDecPressOut,
  onIncPressIn,
  onIncPressOut,
}) => (
  <View style={styles.stepper}>
    <TouchableOpacity
      style={styles.stepBtn}
      onPress={onDec}
      onPressIn={onDecPressIn}
      onPressOut={onDecPressOut}
    >
      <Text style={styles.stepBtnText}>-</Text>
    </TouchableOpacity>
    <Text style={styles.stepValue}>{value}</Text>
    <TouchableOpacity
      style={styles.stepBtn}
      onPress={onInc}
      onPressIn={onIncPressIn}
      onPressOut={onIncPressOut}
    >
      <Text style={styles.stepBtnText}>+</Text>
    </TouchableOpacity>
  </View>
);

// -- Styles -------------------------------------------------------------------
const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: BG },
  togglePillBar: {
    width: '100%', alignItems: 'center', paddingVertical: 8,
    backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  togglePill: {
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 8, borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
  },
  pillBtn:            { paddingHorizontal: 13, paddingVertical: 8 },
  pillBtnActive:      { backgroundColor: ACCENT },
  pillBtnMagicActive: { backgroundColor: GREEN },
  pillBtnText: {
    color: 'rgba(255,255,255,0.6)', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: '700',
  },
  pillBtnTextActive:  { color: BG },
  pillBtnMagicText:   { color: '#002211' },

  preview: {
    width: '100%', backgroundColor: '#050510',
    borderBottomWidth: 1, borderBottomColor: BORDER, overflow: 'hidden',
  },
  hiddenLayer: { opacity: 0 },

  labelBadge: {
    alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12, paddingVertical: 3,
    borderRadius: 4, marginTop: 4, marginBottom: 2,
  },
  labelText: {
    color: 'rgba(255,255,255,0.5)', fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 2,
  },

  panel: { flex: 1, padding: 16, gap: 12 },
  scrollHintArrow: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    backgroundColor: 'rgba(20,20,60,0.72)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 1,
    zIndex: 10,
  },
  scrollHintText: { color: '#fff', fontSize: 20, lineHeight: 24 },
  row:   { flexDirection: 'row', gap: 10 },

  playBtn: {
    flex: 1, borderWidth: 1.5, borderColor: ACCENT,
    borderRadius: 6, paddingVertical: 12, alignItems: 'center',
  },
  playBtnDisabled: { opacity: 0.45 },
  stopBtn:     { borderColor: '#ff4444' },
  playBtnText: {
    color: ACCENT, fontWeight: '700', fontSize: 13, letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },

  saveBtn: {
    borderWidth: 1, borderColor: GREEN, borderRadius: 6,
    paddingVertical: 12, paddingHorizontal: 20,
    alignItems: 'center', justifyContent: 'center', minWidth: 72,
  },
  saveBtnText: {
    color: GREEN, fontWeight: '700', fontSize: 12, letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  btnDisabled: { opacity: 0.5 },

  controlRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10,
  },
  label: {
    color: 'rgba(255,255,255,0.55)', fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 2,
  },

  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center', backgroundColor: BG,
  },
  stepBtnText: { color: ACCENT, fontSize: 18, lineHeight: 20 },
  stepValue: {
    color: '#eeeeff', fontSize: 15, fontWeight: '700',
    minWidth: 40, textAlign: 'center',
  },

  chipRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 4, borderWidth: 1, borderColor: BORDER,
  },
  typeChipActive: { borderColor: ACCENT, backgroundColor: 'rgba(0,212,255,0.08)' },
  typeChipText: {
    color: 'rgba(255,255,255,0.65)', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 1,
  },

  hint: {
    color: 'rgba(255,255,255,0.45)', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    textAlign: 'center', paddingTop: 4,
  },
});