import React from 'react';
import Animated, {
  useAnimatedProps,
  interpolate,
  SharedValue,
} from 'react-native-reanimated';
import { Ellipse, Svg } from 'react-native-svg';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

interface GroundShadowProps {
  progress: SharedValue<number>; // 0 → 1
  width: number;
  height: number;
}

export const GroundShadow: React.FC<GroundShadowProps> = ({ progress, width, height }) => {
  const cx = width / 2;
  const cy = height * 0.85;
  const baseRx = width * 0.28;
  const baseRy = height * 0.025;

  const animatedProps = useAnimatedProps(() => {
    const scale = interpolate(progress.value, [0, 1], [0.3, 1.0]);
    const opacity = interpolate(progress.value, [0, 1], [0.05, 0.45]);
    return {
      rx: baseRx * scale,
      ry: baseRy * scale,
      opacity,
      fill: 'rgba(0,0,0,1)',
    };
  });

  return (
    <Svg width={width} height={height} style={{ position: 'absolute', bottom: 0 }}>
      <AnimatedEllipse
        cx={cx}
        cy={cy}
        animatedProps={animatedProps}
      />
    </Svg>
  );
};
