/**
 * src/lib/motion.ts
 *
 * Centralised motion tokens for the Premium Motion System.
 * Import from here — never hardcode durations or spring configs inline.
 *
 * Rules:
 *  - No React imports here (pure constants + worklet-safe helpers).
 *  - All spring/timing configs are Reanimated 3 compatible.
 *  - Do NOT import from Three.js or GLView files.
 */

import {
  withSpring,
  withTiming,
  Easing,
  WithSpringConfig,
  WithTimingConfig,
} from 'react-native-reanimated';

// ── Durations ─────────────────────────────────────────────────────────────────

export const Durations = {
  /** Micro-interactions: ripple, icon swap  */
  fast:   150,
  /** Standard UI transitions: underline, opacity, colour */
  normal: 280,
  /** Entrance animations: dialog slide-up, screen fade */
  slow:   420,
} as const;

// ── Easing ────────────────────────────────────────────────────────────────────

export const Easings = {
  /** Material-style standard curve — accelerate out, decelerate in */
  standard: Easing.bezier(0.4, 0.0, 0.2, 1),
  /** Decelerate only — for elements entering the screen */
  decelerate: Easing.bezier(0.0, 0.0, 0.2, 1),
  /** Accelerate only — for elements leaving the screen */
  accelerate: Easing.bezier(0.4, 0.0, 1, 1),
} as const;

// ── Spring configs ────────────────────────────────────────────────────────────

/** Tight, snappy — for press feedback (scale 1 → 0.96 → 1) */
export const pressSpring: WithSpringConfig = {
  mass:            1,
  damping:         26,
  stiffness:       400,
  overshootClamping: false,
};

/** Airy, bouncy — for pop-in elements (check icon, dialog card) */
export const popSpring: WithSpringConfig = {
  mass:            0.8,
  damping:         14,
  stiffness:       220,
  overshootClamping: false,
};

/** Smooth, no overshoot — for focus underline expand */
export const smoothSpring: WithSpringConfig = {
  mass:            1,
  damping:         28,
  stiffness:       320,
  overshootClamping: true,
};

// ── Timing presets ────────────────────────────────────────────────────────────

export const fastTiming: WithTimingConfig = {
  duration: Durations.fast,
  easing:   Easings.standard,
};

export const normalTiming: WithTimingConfig = {
  duration: Durations.normal,
  easing:   Easings.standard,
};

export const slowTiming: WithTimingConfig = {
  duration: Durations.slow,
  easing:   Easings.decelerate,
};

// ── Worklet helpers ───────────────────────────────────────────────────────────
// These are inlined helpers so they can be called from useAnimatedStyle worklets.

/** Spring to value using pressSpring */
export function springPress(toValue: number) {
  'worklet';
  return withSpring(toValue, pressSpring);
}

/** Spring to value using popSpring */
export function springPop(toValue: number) {
  'worklet';
  return withSpring(toValue, popSpring);
}

/** Timing to value using normalTiming */
export function timingNormal(toValue: number) {
  'worklet';
  return withTiming(toValue, normalTiming);
}

/** Timing to value using fastTiming */
export function timingFast(toValue: number) {
  'worklet';
  return withTiming(toValue, fastTiming);
}
