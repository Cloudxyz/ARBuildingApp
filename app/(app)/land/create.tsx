import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useLands } from '../../../src/hooks/useLands';
import { LandInsert, LandStatus } from '../../../src/types';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';

const STATUS_OPTIONS: LandStatus[] = ['available', 'reserved', 'sold'];
const STATUS_COLORS: Record<LandStatus, string> = {
  available: '#00ff88',
  reserved: '#ffe044',
  sold: '#ff4444',
};

export default function CreateLandScreen() {
  const router = useRouter();
  const { createLand } = useLands();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<Partial<LandInsert>>({
    name: '',
    description: '',
    address: '',
    city: '',
    state: '',
    country: 'US',
    status: 'available',
    area_sqm: undefined,
    price: undefined,
    latitude: undefined,
    longitude: undefined,
  });

  const setField = (key: keyof LandInsert, value: string | number | null) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.name?.trim()) {
      Alert.alert('Error', 'Name is required.');
      return;
    }
    setLoading(true);
    const land = await createLand({
      name: form.name.trim(),
      description: form.description ?? null,
      address: form.address ?? null,
      city: form.city ?? null,
      state: form.state ?? null,
      country: form.country ?? 'US',
      status: form.status ?? 'available',
      area_sqm: form.area_sqm ?? null,
      price: form.price ?? null,
      latitude: form.latitude ?? null,
      longitude: form.longitude ?? null,
      thumbnail_url: null,
    });
    setLoading(false);
    if (land) {
      router.replace(`/(app)/land/${land.id}`);
    } else {
      Alert.alert('Error', 'Could not save land. Check your connection.');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Add Land' }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>BASIC INFORMATION</Text>

        <TextInput
          style={styles.input}
          placeholder="Land name *"
          placeholderTextColor="#444466"
          value={form.name}
          onChangeText={(v) => setField('name', v)}
        />
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Description"
          placeholderTextColor="#444466"
          multiline
          numberOfLines={3}
          value={form.description ?? ''}
          onChangeText={(v) => setField('description', v)}
        />

        <Text style={styles.sectionLabel}>LOCATION</Text>
        <TextInput
          style={styles.input}
          placeholder="Street address"
          placeholderTextColor="#444466"
          value={form.address ?? ''}
          onChangeText={(v) => setField('address', v)}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 2, marginRight: 8 }]}
            placeholder="City"
            placeholderTextColor="#444466"
            value={form.city ?? ''}
            onChangeText={(v) => setField('city', v)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="State"
            placeholderTextColor="#444466"
            autoCapitalize="characters"
            value={form.state ?? ''}
            onChangeText={(v) => setField('state', v)}
          />
        </View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="Latitude"
            placeholderTextColor="#444466"
            keyboardType="numeric"
            value={form.latitude?.toString() ?? ''}
            onChangeText={(v) => setField('latitude', v ? parseFloat(v) : null)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Longitude"
            placeholderTextColor="#444466"
            keyboardType="numeric"
            value={form.longitude?.toString() ?? ''}
            onChangeText={(v) => setField('longitude', v ? parseFloat(v) : null)}
          />
        </View>

        <Text style={styles.sectionLabel}>DETAILS</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="Area (m²)"
            placeholderTextColor="#444466"
            keyboardType="numeric"
            value={form.area_sqm?.toString() ?? ''}
            onChangeText={(v) => setField('area_sqm', v ? parseFloat(v) : null)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Price ($)"
            placeholderTextColor="#444466"
            keyboardType="numeric"
            value={form.price?.toString() ?? ''}
            onChangeText={(v) => setField('price', v ? parseFloat(v) : null)}
          />
        </View>

        <Text style={styles.sectionLabel}>STATUS</Text>
        <View style={styles.statusRow}>
          {STATUS_OPTIONS.map((s) => (
            <TouchableOpacity
              key={s}
              style={[
                styles.statusBtn,
                form.status === s && { borderColor: STATUS_COLORS[s], backgroundColor: `${STATUS_COLORS[s]}11` },
              ]}
              onPress={() => setField('status', s)}
            >
              <Text style={[styles.statusBtnText, form.status === s && { color: STATUS_COLORS[s] }]}>
                {s.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={BG} /> : <Text style={styles.btnText}>SAVE LAND</Text>}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  sectionLabel: {
    color: '#444466',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#eeeeff',
    fontSize: 14,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top', paddingTop: 12 },
  row: { flexDirection: 'row' },
  statusRow: { flexDirection: 'row', gap: 10 },
  statusBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: CARD_BG,
  },
  statusBtnText: { color: '#444466', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 },
  btn: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: BG, fontWeight: '800', fontSize: 14, letterSpacing: 3 },
});
