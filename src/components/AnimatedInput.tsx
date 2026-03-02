/**
 * src/components/AnimatedInput.tsx
 *
 * Animated drop-in replacement for TextInput.
 *
 * Features (Reanimated 3, no extra deps):
 *  - Accent border-color on focus via interpolateColor (animated, not snapped)
 *  - Thin accent underline expands (scaleX 0→1) on focus below the field
 *  - Optional `error` string: slides in (translateY + fade) below the field
 *  - `shakeKey` number: changing it triggers a horizontal shake (submit-on-invalid feedback)
 *  - All TextInputProps forwarded — fully drop-in
 *
 * Usage:
 *   <AnimatedInput
 *     style={styles.input}        ← same style you'd pass to TextInput
 *     placeholder="Email"
 *     value={email}
 *     onChangeText={setEmail}
 *     error={emailError}          ← optional
 *     shakeKey={submitAttempt}    ← optional; increment to shake
 *   />
 *
 * DO NOT use inside GLView / Three.js components.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  interpolateColor,
} from 'react-native-reanimated';
import { smoothSpring, normalTiming, fastTiming } from '../lib/motion';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCENT       = '#00d4ff';
const BORDER_REST  = 'rgba(255,255,255,0.55)';
const BORDER_ERROR = '#ff4444';
const ERROR_COLOR  = '#ff6666';

const SHAKE_DIST   = 7;  // px — horizontal shake amplitude
const UNDERLINE_H  = 2;  // px — focus underline height

// ── Animated TextInput wrapper ────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnimatedInputProps extends Omit<TextInputProps, 'style'> {
  /**
   * Style for the outer container View.
   * Pass the same style you'd give to a bare <TextInput> — all layout
   * and background/border props live here; animated borderColor overrides
   * whatever borderColor is set here.
   */
  style?: StyleProp<ViewStyle>;
  /** Inline error message — fades + slides from below. */
  error?: string | null;
  /**
   * Increment this number to trigger a horizontal shake.
   * Increment on each failed submit attempt.
   */
  shakeKey?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnimatedInput({
  style,
  error,
  shakeKey = 0,
  onFocus,
  onBlur,
  ...textInputProps
}: AnimatedInputProps) {
  const focusVal  = useSharedValue(0);
  const errorVal  = useSharedValue(0);
  const shakeX    = useSharedValue(0);
  const prevShake = useRef(shakeKey);

  // ── Split style into container props vs TextInput text/padding props ────────
  // This allows the caller to pass the same `style` they'd give a bare TextInput.
  const { containerStyle: flatContainer, inputStyle: flatInput } = useMemo(() => {
    const flat = StyleSheet.flatten(style as StyleProp<TextStyle & ViewStyle>) ?? {};
    const {
      // Pure text / font props → inner TextInput only
      color,
      fontSize,
      fontFamily,
      fontWeight,
      fontStyle,
      letterSpacing,
      lineHeight,
      textAlign,
      textAlignVertical,
      // Everything else (including all padding, background, border, layout) → outer container View
      ...rest
    } = flat as Record<string, unknown>;

    const inputStyle = {
      color, fontSize, fontFamily, fontWeight, fontStyle,
      letterSpacing, lineHeight, textAlign, textAlignVertical,
    };
    return { containerStyle: rest as ViewStyle, inputStyle: inputStyle as TextStyle };
  }, [style]);

  // ── Shake on shakeKey change ────────────────────────────────────────────────
  useEffect(() => {
    if (shakeKey !== prevShake.current) {
      prevShake.current = shakeKey;
      shakeX.value = withSequence(
        withTiming( SHAKE_DIST, fastTiming),
        withTiming(-SHAKE_DIST, fastTiming),
        withTiming( SHAKE_DIST, fastTiming),
        withTiming(-SHAKE_DIST, fastTiming),
        withTiming(0,           fastTiming),
      );
    }
  }, [shakeKey, shakeX]);

  // ── Error visibility ────────────────────────────────────────────────────────
  useEffect(() => {
    errorVal.value = error ? withTiming(1, normalTiming) : withTiming(0, fastTiming);
  }, [error, errorVal]);

  // ── Focus / blur ───────────────────────────────────────────────────────────
  const handleFocus = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
      focusVal.value = withSpring(1, smoothSpring);
      onFocus?.(e);
    },
    [focusVal, onFocus],
  );

  const handleBlur = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
      focusVal.value = withSpring(0, smoothSpring);
      onBlur?.(e);
    },
    [focusVal, onBlur],
  );

  // ── Animated styles ────────────────────────────────────────────────────────

  const animContainerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
    borderColor: error
      ? BORDER_ERROR
      : interpolateColor(focusVal.value, [0, 1], [BORDER_REST, ACCENT]),
  }));

  const underlineStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: focusVal.value }],
    opacity:   focusVal.value,
  }));

  const errorStyle = useAnimatedStyle(() => ({
    opacity:   errorVal.value,
    transform: [{ translateY: (1 - errorVal.value) * 6 }],
  }));

  return (
    <View>
      <Animated.View style={[styles.containerBase, flatContainer, animContainerStyle]}>
        <TextInput
          style={[styles.textInputBase, flatInput]}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholderTextColor="rgba(184,193,223,0.8)"
          {...textInputProps}
        />
        <Animated.View style={[styles.underline, underlineStyle]} />
      </Animated.View>

      {!!error && (
        <Animated.Text style={[styles.errorText, errorStyle]}>
          {error}
        </Animated.Text>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  containerBase: {
    // Structural defaults — overridden by the caller's style prop.
    overflow: 'hidden',
    justifyContent: 'center',
  },
  textInputBase: {
    // Text / font defaults — caller's flatInput style merges over these.
    // No flex: 1 here: the container's height comes from its own padding,
    // and the TextInput sizes to its natural (font-derived) height.
    borderWidth: 0,
    color: '#ffffff',
    fontSize: 15,
    alignSelf: 'stretch',
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: UNDERLINE_H,
    backgroundColor: ACCENT,
    borderRadius: 1,
  },
  errorText: {
    color: ERROR_COLOR,
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 4,
    marginLeft: 4,
  },
});
