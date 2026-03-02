/**
 * src/components/ScreenLoader.tsx
 *
 * Overlay that sits on top of screen content and fades out once `ready` is true.
 * Eliminates the visible "jump" when screen data loads after navigation.
 *
 * Usage:
 *   <ScreenLoader ready={!!unit && !loading} />
 *
 * Place it as the LAST child inside the screen's root View/Fragment so it
 * renders on top of everything via absolute positioning.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

interface ScreenLoaderProps {
  /** Set to true once the screen's primary data is available. */
  ready: boolean;
  /** Background color of the overlay. Default: '#070714'. */
  color?: string;
}

export default function ScreenLoader({ ready, color = '#070714' }: ScreenLoaderProps) {
  const opacity = useSharedValue(1);
  const [mounted, setMounted] = useState(true);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (ready) {
      opacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [ready, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.overlay, { backgroundColor: color }, overlayStyle]}>
      <ActivityIndicator color="#00d4ff" size="large" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
});
