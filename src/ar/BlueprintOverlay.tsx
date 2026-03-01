/**
 * src/ar/BlueprintOverlay.tsx
 *
 * Canonical blueprint overlay (2-D SVG / Reanimated).
 * Draws a projected base outline that matches the Blueprint GL camera angle.
 */
import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import Svg, { Path, Rect, Line, G } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedG = Animated.createAnimatedComponent(G);

const STROKE_COLOR = '#00d4ff';
const STROKE_WIDTH = 1.5;
const GRID_COLOR = 'rgba(0,212,255,0.12)';
const PHASE_DURATION = 1200;
const DEFAULT_VIEW_AZIMUTH = Math.PI / 4;
const DEFAULT_VIEW_ELEVATION = (26 * Math.PI) / 180; // semi-isometric
const PIXEL_TO_WORLD = 1 / 18;
const FRUSTUM_PADDING = 1.25;
const INNER_INSET_PX = 10;

type Vec3 = { x: number; y: number; z: number };
type Vec2 = { x: number; y: number };
type OverlayBasis = {
  right: Vec3;
  up: Vec3;
};

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function createOverlayBasis(azimuth: number, elevation: number): OverlayBasis {
  const forward = normalize3({
    x: -Math.cos(elevation) * Math.sin(azimuth),
    y: -Math.sin(elevation),
    z: -Math.cos(elevation) * Math.cos(azimuth),
  });
  const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
  let right = normalize3(cross3(forward, worldUp));
  if (Math.hypot(right.x, right.y, right.z) < 1e-8) {
    right = { x: 1, y: 0, z: 0 };
  }
  const up = normalize3(cross3(right, forward));
  return { right, up };
}

function projectToPlane(point: Vec3, basis: OverlayBasis): Vec2 {
  return {
    x: dot3(point, basis.right),
    y: dot3(point, basis.up),
  };
}

function insetToward(point: Vec2, target: Vec2, insetPx: number): Vec2 {
  const dx = target.x - point.x;
  const dy = target.y - point.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return point;
  const k = Math.min(0.45, insetPx / len);
  return { x: point.x + dx * k, y: point.y + dy * k };
}

function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface BlueprintOverlayProps {
  active: boolean;
  width: number;
  height: number;
  footprintW?: number;
  footprintH?: number;
  floorCount?: number;
  viewAzimuth?: number;
  viewElevation?: number;
  opacity?: number;
  onComplete?: () => void;
}

export const BlueprintOverlay: React.FC<BlueprintOverlayProps> = ({
  active,
  width,
  height,
  footprintW = 160,
  footprintH = 100,
  floorCount = 0,
  viewAzimuth = DEFAULT_VIEW_AZIMUTH,
  viewElevation = DEFAULT_VIEW_ELEVATION,
  opacity = 1,
}) => {
  const bW = footprintW * PIXEL_TO_WORLD;
  const bD = footprintH * PIXEL_TO_WORLD;
  const totalH = Math.max(0.001, floorCount);
  const halfW = bW / 2;
  const halfD = bD / 2;
  const halfH = totalH / 2;
  const aspect = width / Math.max(1, height);
  const basis = createOverlayBasis(viewAzimuth, viewElevation);

  const boxCorners: Vec3[] = [
    { x: -halfW, y: -halfH, z: -halfD },
    { x: halfW, y: -halfH, z: -halfD },
    { x: -halfW, y: halfH, z: -halfD },
    { x: halfW, y: halfH, z: -halfD },
    { x: -halfW, y: -halfH, z: halfD },
    { x: halfW, y: -halfH, z: halfD },
    { x: -halfW, y: halfH, z: halfD },
    { x: halfW, y: halfH, z: halfD },
  ];

  let minPlaneX = Infinity;
  let maxPlaneX = -Infinity;
  let minPlaneY = Infinity;
  let maxPlaneY = -Infinity;
  boxCorners.forEach((corner) => {
    const p = projectToPlane(corner, basis);
    minPlaneX = Math.min(minPlaneX, p.x);
    maxPlaneX = Math.max(maxPlaneX, p.x);
    minPlaneY = Math.min(minPlaneY, p.y);
    maxPlaneY = Math.max(maxPlaneY, p.y);
  });

  const baseHalfW = Math.max(0.1, Math.max(Math.abs(minPlaneX), Math.abs(maxPlaneX)) * FRUSTUM_PADDING);
  const baseHalfH = Math.max(0.1, Math.max(Math.abs(minPlaneY), Math.abs(maxPlaneY)) * FRUSTUM_PADDING);
  let viewHalfH = baseHalfH;
  let viewHalfW = viewHalfH * aspect;
  if (viewHalfW < baseHalfW) {
    viewHalfW = baseHalfW;
    viewHalfH = viewHalfW / aspect;
  }

  const glScale = height / (2 * viewHalfH);
  const screenCX = width / 2;
  const screenCY = height / 2;
  const projectToScreen = (world: Vec3): Vec2 => {
    const p = projectToPlane(world, basis);
    return {
      x: screenCX + p.x * glScale,
      y: screenCY - p.y * glScale,
    };
  };

  const baseY = -halfH;
  const ptA = projectToScreen({ x: -halfW, y: baseY, z: -halfD });
  const ptB = projectToScreen({ x: halfW, y: baseY, z: -halfD });
  const ptC = projectToScreen({ x: halfW, y: baseY, z: halfD });
  const ptE = projectToScreen({ x: -halfW, y: baseY, z: halfD });

  const outerPath = `M${ptA.x},${ptA.y} L${ptB.x},${ptB.y} L${ptC.x},${ptC.y} L${ptE.x},${ptE.y} Z`;
  const centroid: Vec2 = {
    x: (ptA.x + ptB.x + ptC.x + ptE.x) / 4,
    y: (ptA.y + ptB.y + ptC.y + ptE.y) / 4,
  };
  const ptAi = insetToward(ptA, centroid, INNER_INSET_PX);
  const ptBi = insetToward(ptB, centroid, INNER_INSET_PX);
  const ptCi = insetToward(ptC, centroid, INNER_INSET_PX);
  const ptEi = insetToward(ptE, centroid, INNER_INSET_PX);
  const innerPath = `M${ptAi.x},${ptAi.y} L${ptBi.x},${ptBi.y} L${ptCi.x},${ptCi.y} L${ptEi.x},${ptEi.y} Z`;
  const diagPath = `M${ptA.x},${ptA.y} L${ptC.x},${ptC.y} M${ptB.x},${ptB.y} L${ptE.x},${ptE.y}`;

  const perimeterLen = Math.max(
    1,
    distance2(ptA, ptB) + distance2(ptB, ptC) + distance2(ptC, ptE) + distance2(ptE, ptA),
  );

  const outerDash = useSharedValue(perimeterLen);
  const innerDash = useSharedValue(perimeterLen * 0.8);
  const diagDash = useSharedValue(perimeterLen * 0.6);
  const cornerOp = useSharedValue(0);
  const rootOpacity = useSharedValue(opacity);

  useEffect(() => {
    rootOpacity.value = withTiming(opacity, { duration: 300 });
  }, [opacity]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) {
      outerDash.value = perimeterLen;
      innerDash.value = perimeterLen * 0.8;
      diagDash.value = perimeterLen * 0.6;
      cornerOp.value = 0;
      return;
    }

    outerDash.value = withTiming(0, { duration: PHASE_DURATION, easing: Easing.out(Easing.cubic) });
    innerDash.value = withDelay(
      300,
      withTiming(0, { duration: PHASE_DURATION - 200, easing: Easing.out(Easing.cubic) }),
    );
    diagDash.value = withDelay(
      600,
      withTiming(0, { duration: PHASE_DURATION - 300, easing: Easing.out(Easing.cubic) }),
    );
    cornerOp.value = withDelay(900, withTiming(1, { duration: 400 }));
  }, [active, perimeterLen]); // eslint-disable-line react-hooks/exhaustive-deps

  const outerProps = useAnimatedProps(() => ({ strokeDashoffset: outerDash.value }));
  const innerProps = useAnimatedProps(() => ({ strokeDashoffset: innerDash.value }));
  const diagProps = useAnimatedProps(() => ({ strokeDashoffset: diagDash.value }));
  const cornerProps = useAnimatedProps(() => ({ opacity: cornerOp.value }));
  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));

  const gridLines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * width;
    gridLines.push({ x1: x, y1: 0, x2: x, y2: height, key: `c${i}` });
  }
  for (let j = 0; j <= 5; j++) {
    const y = (j / 5) * height;
    gridLines.push({ x1: 0, y1: y, x2: width, y2: y, key: `r${j}` });
  }

  const corners: [number, number][] = [
    [ptA.x - 6, ptA.y - 6],
    [ptB.x - 6, ptB.y - 6],
    [ptC.x - 6, ptC.y - 6],
    [ptE.x - 6, ptE.y - 6],
  ];

  const baseCentroid = projectToScreen({ x: 0, y: baseY, z: 0 });
  const cx = baseCentroid.x;
  const cy = baseCentroid.y;

  return (
    <Animated.View
      style={[{ position: 'absolute', width, height }, rootStyle]}
      pointerEvents="none"
    >
      <Svg width={width} height={height}>
        {gridLines.map((l) => (
          <Line
            key={l.key}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={GRID_COLOR}
            strokeWidth={0.5}
          />
        ))}

        <AnimatedPath
          d={outerPath}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE_WIDTH * 1.5}
          strokeDasharray={perimeterLen}
          fill="rgba(0,212,255,0.04)"
          animatedProps={outerProps}
        />

        <AnimatedPath
          d={innerPath}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={perimeterLen * 0.8}
          fill="none"
          animatedProps={innerProps}
        />

        <AnimatedPath
          d={diagPath}
          stroke={`${STROKE_COLOR}66`}
          strokeWidth={0.8}
          strokeDasharray={perimeterLen * 0.6}
          fill="none"
          animatedProps={diagProps}
        />

        <AnimatedG animatedProps={cornerProps}>
          {corners.map(([x, y], idx) => (
            <AnimatedRect
              key={idx}
              x={x}
              y={y}
              width={12}
              height={12}
              stroke={STROKE_COLOR}
              strokeWidth={1.5}
              fill="none"
            />
          ))}
        </AnimatedG>

        <Line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke={`${STROKE_COLOR}88`} strokeWidth={1} />
        <Line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke={`${STROKE_COLOR}88`} strokeWidth={1} />
      </Svg>
    </Animated.View>
  );
};

export default BlueprintOverlay;
