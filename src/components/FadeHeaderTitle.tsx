/**
 * src/components/FadeHeaderTitle.tsx
 *
 * Drop-in headerTitle component for Stack.Screen that fades in whenever
 * the title string changes (or on first mount).
 *
 * Usage in Stack.Screen options:
 *   headerTitle: () => <FadeHeaderTitle title={unit?.name ?? paramName ?? 'Unit'} />
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
  runOnUI,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';

interface FadeHeaderTitleProps {
  title: string;
  color?: string;
}

export default function FadeHeaderTitle({ title, color = '#eeeeff' }: FadeHeaderTitleProps) {
  const opacity = useSharedValue(0);
  const prevTitle = useRef('');
  const navigation = useNavigation();

  // Synchronously zero opacity on the UI thread before back animation starts
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      cancelAnimation(opacity);
      runOnUI(() => {
        'worklet';
        opacity.value = 0;
      })();
    });
    return unsubscribe;
  }, [navigation, opacity]);

  // Fade in whenever the title arrives or changes
  useEffect(() => {
    if (title && title !== prevTitle.current) {
      prevTitle.current = title;
      opacity.value = 0;
      opacity.value = withTiming(1, { duration: 280 });
    }
  }, [title, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text style={[styles.title, { color }, animStyle]} numberOfLines={1}>
      {title}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: '700',
    maxWidth: 220,
  },
});
