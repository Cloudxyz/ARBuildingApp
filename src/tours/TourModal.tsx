/**
 * src/tours/TourModal.tsx
 *
 * Shared full-screen modal WebView for Matterport (or any https) floor tours.
 * Used by: 3D Magic, 3D View, Blueprint.
 *
 * Features:
 *  - In-header floor selector (FL 1..N) — tappable, slides up an overlay list
 *  - Loading indicator while the WebView fetches the page
 *  - Empty state when the selected floor has no tour URL
 *  - Graceful fallback ("Open in Browser") if the host blocks embedding
 *  - Safe-area-aware header (notch / status-bar)
 *  - No nested Modals (avoids Android z-order bugs): picker is an AbsoluteView overlay
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';

export interface TourModalProps {
  visible: boolean;
  onClose: () => void;
  /** Total number of floors available (1 … floorsTotal). */
  floorsTotal: number;
  /** Floor index that should be active when the modal first opens. */
  initialFloorIndex: number;
  /**
   * Pure lookup — return the tour URL for the given floor, or null if none.
   * Use `(fl) => tourCache[fl] ?? null` at the call site.
   */
  getTourUrlForFloor: (floor: number) => string | null;
  /** Called when the user picks a different floor inside the modal (for external sync). */
  onFloorChange?: (floor: number) => void;
}

export function TourModal({
  visible,
  onClose,
  floorsTotal,
  initialFloorIndex,
  getTourUrlForFloor,
  onFloorChange,
}: TourModalProps) {
  const insets = useSafeAreaInsets();

  const [currentFloor, setCurrentFloor] = useState(initialFloorIndex);
  /** Bumped to force a WebView remount when the floor (and thus URL) changes. */
  const [webViewKey, setWebViewKey]     = useState(0);
  const [loading,    setLoading]        = useState(true);
  const [blocked,    setBlocked]        = useState(false);
  const [pickerOpen, setPickerOpen]     = useState(false);

  const currentUrl = getTourUrlForFloor(currentFloor);

  // Reset to the caller’s floor each time the modal is opened
  useEffect(() => {
    if (visible) {
      setCurrentFloor(initialFloorIndex);
      setWebViewKey((k) => k + 1);
      setLoading(true);
      setBlocked(false);
      setPickerOpen(false);
    }
  }, [visible, initialFloorIndex]);

  const selectFloor = useCallback((fl: number) => {
    setPickerOpen(false);
    if (fl === currentFloor) return;
    setCurrentFloor(fl);
    onFloorChange?.(fl);
    setWebViewKey((k) => k + 1);
    setLoading(true);
    setBlocked(false);
  }, [currentFloor, onFloorChange]);

  const reset          = () => { setLoading(true); setBlocked(false); };
  const handleLoad     = () => setLoading(false);
  const handleError    = (_e: WebViewErrorEvent) => { setLoading(false); setBlocked(true); };
  const handleHttpError = (e: WebViewHttpErrorEvent) => {
    setLoading(false);
    if (e.nativeEvent.statusCode === 403 || e.nativeEvent.statusCode === 0) setBlocked(true);
  };

  const floors = Array.from({ length: floorsTotal }, (_, i) => i + 1);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>

        {/* ── Header ─────────────────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          {/* Tappable floor selector in the header */}
          <TouchableOpacity
            style={styles.floorTrigger}
            onPress={() => setPickerOpen((o) => !o)}
            activeOpacity={0.75}
          >
            <Text style={styles.floorTriggerTxt}>{`Floor ${currentFloor}  ▾`}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeTxt}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Body ──────────────────────────────────────────────────────────────── */}
        {!currentUrl ? (
          /* No tour configured for this floor */
          <View style={styles.noTour}>
            <Text style={styles.noTourIcon}>🔍</Text>
            <Text style={styles.noTourTitle}>{`No tour for Floor ${currentFloor}`}</Text>
            <Text style={styles.noTourSub}>Select a different floor above.</Text>
          </View>
        ) : blocked ? (
          /* Host blocks embedding */
          <View style={styles.blocked}>
            <Text style={styles.blockedIcon}>🔒</Text>
            <Text style={styles.blockedTitle}>Tour cannot be embedded</Text>
            <Text style={styles.blockedSub}>
              This link doesn{"'"} allow in-app embedding.{'\n'}Open it in your browser instead.
            </Text>
            <TouchableOpacity style={styles.openBtn} onPress={() => Linking.openURL(currentUrl)} activeOpacity={0.8}>
              <Text style={styles.openBtnTxt}>Open in Browser</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn} activeOpacity={0.8}>
              <Text style={styles.cancelBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* WebView — key changes force remount on floor switch */
          <>
            <WebView
              key={webViewKey}
              style={styles.webview}
              source={{ uri: currentUrl }}
              onLoadStart={reset}
              onLoad={handleLoad}
              onError={handleError}
              onHttpError={handleHttpError}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState={false}
            />
            {loading && (
              <View style={styles.loadingOverlay} pointerEvents="none">
                <ActivityIndicator color="#00d4ff" size="large" />
                <Text style={styles.loadingTxt}>{`Loading Floor ${currentFloor} tour…`}</Text>
              </View>
            )}
          </>
        )}

        {/* ── In-modal floor picker overlay (no nested Modal) ─────────────────── */}
        {pickerOpen && (
          <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
            <Pressable
              style={[styles.pickerSheet, { paddingBottom: insets.bottom + 8 }]}
              onPress={() => { /* swallow tap so backdrop doesn't close */ }}
            >
              <View style={styles.pickerHandle} />
              <Text style={styles.pickerTitle}>SELECT FLOOR</Text>
              <FlatList
                data={floors}
                keyExtractor={(fl) => String(fl)}
                style={styles.pickerList}
                showsVerticalScrollIndicator={false}
                renderItem={({ item: fl }) => {
                  const active  = fl === currentFloor;
                  const hasUrl  = !!getTourUrlForFloor(fl);
                  return (
                    <TouchableOpacity
                      style={[styles.pickerOption, active && styles.pickerOptionActive]}
                      onPress={() => selectFloor(fl)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.pickerOptionTxt, active && styles.pickerOptionTxtActive]}>
                        {`Floor ${fl}`}
                      </Text>
                      <View style={styles.pickerOptionRight}>
                        {!hasUrl && <Text style={styles.noTourBadge}>no tour</Text>}
                        {active  && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            </Pressable>
          </Pressable>
        )}

      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────────────

const MONO  = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const ACCENT = '#00d4ff';
const BG     = '#070714';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── Header ─────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#0a0a2e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,212,255,0.2)',
  },
  floorTrigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  floorTriggerTxt: {
    color: ACCENT,
    fontSize: 13,
    fontFamily: MONO,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  closeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  closeTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 18 },

  // ── WebView ─────────────────────────────────────────────────────
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
    gap: 12,
  },
  loadingTxt: {
    color: 'rgba(0,212,255,0.7)',
    fontSize: 12,
    fontFamily: MONO,
    letterSpacing: 1,
  },

  // ── No tour empty state ────────────────────────────────────────────
  noTour: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  noTourIcon:  { fontSize: 36 },
  noTourTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  noTourSub:   { color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center' },

  // ── Embedding blocked ──────────────────────────────────────────────
  blocked: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  blockedIcon:  { fontSize: 40 },
  blockedTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  blockedSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  openBtn: { backgroundColor: ACCENT, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 13 },
  openBtnTxt: { color: '#000', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
  cancelBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 11,
  },
  cancelBtnTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },

  // ── Floor picker overlay ────────────────────────────────────────────
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  pickerSheet: {
    backgroundColor: '#0d0d2b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(0,212,255,0.25)',
    paddingTop: 12,
    maxHeight: 420,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 12,
  },
  pickerTitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontFamily: MONO,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 8,
  },
  pickerList: { maxHeight: 320 },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  pickerOptionActive:    { backgroundColor: 'rgba(0,212,255,0.07)' },
  pickerOptionTxt:       { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontFamily: MONO },
  pickerOptionTxtActive: { color: ACCENT, fontWeight: '700' },
  pickerOptionRight:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noTourBadge: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontFamily: MONO,
    letterSpacing: 0.5,
  },
  checkmark: { color: ACCENT, fontSize: 14, fontWeight: '700' },
});
