/**
 * src/ar/BlueprintOverlay.tsx
 *
 * Canonical blueprint overlay (2-D SVG / Reanimated).
 * Identical to the original component but adds the `opacity` prop so the
 * camera screen can fade it in/out when switching view modes.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
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
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedG = Animated.createAnimatedComponent(G);

// ── Constants ────────────────────────────────────────────────────────────────
const STROKE_COLOR = '#00d4ff';
const STROKE_WIDTH = 1.5;
const GRID_COLOR = 'rgba(0,212,255,0.12)';
const PHASE_DURATION = 1200;

// ── Props ────────────────────────────────────────────────────────────────────
export interface BlueprintOverlayProps {
  active: boolean;
  width: number;
  height: number;
  footprintW?: number;
  footprintH?: number;
  floorCount?: number; // used to match GL frustum vertical offset
  opacity?: number;   // 0-1, default 1
  onComplete?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────
export const BlueprintOverlay: React.FC<BlueprintOverlayProps> = ({
  active,
  width,
  height,
  footprintW = 160,
  footprintH = 100,
  floorCount = 0,
  opacity = 1,
  onComplete,
}) => {
  // ── Isometric projection constants ──────────────────────────────────────
  // Same camera as IsometricBlueprintView: position at (d,d,d) → azimuth 45°,
  // elevation 35.264°. In screen-space (Y down):
  //   world +X → (+cos30, +sin30) = (+√3/2, +0.5) per unit
  //   world +Z → (-cos30, +sin30) = (-√3/2, +0.5) per unit
  const ISO_COS = Math.sqrt(3) / 2;   // cos 30°
  const ISO_SIN = 0.5;                // sin 30°
  const _W = footprintW;              // footprint world X extent (px)
  const _D = footprintH;              // footprint world Z extent (px)

  // ── GL frustum math — mirrors IsometricBlueprintView exactly ─────────────
  const PIXEL_TO_WORLD = 1 / 18;     // same constant
  const FRUSTUM_PADDING = 1.25;      // same constant
  const bW = _W * PIXEL_TO_WORLD;    // world X
  const bD = _D * PIXEL_TO_WORLD;    // world Z
  const totalH = floorCount * 1.0;   // world height (1 m/floor)
  const aspect = width / height;

  const projW = ISO_COS * (bW + bD);           // projected width  in world units
  const projH = ISO_SIN * (bW + bD) + totalH;  // projected height in world units

  let viewHalfH = (projH / 2) * FRUSTUM_PADDING;
  let viewHalfW = viewHalfH * aspect;
  if (viewHalfW < (projW / 2) * FRUSTUM_PADDING) {
    viewHalfW = (projW / 2) * FRUSTUM_PADDING;
    viewHalfH = viewHalfW / aspect;
  }

  const glScale = height / (2 * viewHalfH);  // world units → screen px
  const _S      = glScale * PIXEL_TO_WORLD;   // footprint-px → screen-px

  // Perimeter in screen pixels (isometric preserves lengths, each world unit = _S px)
  const perimeterLen = 2 * (_W + _D) * _S;

  // Stroke-dashoffset reveals (full → 0)
  const outerDash = useSharedValue(perimeterLen);
  const innerDash = useSharedValue(perimeterLen * 0.8);
  const diagDash  = useSharedValue(perimeterLen * 0.6);
  const cornerOp  = useSharedValue(0);
  const rootOpacity = useSharedValue(opacity);

  // Keep rootOpacity in sync with prop
  useEffect(() => {
    rootOpacity.value = withTiming(opacity, { duration: 300 });
  }, [opacity]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) {
      outerDash.value = perimeterLen;
      innerDash.value = perimeterLen * 0.8;
      diagDash.value  = perimeterLen * 0.6;
      cornerOp.value  = 0;
      return;
    }

    outerDash.value = withTiming(0, { duration: PHASE_DURATION, easing: Easing.out(Easing.cubic) });
    innerDash.value = withDelay(
      300,
      withTiming(0, { duration: PHASE_DURATION - 200, easing: Easing.out(Easing.cubic) })
    );
    diagDash.value = withDelay(
      600,
      withTiming(0, { duration: PHASE_DURATION - 300, easing: Easing.out(Easing.cubic) })
    );
    cornerOp.value = withDelay(900, withTiming(1, { duration: 400 }));
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Isometric layout ──────────────────────────────────────────────────────
  // Project world (wx, wz) → screen (x, y) using true isometric axes.
  // Origin = screen position of world corner (0,0) = top vertex of rhombus.
  //
  // Rhombus centroid (relative to origin):
  const centRelX = (_W - _D) * ISO_COS * _S / 2;
  const centRelY = (_W + _D) * ISO_SIN * _S / 2;
  // Footprint centroid sits totalH/√6 below the view centre (derived from camera math):
  const screenCX = width  / 2;
  const screenCY = height / 2 + (totalH / Math.sqrt(6)) * glScale;
  const originX  = screenCX - centRelX;
  const originY  = screenCY - centRelY;

  // Helper: project a world (wx, wz) footprint point to screen (x, y)
  const isoX = (wx: number, wz: number) => originX + (wx - wz) * ISO_COS * _S;
  const isoY = (wx: number, wz: number) => originY + (wx + wz) * ISO_SIN * _S;

  // 4 corners of the outer rhombus (world coords)
  const ptA = { x: isoX(0,   0  ), y: isoY(0,   0  ) };  // top vertex
  const ptB = { x: isoX(_W,  0  ), y: isoY(_W,  0  ) };  // right vertex
  const ptC = { x: isoX(_W,  _D ), y: isoY(_W,  _D ) };  // bottom vertex
  const ptE = { x: isoX(0,   _D ), y: isoY(0,   _D ) };  // left vertex

  const outerPath = `M${ptA.x},${ptA.y} L${ptB.x},${ptB.y} L${ptC.x},${ptC.y} L${ptE.x},${ptE.y} Z`;

  // Inner rhombus (inset by ~10px in world units)
  const insetU = 10 / _S;   // 10 screen-px → world units
  const ptAi   = { x: isoX(insetU,      insetU     ), y: isoY(insetU,      insetU     ) };
  const ptBi   = { x: isoX(_W - insetU, insetU     ), y: isoY(_W - insetU, insetU     ) };
  const ptCi   = { x: isoX(_W - insetU, _D - insetU), y: isoY(_W - insetU, _D - insetU) };
  const ptEi   = { x: isoX(insetU,      _D - insetU), y: isoY(insetU,      _D - insetU) };
  const innerPath = `M${ptAi.x},${ptAi.y} L${ptBi.x},${ptBi.y} L${ptCi.x},${ptCi.y} L${ptEi.x},${ptEi.y} Z`;

  // Diagonals — axis lines of the rhombus (short-axis and long-axis)
  const diagPath  = `M${ptA.x},${ptA.y} L${ptC.x},${ptC.y} M${ptB.x},${ptB.y} L${ptE.x},${ptE.y}`;

  // Crosshair at centroid
  const cx = screenCX;
  const cy = screenCY;

  const outerProps  = useAnimatedProps(() => ({ strokeDashoffset: outerDash.value }));
  const innerProps  = useAnimatedProps(() => ({ strokeDashoffset: innerDash.value }));
  const diagProps   = useAnimatedProps(() => ({ strokeDashoffset: diagDash.value }));
  const cornerProps = useAnimatedProps(() => ({ opacity: cornerOp.value }));

  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));

  // Grid lines
  const gridLines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * width;
    gridLines.push({ x1: x, y1: 0, x2: x, y2: height, key: `c${i}` });
  }
  for (let j = 0; j <= 5; j++) {
    const y = (j / 5) * height;
    gridLines.push({ x1: 0, y1: y, x2: width, y2: y, key: `r${j}` });
  }

  // Corner markers — 12×12 squares at each rhombus vertex
  const corners: [number, number][] = [
    [ptA.x - 6, ptA.y - 6],
    [ptB.x - 6, ptB.y - 6],
    [ptC.x - 6, ptC.y - 6],
    [ptE.x - 6, ptE.y - 6],
  ];

  return (
    <Animated.View
      style={[{ position: 'absolute', width, height }, rootStyle]}
      pointerEvents="none"
    >
      <Svg width={width} height={height}>
        {/* Background grid */}
        {gridLines.map((l) => (
          <Line
            key={l.key}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={GRID_COLOR}
            strokeWidth={0.5}
          />
        ))}

        {/* Outer footprint rectangle */}
        <AnimatedPath
          d={outerPath}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE_WIDTH * 1.5}
          strokeDasharray={perimeterLen}
          fill="rgba(0,212,255,0.04)"
          animatedProps={outerProps}
        />

        {/* Inner rectangle */}
        <AnimatedPath
          d={innerPath}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={perimeterLen * 0.8}
          fill="none"
          animatedProps={innerProps}
        />

        {/* Diagonal guides */}
        <AnimatedPath
          d={diagPath}
          stroke={`${STROKE_COLOR}66`}
          strokeWidth={0.8}
          strokeDasharray={perimeterLen * 0.6}
          fill="none"
          animatedProps={diagProps}
        />

        {/* Corner markers — fade in after outlines */}
        <AnimatedG animatedProps={cornerProps}>
          {corners.map(([x, y], idx) => (
            <Rect
              key={idx}
              x={x} y={y}
              width={12} height={12}
              stroke={STROKE_COLOR}
              strokeWidth={1.5}
              fill="none"
            />
          ))}
        </AnimatedG>

        {/* Centre crosshair */}
        <Line x1={cx - 10} y1={cy}      x2={cx + 10} y2={cy}      stroke={`${STROKE_COLOR}88`} strokeWidth={1} />
        <Line x1={cx}      y1={cy - 10} x2={cx}      y2={cy + 10} stroke={`${STROKE_COLOR}88`} strokeWidth={1} />
      </Svg>
    </Animated.View>
  );
};

export default BlueprintOverlay;
