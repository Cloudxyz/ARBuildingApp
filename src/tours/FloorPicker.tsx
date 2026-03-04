/**
 * src/tours/FloorPicker.tsx
 *
 * Compact floor-select dropdown for the tour bar.
 * Renders a single "FL 3 ▾" button; tapping opens a Modal with a floor list.
 * No native dependencies — works in Expo Go.
 */

import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACCENT = '#00d4ff';
const MONO   = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

export interface FloorPickerProps {
  value: number;
  count: number;
  onChange: (floor: number) => void;
  /** If true, renders a compact single-line style (for overlaid tour bars). */
  compact?: boolean;
}

export function FloorPicker({ value, count, onChange, compact = false }: FloorPickerProps) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const floors = Array.from({ length: count }, (_, i) => i + 1);

  return (
    <>
      <TouchableOpacity
        style={compact ? styles.triggerCompact : styles.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={compact ? styles.triggerTxtCompact : styles.triggerTxt}>
          {`FL ${value}  ▾`}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        {/* Backdrop — tap to close */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Stop propagation so tapping the sheet doesn't close */}
          <Pressable
            style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}
            onPress={() => {}}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>SELECT FLOOR</Text>
            <FlatList
              data={floors}
              keyExtractor={(fl) => String(fl)}
              renderItem={({ item: fl }) => {
                const active = fl === value;
                return (
                  <TouchableOpacity
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => { onChange(fl); setOpen(false); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.optionTxt, active && styles.optionTxtActive]}>
                      {`Floor ${fl}`}
                    </Text>
                    {active && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
              style={styles.list}
              showsVerticalScrollIndicator={false}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── Trigger button ──────────────────────────────────────────────────────────
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.06)',
    minWidth: 72,
  },
  triggerTxt: {
    color: ACCENT,
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '700',
    letterSpacing: 1,
  },

  triggerCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.1)',
  },
  triggerTxtCompact: {
    color: ACCENT,
    fontSize: 10,
    fontFamily: MONO,
    fontWeight: '700',
  },

  // ── Modal ───────────────────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0d0d2b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(0,212,255,0.25)',
    paddingTop: 12,
    maxHeight: 420,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 12,
  },
  sheetTitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontFamily: MONO,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 8,
  },
  list: { maxHeight: 320 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  optionActive: {
    backgroundColor: 'rgba(0,212,255,0.07)',
  },
  optionTxt: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontFamily: MONO,
  },
  optionTxtActive: {
    color: ACCENT,
    fontWeight: '700',
  },
  checkmark: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '700',
  },
});
