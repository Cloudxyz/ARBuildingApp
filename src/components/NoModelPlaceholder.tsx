import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { UnitType } from '../types';

interface NoModelPlaceholderProps {
  visible: boolean;
  /** The unit type whose model is missing — shown in the message */
  unitType: UnitType;
}

/**
 * Overlay shown in the 3D preview layer when no GLB model is configured
 * for the active unit type.  Instructs the user to open Edit Unit.
 */
export const NoModelPlaceholder: React.FC<NoModelPlaceholderProps> = ({
  visible,
  unitType,
}) => {
  if (!visible) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.icon}>⬡</Text>
      <Text style={styles.title}>NO MODEL SET</Text>
      <Text style={styles.type}>{unitType.toUpperCase()}</Text>
      <Text style={styles.hint}>
        {'Open Edit Unit and upload\na .GLB file for this type.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,5,16,0.82)',
    gap: 6,
  },
  icon: {
    fontSize: 32,
    color: 'rgba(255,255,255,0.2)',
    marginBottom: 4,
  },
  title: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 3,
    fontWeight: '700',
  },
  type: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
  },
  hint: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1,
    textAlign: 'center',
    lineHeight: 16,
  },
});
