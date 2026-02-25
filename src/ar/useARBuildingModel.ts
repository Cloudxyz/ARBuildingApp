import { useCallback, useEffect, useState } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';
import { Gesture, SimultaneousGesture } from 'react-native-gesture-handler';
import { useLandModel } from '../hooks/useLands';
import { ARModelConfig, BuildingType } from '../types';

// =============================================
// Defaults
// =============================================
export const DEFAULT_AR_CONFIG: ARModelConfig = {
  floorCount: 3,
  buildSpeed: 3.0,
  scale: 1.0,
  rotationDeg: 0,
  offsetX: 0,
  offsetY: 0,
  blueprintOpacity: 1.0,
  shadowStrength: 0.7,
  footprintW: 160,
  footprintH: 100,
  buildingType: 'residential',
  colorScheme: 'blueprint',
};

// =============================================
// Hook return type
// =============================================
export interface ARBuildingModel {
  // Config
  config: ARModelConfig;
  setConfig: React.Dispatch<React.SetStateAction<ARModelConfig>>;
  updateConfig: <K extends keyof ARModelConfig>(key: K, value: ARModelConfig[K]) => void;

  // Animation state
  isPlaying: boolean;
  phase: number;
  setPhase: (p: number) => void;
  animKey: number;

  // Controls
  play: () => void;
  stop: () => void;
  reset: () => void;

  // Supabase
  save: () => Promise<boolean>;
  isSaving: boolean;

  // Gesture — compose this in GestureDetector
  composedGesture: SimultaneousGesture;

  // Shared values for overlays
  gestureScale: SharedValue<number>;
  gestureRotation: SharedValue<number>;
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;

  // Animated container style (apply to a wrapping Animated.View over the camera)
  containerAnimatedStyle: ReturnType<typeof useAnimatedStyle>;
}

// =============================================
// useARBuildingModel
// =============================================
export function useARBuildingModel(landId: string): ARBuildingModel {
  const { model, saveModel } = useLandModel(landId);

  // ── Config ──────────────────────────────────
  const [config, setConfig] = useState<ARModelConfig>(DEFAULT_AR_CONFIG);
  const [isSaving, setIsSaving] = useState(false);

  // Load from Supabase model (fires when model first loads)
  useEffect(() => {
    if (!model) return;
    const extra = (model.model_data ?? {}) as Partial<ARModelConfig>;
    setConfig({
      floorCount: model.floor_count,
      buildSpeed: extra.buildSpeed ?? 3.0,
      scale: model.scale,
      rotationDeg: model.rotation_deg,
      offsetX: extra.offsetX ?? 0,
      offsetY: extra.offsetY ?? 0,
      blueprintOpacity: extra.blueprintOpacity ?? 1.0,
      shadowStrength: extra.shadowStrength ?? 0.7,
      footprintW: model.footprint_w,
      footprintH: model.footprint_h,
      buildingType: model.building_type as BuildingType,
      colorScheme: (model.color_scheme as ARModelConfig['colorScheme']) ?? 'blueprint',
    });
  }, [model?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateConfig = useCallback(
    <K extends keyof ARModelConfig>(key: K, value: ARModelConfig[K]) =>
      setConfig((c) => ({ ...c, [key]: value })),
    []
  );

  // ── Animation state ──────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [phase, setPhase] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  const play = useCallback(() => {
    setAnimKey((k) => k + 1);
    setPhase(0);
    setIsPlaying(true);
  }, []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    setPhase(0);
  }, []);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setPhase(0);
    setAnimKey((k) => k + 1);
  }, []);

  // ── Gesture shared values ────────────────────
  const gestureScale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const gestureRotation = useSharedValue(0);
  const savedRotation = useSharedValue(0);

  const offsetX = useSharedValue(0);
  const savedOffsetX = useSharedValue(0);

  const offsetY = useSharedValue(0);
  const savedOffsetY = useSharedValue(0);

  // Pinch-to-scale
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      gestureScale.value = Math.min(4, Math.max(0.25, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = gestureScale.value;
    });

  // Two-finger rotate
  const rotate = Gesture.Rotation()
    .onUpdate((e) => {
      gestureRotation.value = savedRotation.value + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      savedRotation.value = gestureRotation.value;
    });

  // Pan / drag offset
  const pan = Gesture.Pan()
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

  const composedGesture = Gesture.Simultaneous(pinch, rotate, pan);

  // Animated container style — apply to both overlay wrappers
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: gestureScale.value },
      { rotate: `${gestureRotation.value}deg` },
    ],
  }));

  // ── Supabase save ────────────────────────────
  const save = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    const result = await saveModel({
      land_id: landId,
      floor_count: config.floorCount,
      scale: config.scale,
      rotation_deg: config.rotationDeg,
      building_type: config.buildingType,
      color_scheme: config.colorScheme,
      footprint_w: config.footprintW,
      footprint_h: config.footprintH,
      model_data: {
        buildSpeed: config.buildSpeed,
        offsetX: config.offsetX,
        offsetY: config.offsetY,
        blueprintOpacity: config.blueprintOpacity,
        shadowStrength: config.shadowStrength,
      },
    });
    setIsSaving(false);
    return result !== null;
  }, [config, landId, saveModel]);

  return {
    config,
    setConfig,
    updateConfig,
    isPlaying,
    phase,
    setPhase,
    animKey,
    play,
    stop,
    reset,
    save,
    isSaving,
    composedGesture,
    gestureScale,
    gestureRotation,
    offsetX,
    offsetY,
    containerAnimatedStyle,
  };
}
