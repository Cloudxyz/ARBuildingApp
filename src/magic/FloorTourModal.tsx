/**
 * src/magic/FloorTourModal.tsx
 * Backwards-compatibility re-export — implementation lives in src/tours/TourModal.tsx
 */
export { TourModal as FloorTourModal } from '../tours/TourModal';
export type { TourModalProps as FloorTourModalProps } from '../tours/TourModal';

// ── below this line is unused legacy code kept for reference only ──────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewErrorEvent, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';

interface _LegacyProps {
  visible: boolean;
  url: string;
  title: string;
  onClose: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _legacyFloorTourModal({ visible, url, title, onClose }: _LegacyProps) {
  const insets = useSafeAreaInsets();
  const [loading,  setLoading]  = useState(true);
  const [blocked,  setBlocked]  = useState(false);

  const reset = () => { setLoading(true); setBlocked(false); };

  const handleLoad  = () => setLoading(false);
  const handleError = (_e: WebViewErrorEvent) => { setLoading(false); setBlocked(true); };
  const handleHttpError = (e: WebViewHttpErrorEvent) => {
    setLoading(false);
    // 403/0 typically means the host forbids embedding
    if (e.nativeEvent.statusCode === 403 || e.nativeEvent.statusCode === 0) {
      setBlocked(true);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Header — padded below status bar / notch using safe-area insets */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeTxt}>✕</Text>
          </TouchableOpacity>
        </View>

        {blocked ? (
          /* Embedding blocked — offer browser fallback */
          <View style={styles.blocked}>
            <Text style={styles.blockedIcon}>🔒</Text>
            <Text style={styles.blockedTitle}>Tour cannot be embedded</Text>
            <Text style={styles.blockedSub}>
              This link doesn{"'"}t allow in-app embedding.{'\n'}Open it in your browser instead.
            </Text>
            <TouchableOpacity
              style={styles.openBtn}
              onPress={() => Linking.openURL(url)}
              activeOpacity={0.8}
            >
              <Text style={styles.openBtnTxt}>Open in Browser</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn} activeOpacity={0.8}>
              <Text style={styles.cancelBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* WebView */
          <>
            <WebView
              style={styles.webview}
              source={{ uri: url }}
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
                <Text style={styles.loadingTxt}>Loading tour…</Text>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const ACCENT = '#00d4ff';
const BG = '#070714';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    /* paddingTop is applied inline via useSafeAreaInsets + 8 */
    paddingBottom: 12,
    backgroundColor: '#0a0a2e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,212,255,0.2)',
  },
  title: {
    flex: 1,
    color: ACCENT,
    fontSize: 13,
    fontFamily: MONO,
    letterSpacing: 1.5,
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeTxt: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
  },

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

  blocked: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  blockedIcon:  { fontSize: 40 },
  blockedTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  blockedSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  openBtn: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 13,
  },
  openBtnTxt: {
    color: '#000',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 11,
  },
  cancelBtnTxt: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
});
