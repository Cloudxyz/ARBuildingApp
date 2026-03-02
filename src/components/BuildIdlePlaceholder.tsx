/**
 * src/components/BuildIdlePlaceholder.tsx
 *
 * Centered overlay shown before the first Play press.
 * Hides while building and after build is complete.
 * Used by both Demo and Unit views, in both Blueprint and 3D modes.
 *
 * Usage:
 *   <BuildIdlePlaceholder visible={!isPlaying && !isCompleted} />
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

interface BuildIdlePlaceholderProps {
  visible: boolean;
}

export const BuildIdlePlaceholder: React.FC<BuildIdlePlaceholderProps> = ({
  visible,
}) => {
  if (!visible) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.icon}>▶</Text>
      <Text style={styles.text}>{'CLICK PLAY TO\nCONSTRUCT'}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    fontSize: 42,
    color: 'rgba(0,212,255,0.25)',
    lineHeight: 46,
  },
  text: {
    color: 'rgba(0,212,255,0.35)',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: 2,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default BuildIdlePlaceholder;
