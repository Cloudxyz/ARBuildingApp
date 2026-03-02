import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDevelopments, useUnits } from '../../src/hooks/useUnits';
import { useAuth } from '../../src/hooks/useAuth';
import { Development, Unit } from '../../src/types';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';
const ANDROID_BOTTOM_SAFE_GUARD = 24;

type HomeTab = 'developments' | 'units';

function UnitCard({ unit, onPress, onDelete }: { unit: Unit; onPress: () => void; onDelete: () => void }) {
  const statusColor =
    unit.status === 'available' ? '#00ff88' : unit.status === 'reserved' ? '#ffe044' : '#ff4444';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName} numberOfLines={1}>{unit.name}</Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      {unit.address || unit.city ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          {[unit.address, unit.city, unit.state].filter(Boolean).join(', ')}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.cardMeta}>
          {unit.area_sqm ? (
            <Text style={styles.cardMetaText}>{unit.area_sqm.toLocaleString()} m2</Text>
          ) : null}
          <Text style={[styles.statusLabel, { color: statusColor }]}>
            {unit.status.toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardActions}>
          {unit.price ? (
            <Text style={styles.price}>${(unit.price / 1000).toFixed(0)}K</Text>
          ) : null}
          <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}>
            <Text style={styles.deleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.arBadge}>
        <Text style={styles.arBadgeText}>TAP - AR VIEW</Text>
      </View>
    </TouchableOpacity>
  );
}

function DevelopmentCard({
  development,
  unitCount,
  onPress,
  onDelete,
}: {
  development: Development;
  unitCount: number;
  onPress: () => void;
  onDelete: () => void;
}) {
  const typeColor = development.type === 'fraccionamiento' ? '#00ff88' : '#ffe044';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName} numberOfLines={1}>{development.name}</Text>
        <View style={[styles.statusDot, { backgroundColor: typeColor }]} />
      </View>

      {development.address || development.city ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          {[development.address, development.city, development.state].filter(Boolean).join(', ')}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.cardMeta}>
          <Text style={[styles.statusLabel, { color: typeColor }]}>
            {development.type.toUpperCase()}
          </Text>
          <Text style={styles.cardMetaText}>{unitCount} UNITS</Text>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}>
            <Text style={styles.deleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HomeTab>('developments');
  const {
    units,
    loading: unitsLoading,
    error: unitsError,
    fetchUnits,
    deleteUnit,
  } = useUnits();
  const {
    developments,
    loading: developmentsLoading,
    error: developmentsError,
    fetchDevelopments,
    deleteDevelopment,
  } = useDevelopments();
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const safeBottomInset =
    insets.bottom + (Platform.OS === 'android' ? ANDROID_BOTTOM_SAFE_GUARD : 0);

  const currentError = activeTab === 'units' ? unitsError : developmentsError;
  const currentLoading = activeTab === 'units' ? unitsLoading : developmentsLoading;

  const unitCountByDevelopment = useMemo(() => {
    const counter: Record<string, number> = {};
    for (const unit of units) {
      if (!unit.development_id) continue;
      counter[unit.development_id] = (counter[unit.development_id] ?? 0) + 1;
    }
    return counter;
  }, [units]);

  const handleDeleteUnit = useCallback(
    (id: string, name: string) => {
      Alert.alert('Delete Unit', `Delete "${name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteUnit(id),
        },
      ]);
    },
    [deleteUnit]
  );

  const handleDeleteDevelopment = useCallback(
    (id: string, name: string) => {
      Alert.alert('Delete Development', `Delete "${name}"? Units remain unassigned.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteDevelopment(id),
        },
      ]);
    },
    [deleteDevelopment]
  );

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitleWrap}>
              <Image
                source={require('../../assets/icons/portfolio-logo.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Text style={styles.headerTitleText}>3D REAL ESTATE</Text>
            </View>
          ),
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
        <View style={styles.tabsWrap}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'developments' && styles.tabBtnActive]}
            onPress={() => setActiveTab('developments')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'developments' && styles.tabBtnTextActive]}>
              DEVELOPMENTS
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'units' && styles.tabBtnActive]}
            onPress={() => setActiveTab('units')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'units' && styles.tabBtnTextActive]}>
              UNITS
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/(app)/unit/type-models')}
          >
            <Text style={styles.quickActionBtnText}>UNIT TYPE MODELS</Text>
          </TouchableOpacity>
        </View>

        {currentError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{currentError}</Text>
          </View>
        ) : null}

        {activeTab === 'units' ? (
          unitsLoading && units.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator color={ACCENT} size="large" />
            </View>
          ) : (
            <FlatList
              data={units}
              keyExtractor={(u) => u.id}
              contentContainerStyle={[styles.list, { paddingBottom: 90 + safeBottomInset }]}
              refreshControl={(
                <RefreshControl
                  refreshing={currentLoading}
                  onRefresh={fetchUnits}
                  tintColor={ACCENT}
                />
              )}
              ListEmptyComponent={(
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>[]</Text>
                  <Text style={styles.emptyTitle}>No units yet</Text>
                  <Text style={styles.emptySub}>Add your first unit to get started</Text>
                </View>
              )}
              renderItem={({ item }) => (
                <UnitCard
                  unit={item}
                  onPress={() => router.push({ pathname: '/(app)/unit/[id]', params: { id: item.id } })}
                  onDelete={() => handleDeleteUnit(item.id, item.name)}
                />
              )}
            />
          )
        ) : developmentsLoading && developments.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={ACCENT} size="large" />
          </View>
        ) : (
          <FlatList
            data={developments}
            keyExtractor={(d) => d.id}
            contentContainerStyle={[styles.list, { paddingBottom: 90 + safeBottomInset }]}
            refreshControl={(
              <RefreshControl
                refreshing={currentLoading}
                onRefresh={fetchDevelopments}
                tintColor={ACCENT}
              />
            )}
            ListEmptyComponent={(
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>[]</Text>
                <Text style={styles.emptyTitle}>No developments yet</Text>
                <Text style={styles.emptySub}>Create your first fraccionamiento or condominio</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <DevelopmentCard
                development={item}
                unitCount={unitCountByDevelopment[item.id] ?? 0}
                onPress={() => router.push({ pathname: '/(app)/development/[id]', params: { id: item.id } })}
                onDelete={() => handleDeleteDevelopment(item.id, item.name)}
              />
            )}
          />
        )}

        <TouchableOpacity
          style={[styles.devFab, { bottom: 96 + safeBottomInset }]}
          onPress={() => router.push('/(app)/development/create')}
        >
          <Text style={styles.devFabText}>+</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.fab, { bottom: 28 + safeBottomInset }]}
          onPress={() => router.push('/(app)/unit/create')}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLogo: {
    width: 50,
    height: 34,
  },
  headerTitleText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  tabsWrap: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: CARD_BG,
  },
  quickActionsRow: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  quickActionBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    backgroundColor: CARD_BG,
    paddingVertical: 10,
    alignItems: 'center',
  },
  quickActionBtnText: {
    color: ACCENT,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1.4,
    fontWeight: '700',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(0,212,255,0.12)',
  },
  tabBtnText: {
    color: '#66668a',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1.4,
    fontWeight: '700',
  },
  tabBtnTextActive: {
    color: ACCENT,
  },
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
  deleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#ff2f45',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -3 }],
  },
  deleteBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
  },
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
  devFab: {
    position: 'absolute',
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  devFabText: {
    color: ACCENT,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 30,
  },
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
