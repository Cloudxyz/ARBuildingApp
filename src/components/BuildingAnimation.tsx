import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import {
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import { BlueprintOverlay } from './BlueprintOverlay';
import { FloatingParticles } from './FloatingParticles';
import { GroundShadow } from './GroundShadow';
import { BuildingConfig } from '../types';

// =============================================
// Constants
// =============================================
const BLUEPRINT_COLOR = '#00d4ff';
const FLOOR_HEIGHT = 24;
const FLOOR_GAP = 3;

// Phase timings (ms)
const PHASE1_DURATION = 1200; // Blueprint draw
const PHASE2_BASE_DELAY = 1200; // Floors start
const FLOOR_STAGGER = 180;
const PHASE3_DELAY = 1200; // Particles start
const PHASE4_DURATION = 3000; // Shadow builds duration total

// =============================================
// Single Floor
// =============================================
interface FloorProps {
  index: number;
  totalFloors: number;
  width: number;
  config: BuildingConfig;
  active: boolean;
}

const BuildingFloor: React.FC<FloorProps> = ({ index, totalFloors, width, config, active }) => {
  const translateY = useSharedValue(40);
  const opacity = useSharedValue(0);
  const delay = PHASE2_BASE_DELAY + index * FLOOR_STAGGER;
  const isRoof = index === totalFloors - 1;

  // Floor width tapers slightly toward top
  const taperRatio = 1 - (index / totalFloors) * 0.08;
  const floorW = config.footprintW * taperRatio;
  const windowCount = Math.max(1, Math.floor(floorW / 28));

  useEffect(() => {
    if (!active) {
      translateY.value = 40;
      opacity.value = 0;
      return;
    }
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: 500, easing: Easing.out(Easing.back(1.2)) })
    );
    opacity.value = withDelay(delay, withTiming(1, { duration: 400 }));
  }, [active]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.floor, { width: floorW }, animStyle]}>
      {/* Floor slab */}
      <View
        style={[
          styles.floorSlab,
          {
            height: FLOOR_HEIGHT,
            borderColor: BLUEPRINT_COLOR,
            backgroundColor: isRoof
              ? 'rgba(0,212,255,0.22)'
              : 'rgba(0,212,255,0.08)',
          },
        ]}
      >
        {/* Windows */}
        {!isRoof &&
          Array.from({ length: windowCount }).map((_, wi) => (
            <View key={wi} style={styles.window} />
          ))}
        {/* Roof details */}
        {isRoof && <View style={styles.roofRidge} />}
      </View>
      {/* Floor outline top line */}
      <View style={[styles.floorLine, { width: floorW }]} />
    </Animated.View>
  );
};

// =============================================
// BuildingAnimation
// =============================================
interface BuildingAnimationProps {
  config: BuildingConfig;
  active?: boolean;
  gesturesEnabled?: boolean;
  onPhaseChange?: (phase: number) => void;
  containerWidth?: number;
  containerHeight?: number;
}

export const BuildingAnimation: React.FC<BuildingAnimationProps> = ({
  config,
  active = false,
  gesturesEnabled = false,
  onPhaseChange,
  containerWidth,
  containerHeight,
}) => {
  const { width: winW, height: winH } = useWindowDimensions();
  const width = containerWidth ?? winW;
  const height = containerHeight ?? winH * 0.55;

  const [phase, setPhase] = useState(0);

  // Gesture shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const rotation = useSharedValue(config.rotationDeg);
  const savedRotation = useSharedValue(config.rotationDeg);

  // Shadow progress driven by floor construction
  const shadowProgress = useSharedValue(0);

  const advancePhase = useCallback(
    (p: number) => {
      setPhase(p);
      onPhaseChange?.(p);
    },
    [onPhaseChange]
  );

  useEffect(() => {
    if (!active) {
      setPhase(0);
      shadowProgress.value = 0;
      return;
    }

    // Phase 1: Blueprint (starts immediately)
    advancePhase(1);

    // Phase 2: Floors start — blueprint fades out at this moment
    const p2Timer = setTimeout(() => advancePhase(2), PHASE2_BASE_DELAY);

    // Phase 3: Particles
    const p3Timer = setTimeout(() => advancePhase(3), PHASE3_DELAY);

    // Phase 4: Shadow
    shadowProgress.value = withDelay(
      PHASE2_BASE_DELAY,
      withTiming(1, { duration: PHASE4_DURATION, easing: Easing.out(Easing.cubic) })
    );

    return () => {
      clearTimeout(p2Timer);
      clearTimeout(p3Timer);
    };
  }, [active]);

  // Pinch gesture — disabled in blueprint mode
  const pinch = Gesture.Pinch()
    .enabled(gesturesEnabled)
    .onUpdate((e) => {
      scale.value = Math.min(3, Math.max(0.3, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  // Rotation gesture — disabled in blueprint mode
  const rotationGesture = Gesture.Rotation()
    .enabled(gesturesEnabled)
    .onUpdate((e) => {
      rotation.value = savedRotation.value + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      savedRotation.value = rotation.value;
    });

  const composed = Gesture.Simultaneous(pinch, rotationGesture);

  const buildingContainerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rotation.value}deg` }],
  }));

  // Stack floors from bottom to top
  const floors = Array.from({ length: config.floorCount }, (_, i) => i);

  // Building total height
  const totalBuildingH =
    config.floorCount * (FLOOR_HEIGHT + FLOOR_GAP) + FLOOR_GAP;

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.container, { width, height }]}>
          {/* Phase 1: Blueprint overlay — fades out when floors start (phase 2) */}
          <BlueprintOverlay
            active={phase >= 1}
            opacity={phase >= 2 ? 0 : 1}
            width={width}
            height={height}
            footprintW={config.footprintW}
            footprintH={config.footprintH}
          />

          {/* Phase 4: Ground shadow */}
          <GroundShadow
            progress={shadowProgress}
            width={width}
            height={height}
          />

          {/* Phase 2: Floors */}
          <Animated.View
            style={[
              styles.buildingWrapper,
              {
                width: config.footprintW,
                height: totalBuildingH,
                bottom: height * 0.12,
                left: (width - config.footprintW) / 2,
              },
              buildingContainerStyle,
            ]}
          >
            {/* Render floors in reverse so bottom floor is at bottom */}
            {floors.reverse().map((i) => (
              <BuildingFloor
                key={i}
                index={i}
                totalFloors={config.floorCount}
                width={config.footprintW}
                config={config}
                active={phase >= 1}
              />
            ))}
          </Animated.View>

          {/* Phase 3: Floating particles */}
          <FloatingParticles
            active={phase >= 3}
            width={width}
            height={height}
            count={40}
            color={BLUEPRINT_COLOR}
          />

          {/* Phase label */}
          {active && (
            <View style={styles.phaseLabel} pointerEvents="none">
              <Text style={styles.phaseLabelText}>
                {phase === 1 ? 'SCANNING TERRAIN…' : phase >= 2 ? 'CONSTRUCTING…' : ''}
              </Text>
            </View>
          )}
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  buildingWrapper: {
    position: 'absolute',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  floor: {
    alignItems: 'center',
    marginBottom: FLOOR_GAP,
  },
  floorSlab: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  floorLine: {
    height: 1,
    backgroundColor: `${BLUEPRINT_COLOR}55`,
    position: 'absolute',
    bottom: 0,
  },
  window: {
    width: 10,
    height: 14,
    borderWidth: 1,
    borderColor: `${BLUEPRINT_COLOR}99`,
    backgroundColor: 'rgba(0,212,255,0.15)',
    borderRadius: 1,
  },
  roofRidge: {
    width: '60%',
    height: 3,
    backgroundColor: BLUEPRINT_COLOR,
    borderRadius: 2,
    opacity: 0.7,
  },
  phaseLabel: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  phaseLabelText: {
    color: BLUEPRINT_COLOR,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 3,
    opacity: 0.7,
  },
});
