/**
 * src/components/AnimatedPressable.tsx
 *
 * Drop-in replacement for TouchableOpacity.
 *
 * Features:
 *  - Spring scale feedback on press (pressIn → activeScale, pressOut → 1)
 *  - Smooth animated opacity for disabled / loading state (no snap)
 *  - All original PressableProps forwarded — fully backwards-compatible
 *  - Works on iOS + Android via Reanimated 3
 *
 * DO NOT use on GLView / Three.js objects.
 */

import React, { useCallback, useEffect } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { pressSpring, normalTiming } from '../lib/motion';

// Created once at module level — no per-render allocation.
// @ts-ignore – createAnimatedComponent with Pressable works correctly at runtime
const AnimPressable = Animated.createAnimatedComponent(Pressable);

export interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /**
   * Scale target on press-in.
   * Default 0.96 works for most buttons; use 0.92 for small icon buttons.
   */
  activeScale?: number;
}

export default function AnimatedPressable({
  style,
  disabled = false,
  activeScale = 0.96,
  onPressIn,
  onPressOut,
  ...rest
}: AnimatedPressableProps) {
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(disabled ? 0.5 : 1);

  // Animate opacity smoothly when disabled / loading toggled.
  useEffect(() => {
    opacity.value = withTiming(disabled ? 0.5 : 1, normalTiming);
  }, [disabled, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity:   opacity.value,
  }));

  const handlePressIn = useCallback(
    (e: Parameters<NonNullable<PressableProps['onPressIn']>>[0]) => {
      scale.value = withSpring(activeScale, pressSpring);
      onPressIn?.(e);
    },
    [activeScale, onPressIn, scale],
  );

  const handlePressOut = useCallback(
    (e: Parameters<NonNullable<PressableProps['onPressOut']>>[0]) => {
      scale.value = withSpring(1, pressSpring);
      onPressOut?.(e);
    },
    [onPressOut, scale],
  );

  return (
    <AnimPressable
      style={[style, animStyle]}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      android_ripple={null}
      {...rest}
    />
  );
}
