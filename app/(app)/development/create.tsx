import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import AnimatedPressable from '../../../src/components/AnimatedPressable';
import AnimatedInput from '../../../src/components/AnimatedInput';
import { useRouter, Stack } from 'expo-router';
import { useDialog } from '../../../src/lib/dialog';
import { useDevelopments } from '../../../src/hooks/useUnits';
import { DevelopmentInsert, DevelopmentType } from '../../../src/types';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';
const FORM_TEXT = '#ffffff';
const INPUT_BORDER = 'rgba(255,255,255,0.55)';
const PLACEHOLDER = '#b8c1df';

const TYPE_OPTIONS: DevelopmentType[] = ['fraccionamiento', 'condominio'];

export default function CreateDevelopmentScreen() {
  const router = useRouter();
  const { createDevelopment } = useDevelopments();
  const dialog = useDialog();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<Partial<DevelopmentInsert>>({
    name: '',
    type: 'fraccionamiento',
    description: '',
    address: '',
    city: '',
    state: '',
    country: 'US',
  });

  const setField = (key: keyof DevelopmentInsert, value: string | null | DevelopmentType) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.name?.trim()) {
      await dialog.alert({ title: 'Error', message: 'Name is required.' });
      return;
    }

    setLoading(true);
    const created = await createDevelopment({
      name: form.name.trim(),
      type: form.type ?? 'fraccionamiento',
      description: form.description?.trim() ? form.description.trim() : null,
      address: form.address?.trim() ? form.address.trim() : null,
      city: form.city?.trim() ? form.city.trim() : null,
      state: form.state?.trim() ? form.state.trim() : null,
      country: form.country?.trim() ? form.country.trim() : 'US',
    });
    setLoading(false);

    if (!created) {
      await dialog.alert({ title: 'Error', message: 'Could not create development.' });
      return;
    }

    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Add Development' }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>BASIC INFORMATION</Text>

        <AnimatedInput
          style={styles.input}
          placeholder="Development name *"
          placeholderTextColor={PLACEHOLDER}
          value={form.name ?? ''}
          onChangeText={(v) => setField('name', v)}
        />
        <AnimatedInput
          style={[styles.input, styles.textarea]}
          placeholder="Description"
          placeholderTextColor={PLACEHOLDER}
          multiline
          numberOfLines={3}
          value={form.description ?? ''}
          onChangeText={(v) => setField('description', v)}
        />

        <Text style={styles.sectionLabel}>TYPE</Text>
        <View style={styles.typeRow}>
          {TYPE_OPTIONS.map((type) => (
            <AnimatedPressable
              key={type}
              style={[styles.typeBtn, form.type === type && styles.typeBtnActive]}
              onPress={() => setField('type', type)}
            >
              <Text style={[styles.typeBtnText, form.type === type && styles.typeBtnTextActive]}>
                {type.toUpperCase()}
              </Text>
            </AnimatedPressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>LOCATION</Text>
        <AnimatedInput
          style={styles.input}
          placeholder="Street address"
          placeholderTextColor={PLACEHOLDER}
          value={form.address ?? ''}
          onChangeText={(v) => setField('address', v)}
        />
        <View style={styles.row}>
          <AnimatedInput
            style={[styles.input, { flex: 2, marginRight: 8 }]}
            placeholder="City"
            placeholderTextColor={PLACEHOLDER}
            value={form.city ?? ''}
            onChangeText={(v) => setField('city', v)}
          />
          <AnimatedInput
            style={[styles.input, { flex: 1 }]}
            placeholder="State"
            placeholderTextColor={PLACEHOLDER}
            autoCapitalize="characters"
            value={form.state ?? ''}
            onChangeText={(v) => setField('state', v)}
          />
        </View>
        <AnimatedInput
          style={styles.input}
          placeholder="Country"
          placeholderTextColor={PLACEHOLDER}
          value={form.country ?? 'US'}
          onChangeText={(v) => setField('country', v)}
        />

        <AnimatedPressable style={styles.btn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={BG} /> : <Text style={styles.btnText}>SAVE DEVELOPMENT</Text>}
        </AnimatedPressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
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

