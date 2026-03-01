import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';
import { useUnitModel, useUnits } from '../../../src/hooks/useUnits';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function UnitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { units, loading: unitsLoading, error: unitsError, deleteUnit } = useUnits();
  const { model, loading: modelLoading } = useUnitModel(id);

  const unit = units.find((u) => u.id === id);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Unit', `Delete "${unit?.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteUnit(id);
          router.replace('/(app)');
        },
      },
    ]);
  }, [deleteUnit, id, unit?.name, router]);

  if (unitsLoading && !unit) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (!unit) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFoundTitle}>Unit not found</Text>
        <Text style={styles.notFoundText}>
          {unitsError ?? 'This unit may have been deleted or you do not have access.'}
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(app)')}>
          <Text style={styles.backBtnText}>BACK TO LIST</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasCoords = unit.latitude != null && unit.longitude != null;
  const statusColor =
    unit.status === 'available' ? '#00ff88' : unit.status === 'reserved' ? '#ffe044' : '#ff4444';

  return (
    <>
      <Stack.Screen
        options={{
          title: unit.name,
          headerRight: () => (
            <TouchableOpacity onPress={handleDelete} style={{ marginRight: 4 }}>
              <Text style={{ color: '#ff4444', fontFamily: 'monospace', fontSize: 11 }}>DELETE</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <View style={[styles.statusBanner, { borderLeftColor: statusColor }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {unit.status.toUpperCase()}
          </Text>
          {unit.price ? (
            <Text style={styles.priceText}>${unit.price.toLocaleString()}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>UNIT DETAILS</Text>
          <InfoRow label="Name" value={unit.name} />
          <InfoRow label="Unit Type" value={unit.unit_type?.toUpperCase()} />
          <InfoRow label="Area" value={unit.area_sqm ? `${unit.area_sqm.toLocaleString()} m2` : null} />
          <InfoRow label="Address" value={unit.address} />
          <InfoRow label="City" value={unit.city} />
          <InfoRow label="State" value={unit.state} />
          <InfoRow label="Country" value={unit.country} />
          <InfoRow label="GLB Model URL" value={unit.model_glb_url} />
          {unit.description ? (
            <View style={styles.descBox}>
              <Text style={styles.infoLabel}>Description</Text>
              <Text style={styles.descText}>{unit.description}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>AR BUILDING MODEL</Text>
          {modelLoading ? (
            <ActivityIndicator color={ACCENT} style={{ marginVertical: 16 }} />
          ) : model ? (
            <>
              <InfoRow label="Floors" value={model.floor_count} />
              <InfoRow label="Type" value={model.building_type} />
              <InfoRow label="Scale" value={model.scale} />
              <InfoRow label="Rotation" value={`${model.rotation_deg}deg`} />
              <InfoRow label="Footprint" value={`${model.footprint_w} x ${model.footprint_h} u`} />
            </>
          ) : (
            <Text style={styles.noModel}>No AR model configured yet. Launch the camera to create one.</Text>
          )}
        </View>

        {hasCoords && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>LOCATION</Text>
            <MapView
              style={styles.map}
              mapType="satellite"
              initialRegion={{
                latitude: unit.latitude!,
                longitude: unit.longitude!,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
              }}
            >
              <Marker
                coordinate={{ latitude: unit.latitude!, longitude: unit.longitude! }}
                title={unit.name}
                pinColor={ACCENT}
              />
            </MapView>
          </View>
        )}

        <TouchableOpacity
          style={styles.arBtn}
          onPress={() => router.push(`/(app)/camera/${id}`)}
        >
          <Text style={styles.arBtnText}>LAUNCH AR PREVIEW</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG },
  notFoundTitle: { color: '#eeeeff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  notFoundText: {
    color: '#555577',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 24,
    lineHeight: 18,
  },
  backBtn: {
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtnText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: 'monospace',
  },
  statusBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderLeftWidth: 3,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusText: { fontSize: 11, fontFamily: 'monospace', letterSpacing: 2, fontWeight: '700' },
  priceText: { color: '#00ff88', fontSize: 18, fontWeight: '800' },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  sectionLabel: {
    color: '#444466',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 12,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  infoLabel: { color: '#555577', fontSize: 12, fontFamily: 'monospace' },
  infoValue: { color: '#eeeeff', fontSize: 13, fontWeight: '600', maxWidth: '65%', textAlign: 'right' },
  descBox: { marginTop: 8 },
  descText: { color: '#888899', fontSize: 13, lineHeight: 18, marginTop: 4 },
  noModel: { color: '#444466', fontSize: 12, fontFamily: 'monospace', lineHeight: 18 },
  map: { height: 200, borderRadius: 8, overflow: 'hidden', marginTop: 4 },
  arBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  arBtnText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    fontFamily: 'monospace',
  },
});
