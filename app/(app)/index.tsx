import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLands } from '../../src/hooks/useLands';
import { useAuth } from '../../src/hooks/useAuth';
import { Land } from '../../src/types';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';

function LandCard({ land, onPress, onDelete }: { land: Land; onPress: () => void; onDelete: () => void }) {
  const statusColor =
    land.status === 'available' ? '#00ff88' : land.status === 'reserved' ? '#ffe044' : '#ff4444';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName} numberOfLines={1}>{land.name}</Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      {land.address || land.city ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          {[land.address, land.city, land.state].filter(Boolean).join(', ')}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.cardMeta}>
          {land.area_sqm ? (
            <Text style={styles.cardMetaText}>{land.area_sqm.toLocaleString()} m²</Text>
          ) : null}
          <Text style={[styles.statusLabel, { color: statusColor }]}>
            {land.status.toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardActions}>
          {land.price ? (
            <Text style={styles.price}>${(land.price / 1000).toFixed(0)}K</Text>
          ) : null}
          <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}>
            <Text style={styles.deleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* AR badge */}
      <View style={styles.arBadge}>
        <Text style={styles.arBadgeText}>TAP · AR VIEW</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function LandsScreen() {
  const router = useRouter();
  const { lands, loading, error, fetchLands, deleteLand } = useLands();
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();

  const handleDelete = useCallback(
    (id: string, name: string) => {
      Alert.alert('Delete Land', `Delete "${name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteLand(id),
        },
      ]);
    },
    [deleteLand]
  );

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'My Lands',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 12, marginRight: 4 }}>
              <TouchableOpacity onPress={() => router.push('/(app)/demo')}>
                <Text style={{ color: '#ffe044', fontFamily: 'monospace', fontSize: 11 }}>DEMO</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSignOut}>
                <Text style={{ color: '#ff4444', fontFamily: 'monospace', fontSize: 11 }}>SIGN OUT</Text>
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      <View style={styles.root}>
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading && lands.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={ACCENT} size="large" />
          </View>
        ) : (
          <FlatList
            data={lands}
            keyExtractor={(l) => l.id}
            contentContainerStyle={[styles.list, { paddingBottom: 90 + insets.bottom }]}
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={fetchLands}
                tintColor={ACCENT}
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>⬡</Text>
                <Text style={styles.emptyTitle}>No lands yet</Text>
                <Text style={styles.emptySub}>Add your first terrain to get started</Text>
              </View>
            }
            renderItem={({ item }) => (
              <LandCard
                land={item}
                onPress={() => router.push(`/(app)/land/${item.id}`)}
                onDelete={() => handleDelete(item.id, item.name)}
              />
            )}
          />
        )}

        {/* FAB */}
        <TouchableOpacity style={[styles.fab, { bottom: 28 + insets.bottom }]} onPress={() => router.push('/(app)/land/create')}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  list: { padding: 16, gap: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBanner: {
    backgroundColor: '#330011',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ff4444',
  },
  errorText: { color: '#ff4444', fontSize: 12, fontFamily: 'monospace' },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  cardName: { flex: 1, color: '#eeeeff', fontSize: 16, fontWeight: '700' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardLocation: { color: '#555577', fontSize: 12, marginBottom: 10, fontFamily: 'monospace' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardMeta: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  cardMetaText: { color: ACCENT, fontSize: 12, fontFamily: 'monospace' },
  statusLabel: { fontSize: 9, fontFamily: 'monospace', letterSpacing: 1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  price: { color: '#00ff88', fontWeight: '700', fontSize: 15 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { color: '#333355', fontSize: 14 },
  arBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0,212,255,0.07)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderTopLeftRadius: 6,
  },
  arBadgeText: { color: `${ACCENT}77`, fontSize: 8, fontFamily: 'monospace', letterSpacing: 1.5 },
  empty: { paddingTop: 80, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: 16, opacity: 0.3 },
  emptyTitle: { color: '#eeeeff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySub: { color: '#555577', fontSize: 13 },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  fabText: { color: '#070714', fontSize: 26, fontWeight: '700', lineHeight: 30 },
});
