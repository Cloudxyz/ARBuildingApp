/**
 * src/demo/ARViewsDemoScreen.tsx
 *
 * Preview all three view modes on a plain background.
 * Modes:
 * - blueprint
 * - 3d
 * - magic3d
 *
 * State persistence rule:
 * keep all mode trees mounted and only hide/show active one.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  Platform,
  LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { IsometricBlueprintView } from '../components/IsometricBlueprintView';
import { BuildIdlePlaceholder } from '../components/BuildIdlePlaceholder';
import { Building3DOverlay } from '../ar/Building3DOverlay';
import MagicCanvasMode, { type MagicBuildPanelState } from '../magic/MagicCanvasMode';
import { ARModelConfig } from '../types';
import { DEFAULT_AR_CONFIG } from '../ar/useARBuildingModel';
import { useIsFocused } from 'expo-router';

type DemoViewMode = 'blueprint' | '3d' | 'magic3d';

const ACCENT = '#00d4ff';
const BG = '#070714';
const BORDER = '#1a1a3a';
const FOOTER_GUARD = 64;
const ANDROID_BOTTOM_INSET_FALLBACK = 36;
const ZOOM_HOLD_DELAY_MS = 140;
const VIEW3D_FLOOR_BUILD_SEC = 0.8;
const BLUEPRINT_FLOOR_BUILD_SEC = 0.7 / 6;

export default function ARViewsDemoScreen() {
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState<DemoViewMode>('blueprint');
  const [contentHeight, setContentHeight] = useState(height);
  const effectiveBottomInset = Math.max(
    insets.bottom,
    Platform.OS === 'android' ? ANDROID_BOTTOM_INSET_FALLBACK : 0,
  );
  const panelBottomPadding = 24 + effectiveBottomInset + FOOTER_GUARD;
  // Keep 3D preview larger, but always reserve space for controls on real screen area.
  const minPanelSpace = 240 + panelBottomPadding;
  const maxPreviewH = Math.max(220, contentHeight - minPanelSpace);
  const desiredPreviewH = Math.round(contentHeight * 0.5);
  const previewH = Math.min(desiredPreviewH, maxPreviewH);
  const magicPreviewH = Math.round(height * 0.55);
  const [blueprintIsPlaying, setBlueprintIsPlaying] = useState(false);
  const [blueprintAnimKey, setBlueprintAnimKey] = useState(0);
  const [blueprintCompleted, setBlueprintCompleted] = useState(false);
  const [view3dIsPlaying, setView3dIsPlaying] = useState(false);
  const [view3dAnimKey, setView3dAnimKey] = useState(0);
  const [view3dCompleted, setView3dCompleted] = useState(false);
  const [view3dZoomCmdId, setView3dZoomCmdId] = useState(0);
  const [view3dZoomCmdDir, setView3dZoomCmdDir] = useState<'in' | 'out'>('in');
  const [view3dZoomHoldDir, setView3dZoomHoldDir] = useState<-1 | 0 | 1>(0);
  const [view3dZoomUi, setView3dZoomUi] = useState(1.0);
  const [view3dCanZoomIn, setView3dCanZoomIn] = useState(true);
  const [view3dCanZoomOut, setView3dCanZoomOut] = useState(true);
  const [magicPlayCmdId, setMagicPlayCmdId] = useState(0);
  const [magicStopCmdId, setMagicStopCmdId] = useState(0);
  const [magicIncFloorCmdId, setMagicIncFloorCmdId] = useState(0);
  const [magicDecFloorCmdId, setMagicDecFloorCmdId] = useState(0);
  const [magicZoomCmdId, setMagicZoomCmdId] = useState(0);
  const [magicZoomCmdDir, setMagicZoomCmdDir] = useState<'in' | 'out'>('in');
  const [magicZoomHoldDir, setMagicZoomHoldDir] = useState<-1 | 0 | 1>(0);
  const [magicBuildState, setMagicBuildState] = useState<MagicBuildPanelState>({
    phase: 'pick',
    isPlaying: false,
    floorCount: 5,
    zoomValue: 1,
    canZoomIn: true,
    canZoomOut: true,
  });
  const zoomHoldStartedRef = useRef(false);
  const zoomHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const magicZoomHoldStartedRef = useRef(false);
  const magicZoomHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blueprintCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const view3dCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [config, setConfig] = useState<ARModelConfig>(() => ({
    ...DEFAULT_AR_CONFIG,
  }));

  const updateConfig = useCallback(
    <K extends keyof ARModelConfig>(key: K, value: ARModelConfig[K]) =>
      setConfig((c) => ({ ...c, [key]: value })),
    [],
  );

  // Non-magic gesture layer (kept as in existing demo behavior)
  const gestureScale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const gestureRotation = useSharedValue(0);
  const savedRotation = useSharedValue(0);
  const offsetX = useSharedValue(0);
  const savedOffsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const savedOffsetY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      gestureScale.value = Math.min(4, Math.max(0.25, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = gestureScale.value;
    });

  const rotate = Gesture.Rotation()
    .onUpdate((e) => {
      gestureRotation.value = savedRotation.value + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      savedRotation.value = gestureRotation.value;
    });

  const panG = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onUpdate((e) => {
      offsetX.value = savedOffsetX.value + e.translationX;
      offsetY.value = savedOffsetY.value + e.translationY;
    })
    .onEnd(() => {
      savedOffsetX.value = offsetX.value;
      savedOffsetY.value = offsetY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinch, rotate, panG);

  const handlePlay = () => {
    if (viewMode === 'blueprint') {
      if (blueprintCompleteTimerRef.current) {
        clearTimeout(blueprintCompleteTimerRef.current);
        blueprintCompleteTimerRef.current = null;
      }
      setBlueprintCompleted(false);
      setBlueprintAnimKey((k) => k + 1);
      setBlueprintIsPlaying(true);
      const blueprintDurationMs =
        Math.max(1, config.floorCount) * BLUEPRINT_FLOOR_BUILD_SEC * 1000;
      blueprintCompleteTimerRef.current = setTimeout(() => {
        setBlueprintCompleted(true);
        setBlueprintIsPlaying(false);
      }, blueprintDurationMs + 40);
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
      const usedFloors = Math.max(1, Math.min(20, config.floorCount));
      const buildDurationSec =
        (usedFloors * VIEW3D_FLOOR_BUILD_SEC) / Math.max(0.1, config.buildSpeed);
      view3dCompleteTimerRef.current = setTimeout(() => {
        setView3dCompleted(true);
        setView3dIsPlaying(false);
      }, buildDurationSec * 1000 + 40);
    }
  };

  const handleStop = () => {
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
  };
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

  const switchMode = (mode: DemoViewMode) => {
    if (mode === viewMode) return;
    if (mode !== '3d') {
      setView3dZoomHoldDir(0);
    }
    if (mode !== 'magic3d') {
      setMagicZoomHoldDir(0);
    }
    setViewMode(mode);
  };
  const handleZoomOut = useCallback(() => {
    if (!view3dCanZoomOut) return;
    setView3dZoomCmdDir('out');
    setView3dZoomCmdId((k) => k + 1);
  }, [view3dCanZoomOut]);
  const handleZoomIn = useCallback(() => {
    if (!view3dCanZoomIn) return;
    setView3dZoomCmdDir('in');
    setView3dZoomCmdId((k) => k + 1);
  }, [view3dCanZoomIn]);
  const startZoomHold = useCallback((dir: -1 | 1) => {
    if ((dir === 1 && !view3dCanZoomIn) || (dir === -1 && !view3dCanZoomOut)) return;
    zoomHoldStartedRef.current = false;
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
      zoomHoldTimerRef.current = null;
    }
    zoomHoldTimerRef.current = setTimeout(() => {
      zoomHoldStartedRef.current = true;
      setView3dZoomHoldDir(dir);
    }, ZOOM_HOLD_DELAY_MS);
  }, [view3dCanZoomIn, view3dCanZoomOut]);
  const stopZoomHold = useCallback(() => {
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
      zoomHoldTimerRef.current = null;
    }
    setView3dZoomHoldDir(0);
  }, []);
  const handleZoomTap = useCallback((dir: -1 | 1) => {
    if (zoomHoldStartedRef.current) {
      zoomHoldStartedRef.current = false;
      return;
    }
    if (dir === -1) {
      handleZoomOut();
    } else {
      handleZoomIn();
    }
  }, [handleZoomIn, handleZoomOut]);
  useEffect(() => {
    if (view3dZoomHoldDir === 1 && !view3dCanZoomIn) {
      setView3dZoomHoldDir(0);
    } else if (view3dZoomHoldDir === -1 && !view3dCanZoomOut) {
      setView3dZoomHoldDir(0);
    }
  }, [view3dZoomHoldDir, view3dCanZoomIn, view3dCanZoomOut]);
  const handle3dZoomMetrics = useCallback((metrics: {
    zoomValue: number;
    canZoomIn: boolean;
    canZoomOut: boolean;
  }) => {
    setView3dZoomUi(+metrics.zoomValue.toFixed(1));
    setView3dCanZoomIn(metrics.canZoomIn);
    setView3dCanZoomOut(metrics.canZoomOut);
  }, []);
  const handleMagicBuildState = useCallback((state: MagicBuildPanelState) => {
    setMagicBuildState(state);
  }, []);
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
  const handleMagicZoomOut = useCallback(() => {
    if (!magicBuildState.canZoomOut || magicBuildState.phase !== 'build3d') return;
    setMagicZoomCmdDir('out');
    setMagicZoomCmdId((k) => k + 1);
  }, [magicBuildState.canZoomOut, magicBuildState.phase]);
  const handleMagicZoomIn = useCallback(() => {
    if (!magicBuildState.canZoomIn || magicBuildState.phase !== 'build3d') return;
    setMagicZoomCmdDir('in');
    setMagicZoomCmdId((k) => k + 1);
  }, [magicBuildState.canZoomIn, magicBuildState.phase]);
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
    if (magicZoomHoldStartedRef.current) {
      magicZoomHoldStartedRef.current = false;
      return;
    }
    if (dir === -1) {
      handleMagicZoomOut();
    } else {
      handleMagicZoomIn();
    }
  }, [handleMagicZoomIn, handleMagicZoomOut]);
  useEffect(() => {
    if (magicZoomHoldDir === 1 && !magicBuildState.canZoomIn) {
      setMagicZoomHoldDir(0);
    } else if (magicZoomHoldDir === -1 && !magicBuildState.canZoomOut) {
      setMagicZoomHoldDir(0);
    }
  }, [magicZoomHoldDir, magicBuildState.canZoomIn, magicBuildState.canZoomOut]);
  useEffect(() => () => {
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
    }
    if (magicZoomHoldTimerRef.current) {
      clearTimeout(magicZoomHoldTimerRef.current);
    }
    if (blueprintCompleteTimerRef.current) {
      clearTimeout(blueprintCompleteTimerRef.current);
    }
    if (view3dCompleteTimerRef.current) {
      clearTimeout(view3dCompleteTimerRef.current);
    }
  }, []);
  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setContentHeight(h);
  }, []);

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
        {viewMode === 'magic3d' ? 'MAGIC - PHOTO -> 3D' : 'AR DEMO - NO CAMERA'}
      </Text>
    </View>
  );

  const isMagicMode = viewMode === 'magic3d';
  const panelIsPlaying = viewMode === '3d'
    ? (view3dIsPlaying && !view3dCompleted)
    : (blueprintIsPlaying && !blueprintCompleted);
  const magicPanelIsPlaying = magicBuildState.isPlaying;

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onRootLayout}>
      <View style={styles.togglePillBar}>{togglePill}</View>

      <View
        style={[styles.preview, { height: isMagicMode ? magicPreviewH : previewH }]}
      >
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
          />
        </View>

        <View
          style={[StyleSheet.absoluteFill, isMagicMode && styles.hiddenLayer]}
          pointerEvents={isMagicMode ? 'none' : 'auto'}
        >
          <GestureDetector gesture={composedGesture}>
            <View style={StyleSheet.absoluteFill}>
              <View
                style={[StyleSheet.absoluteFill, viewMode !== 'blueprint' && styles.hiddenLayer]}
                pointerEvents={viewMode === 'blueprint' ? 'auto' : 'none'}
              >
                {isFocused && (
                  <IsometricBlueprintView
                    key={`demo-bp-shape-${config.floorCount}-${config.footprintW}-${config.footprintH}`}
                    config={{
                      floorCount: config.floorCount,
                      scale: config.scale,
                      rotationDeg: config.rotationDeg,
                      buildingType: config.buildingType,
                      footprintW: config.footprintW,
                      footprintH: config.footprintH,
                      colorScheme: config.colorScheme,
                    }}
                    active={blueprintIsPlaying || blueprintCompleted}
                    animKey={blueprintAnimKey}
                    containerWidth={width}
                    containerHeight={previewH}
                    onBuildComplete={handleBlueprintBuildComplete}
                  />
                )}
                <BuildIdlePlaceholder visible={!blueprintIsPlaying && !blueprintCompleted} />
              </View>

              <View
                style={[StyleSheet.absoluteFill, viewMode !== '3d' && styles.hiddenLayer]}
                pointerEvents={viewMode === '3d' ? 'auto' : 'none'}
              >
                {isFocused && (
                  <Building3DOverlay
                    config={config}
                    isPlaying={view3dIsPlaying}
                    animKey={view3dAnimKey}
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
                <BuildIdlePlaceholder visible={!view3dIsPlaying && !view3dCompleted} />
              </View>
            </View>
          </GestureDetector>
        </View>

      </View>

      {labelBadge}

      <View
        style={[
          styles.panel,
          styles.panelContent,
          {
            paddingBottom: panelBottomPadding,
          },
        ]}
      >
        <View style={styles.row}>
          <TouchableOpacity
            style={[
              styles.playBtn,
              isMagicMode
                ? (magicPanelIsPlaying && styles.stopBtn)
                : (panelIsPlaying && styles.stopBtn),
              isMagicMode && magicBuildState.phase !== 'build3d' && styles.playBtnDisabled,
            ]}
            onPress={
              isMagicMode
                ? (magicPanelIsPlaying ? handleMagicStop : handleMagicPlay)
                : (panelIsPlaying ? handleStop : handlePlay)
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
        </View>

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

        {(viewMode === '3d' || isMagicMode) && (
          <ControlRow label="ZOOM">
            <Stepper
              value={isMagicMode ? `${magicBuildState.zoomValue.toFixed(1)}x` : `${view3dZoomUi.toFixed(1)}x`}
              onDec={isMagicMode ? () => handleMagicZoomTap(-1) : () => handleZoomTap(-1)}
              onInc={isMagicMode ? () => handleMagicZoomTap(1) : () => handleZoomTap(1)}
              onDecPressIn={isMagicMode ? () => startMagicZoomHold(-1) : () => startZoomHold(-1)}
              onDecPressOut={isMagicMode ? stopMagicZoomHold : stopZoomHold}
              onIncPressIn={isMagicMode ? () => startMagicZoomHold(1) : () => startZoomHold(1)}
              onIncPressOut={isMagicMode ? stopMagicZoomHold : stopZoomHold}
            />
          </ControlRow>
        )}

        <Text style={styles.hint}>
          {isMagicMode
            ? (magicBuildState.phase === 'build3d'
              ? 'Pinch / Rotate / Drag - gestures active on preview'
              : 'Generate 3D in Magic to enable Play / Floors / Zoom')
            : 'Pinch / Rotate / Drag - gestures active on preview'}
        </Text>
      </View>
    </GestureHandlerRootView>
  );
}

const ControlRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <View style={styles.controlRow}>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);

interface StepperProps {
  value: number | string;
  onDec: () => void;
  onInc: () => void;
  onDecPressIn?: () => void;
  onDecPressOut?: () => void;
  onIncPressIn?: () => void;
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  preview: {
    width: '100%',
    backgroundColor: '#050510',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    overflow: 'hidden',
  },
  hiddenLayer: {
    opacity: 0,
  },

  togglePillBar: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  togglePill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  pillBtn: { paddingHorizontal: 13, paddingVertical: 8 },
  pillBtnActive: { backgroundColor: ACCENT },
  pillBtnMagicActive: { backgroundColor: '#00ff88' },
  pillBtnText: { color: '#444466', fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
  pillBtnTextActive: { color: BG },
  pillBtnMagicText: { color: '#002211' },

  labelBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 4,
    marginTop: 4,
    marginBottom: 2,
  },
  labelText: { color: '#333366', fontSize: 9, fontFamily: 'monospace', letterSpacing: 2 },

  panel: { flex: 1 },
  panelContent: { padding: 16, gap: 12, paddingBottom: 32 },
  row: { flexDirection: 'row' },
  playBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: ACCENT,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  playBtnDisabled: { opacity: 0.45 },
  stopBtn: { borderColor: '#ff4444' },
  playBtnText: {
    color: ACCENT,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 10,
  },
  label: { color: '#444466', fontSize: 9, fontFamily: 'monospace', letterSpacing: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BG,
  },
  stepBtnText: { color: ACCENT, fontSize: 18, lineHeight: 20 },
  stepValue: {
    color: '#eeeeff',
    fontSize: 15,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'center',
  },
  hint: { color: '#333355', fontSize: 10, fontFamily: 'monospace', textAlign: 'center', paddingTop: 4 },

  idlePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  idlePlaceholderIcon: {
    fontSize: 42,
    color: 'rgba(0,212,255,0.25)',
    lineHeight: 46,
  },
  idlePlaceholderText: {
    color: 'rgba(0,212,255,0.35)',
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 2,
    textAlign: 'center',
    lineHeight: 18,
  },

  magicHintRow: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    alignItems: 'center',
  },
  magicHint: {
    color: '#334455',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
});
