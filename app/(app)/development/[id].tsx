import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useDialog } from '../../../src/lib/dialog';
import { useDevelopments } from '../../../src/hooks/useUnits';
import { DevelopmentType } from '../../../src/types';
import ScreenLoader from '../../../src/components/ScreenLoader';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';
const FORM_TEXT = '#ffffff';
const INPUT_BORDER = 'rgba(255,255,255,0.55)';
const PLACEHOLDER = '#b8c1df';

const TYPE_OPTIONS: DevelopmentType[] = ['fraccionamiento', 'condominio'];

export default function EditDevelopmentScreen() {
  const { id, name: paramName } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const dialog = useDialog();
  const {
    developments,
    loading: developmentsLoading,
    error: developmentsError,
    updateDevelopment,
    deleteDevelopment,
  } = useDevelopments();
  const [saving, setSaving] = useState(false);

  const development = useMemo(
    () => developments.find((d) => d.id === id),
    [developments, id]
  );

  const [form, setForm] = useState({
    name: '',
    type: 'fraccionamiento' as DevelopmentType,
    description: '',
    address: '',
    city: '',
    state: '',
    country: 'US',
  });

  useEffect(() => {
    if (!development) return;
    setForm({
      name: development.name ?? '',
      type: development.type ?? 'fraccionamiento',
      description: development.description ?? '',
      address: development.address ?? '',
      city: development.city ?? '',
      state: development.state ?? '',
      country: development.country ?? 'US',
    });
  }, [development]);

  const setField = (key: keyof typeof form, value: string | DevelopmentType) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!development) return;
    if (!form.name.trim()) {
      await dialog.alert({ title: 'Error', message: 'Name is required.' });
      return;
    }

    setSaving(true);
    const ok = await updateDevelopment(development.id, {
      name: form.name.trim(),
      type: form.type,
      description: form.description.trim() ? form.description.trim() : null,
      address: form.address.trim() ? form.address.trim() : null,
      city: form.city.trim() ? form.city.trim() : null,
      state: form.state.trim() ? form.state.trim() : null,
      country: form.country.trim() ? form.country.trim() : 'US',
    });
    setSaving(false);

    if (!ok) {
      await dialog.alert({ title: 'Error', message: 'Could not update development.' });
      return;
    }
    router.back();
  };

  const handleDelete = async () => {
    if (!development) return;
    const ok = await dialog.confirm({
      title: 'Delete Development',
      message: `Delete "${development.name}"? Units remain unassigned.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const deleted = await deleteDevelopment(development.id);
    if (deleted) router.replace('/(app)');
  };

  if (developmentsLoading && !development) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (!development) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFoundTitle}>Development not found</Text>
        <Text style={styles.notFoundText}>
          {developmentsError ?? 'This development may have been deleted.'}
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(app)')}>
          <Text style={styles.backBtnText}>BACK TO HOME</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: development?.name ?? paramName ?? 'Development',
          headerRight: () => (
            <TouchableOpacity onPress={handleDelete} style={{ marginRight: 4 }}>
              <Text style={{ color: '#ff4444', fontFamily: 'monospace', fontSize: 11 }}>DELETE</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>BASIC INFORMATION</Text>

        <TextInput
          style={styles.input}
          placeholder="Development name *"
          placeholderTextColor={PLACEHOLDER}
          value={form.name}
          onChangeText={(v) => setField('name', v)}
        />
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Description"
          placeholderTextColor={PLACEHOLDER}
          multiline
          numberOfLines={3}
          value={form.description}
          onChangeText={(v) => setField('description', v)}
        />

        <Text style={styles.sectionLabel}>TYPE</Text>
        <View style={styles.typeRow}>
          {TYPE_OPTIONS.map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.typeBtn, form.type === type && styles.typeBtnActive]}
              onPress={() => setField('type', type)}
            >
              <Text style={[styles.typeBtnText, form.type === type && styles.typeBtnTextActive]}>
                {type.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>LOCATION</Text>
        <TextInput
          style={styles.input}
          placeholder="Street address"
          placeholderTextColor={PLACEHOLDER}
          value={form.address}
          onChangeText={(v) => setField('address', v)}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="City"
            placeholderTextColor={PLACEHOLDER}
            value={form.city}
            onChangeText={(v) => setField('city', v)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="State"
            placeholderTextColor={PLACEHOLDER}
            value={form.state}
            onChangeText={(v) => setField('state', v)}
          />
        </View>
        <TextInput
          style={styles.input}
          placeholder="Country"
          placeholderTextColor={PLACEHOLDER}
          value={form.country}
          onChangeText={(v) => setField('country', v)}
        />

        <TouchableOpacity style={[styles.btn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={BG} /> : <Text style={styles.btnText}>SAVE CHANGES</Text>}
        </TouchableOpacity>
      </ScrollView>

      <ScreenLoader ready={!!development} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG, padding: 24 },
  notFoundTitle: { color: '#eeeeff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  notFoundText: { color: '#555577', fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
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
    letterSpacing: 1.4,
    fontFamily: 'monospace',
  },
  sectionLabel: {
    color: FORM_TEXT,
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: FORM_TEXT,
    fontSize: 14,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top', paddingTop: 12 },
  row: { flexDirection: 'row' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: CARD_BG,
  },
  typeBtnActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.12)',
  },
  typeBtnText: {
    color: FORM_TEXT,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  typeBtnTextActive: { color: ACCENT },
  btn: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: BG, fontWeight: '800', fontSize: 14, letterSpacing: 2.2 },
});
