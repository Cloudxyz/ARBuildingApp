/**
 * src/components/AppDialog.tsx
 *
 * Themed confirmation/alert dialog that replaces native Alert.alert.
 * Rendered by DialogProvider — do not use directly; call useDialog() instead.
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';

const BG      = '#070714';
const CARD_BG = '#0d0d22';
const BORDER  = '#1a1a3a';
const ACCENT  = '#00d4ff';
const DANGER  = '#ff4444';
const TEXT    = '#eeeeff';
const SUBTEXT = '#b8c1df';

interface AppDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmText: string;
  cancelText?: string;      // omit for alert-only mode (single OK button)
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AppDialog({
  visible,
  title,
  message,
  confirmText,
  cancelText,
  destructive = false,
  onConfirm,
  onCancel,
}: AppDialogProps) {
  const confirmColor = destructive ? DANGER : ACCENT;
  const hasCancel = !!cancelText;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {/* Backdrop — tap to dismiss (treated as cancel) */}
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      {/* Card — centered, not tappable-through */}
      <View style={styles.centeredWrap} pointerEvents="box-none">
        <View style={styles.card}>
          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Message */}
          {!!message && (
            <Text style={styles.message}>{message}</Text>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Buttons */}
          <View style={[styles.btnRow, !hasCancel && styles.btnRowCentered]}>
            {hasCancel && (
              <TouchableOpacity
                style={[styles.btn, styles.btnCancel]}
                onPress={onCancel}
                activeOpacity={0.7}
              >
                <Text style={styles.btnCancelText}>{cancelText}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.btn,
                hasCancel ? styles.btnConfirm : styles.btnConfirmFull,
                { borderColor: confirmColor },
              ]}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnConfirmText, { color: confirmColor }]}>
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  centeredWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    overflow: 'hidden',
  },
  title: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 4,
  },
  message: {
    color: SUBTEXT,
    fontSize: 13.5,
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: 0,
  },
  btnRow: {
    flexDirection: 'row',
  },
  btnRowCentered: {
    justifyContent: 'center',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: {
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  btnCancelText: {
    color: SUBTEXT,
    fontSize: 14,
    fontWeight: '600',
  },
  btnConfirm: {},
  btnConfirmFull: {
    flex: 0,
    paddingHorizontal: 40,
  },
  btnConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
