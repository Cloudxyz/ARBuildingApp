import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { ParticleConfig } from '../types';

// =============================================
// Generate 40 particles with seeded randomness
// =============================================
function generateParticles(count: number, width: number, height: number): ParticleConfig[] {
  const particles: ParticleConfig[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random via linear congruential hash
    const seed  = (i * 9301 + 49297) % 233280;
    const r     = seed / 233280;
    const seed2 = ((i + 13) * 9301 + 49297) % 233280;
    const r2    = seed2 / 233280;
    const seed3 = ((i + 29) * 9301 + 49297) % 233280;
    const r3    = seed3 / 233280;
    const seed4 = ((i + 47) * 9301 + 49297) % 233280;
    const r4    = seed4 / 233280; // phase: where in the cycle this particle begins

    particles.push({
      id: i,
      x: r * width,
      y: r2 * height * 0.85,     // spread across full height, not just bottom half
      size: 2 + r3 * 4,
      duration: 2500 + r * 3000,
      delay: r3 * 600,            // tiny stagger only (was 0-4000 ms)
      phase: r4,
    });
  }
  return particles;
}

// =============================================
// Single particle
// =============================================
interface SingleParticleProps {
  config: ParticleConfig;
  active: boolean;
  color: string;
}

const SingleParticle: React.FC<SingleParticleProps> = ({ config, active, color }) => {
  const maxFloat  = 120 + config.size * 10;
  // Start at a random point in the float range so particles are spread from frame 1
  const translateY = useSharedValue(-config.phase * maxFloat);
  const opacity    = useSharedValue(active ? 0.15 + config.phase * 0.6 : 0);

  useEffect(() => {
    if (!active) {
      opacity.value = withTiming(0, { duration: 300 });
      return;
    }

    // withRepeat resets to the value translateY had when withRepeat was called,
    // so each particle cycles between its own phase-offset start and the top.
    opacity.value = withDelay(
      config.delay,
      withRepeat(
        withTiming(0.85, { duration: config.duration * 0.35 }),
        -1,
        true
      )
    );

    translateY.value = withDelay(
      config.delay,
      withRepeat(
        withTiming(-maxFloat, {
          duration: config.duration * (1 - config.phase * 0.6),
          easing: Easing.out(Easing.quad),
        }),
        -1,
        false
      )
    );
  }, [active]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: config.x,
          top: config.y,
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: color,
          shadowColor: color,
        },
        style,
      ]}
    />
  );
};

// =============================================
// FloatingParticles component
// =============================================
interface FloatingParticlesProps {
  active: boolean;
  width: number;
  height: number;
  count?: number;
  color?: string;
}

export const FloatingParticles: React.FC<FloatingParticlesProps> = ({
  active,
  width,
  height,
  count = 40,
  color = '#00d4ff',
}) => {
  const particles = React.useMemo(
    () => generateParticles(count, width, height),
    [count, width, height]
  );

  return (
    <View style={[styles.container, { width, height }]} pointerEvents="none">
      {particles.map((p) => (
        <SingleParticle key={p.id} config={p} active={active} color={color} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  particle: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
});
