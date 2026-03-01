import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter, Stack } from 'expo-router';
import { useDevelopments, useUnits } from '../../../src/hooks/useUnits';
import { UnitInsert, UnitStatus, UnitType } from '../../../src/types';
import { supabase } from '../../../src/lib/supabase';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';
const FORM_TEXT = '#ffffff';
const INPUT_BORDER = 'rgba(255,255,255,0.55)';
const PLACEHOLDER = '#b8c1df';

const STATUS_OPTIONS: UnitStatus[] = ['available', 'reserved', 'sold'];
const UNIT_TYPE_OPTIONS: UnitType[] = ['land', 'house', 'building', 'commercial'];
const STATUS_COLORS: Record<UnitStatus, string> = {
  available: '#00ff88',
  reserved: '#ffe044',
  sold: '#ff4444',
};

export default function CreateUnitScreen() {
  const router = useRouter();
  const { createUnit } = useUnits();
  const { developments, loading: developmentsLoading } = useDevelopments();
  const [loading, setLoading] = useState(false);
  const [uploadingModel, setUploadingModel] = useState(false);
  const [devPickerVisible, setDevPickerVisible] = useState(false);

  const [form, setForm] = useState<Partial<UnitInsert>>({
    name: '',
    description: '',
    address: '',
    city: '',
    state: '',
    country: 'US',
    status: 'available',
    unit_type: 'land',
    model_glb_url: '',
    development_id: null,
    area_sqm: undefined,
    price: undefined,
    latitude: undefined,
    longitude: undefined,
  });

  const setField = (key: keyof UnitInsert, value: string | number | null) =>
    setForm((f) => ({ ...f, [key]: value }));

  const selectedDevelopmentName =
    form.development_id == null
      ? 'WITHOUT DEVELOPMENT'
      : developments.find((d) => d.id === form.development_id)?.name ?? 'SELECT DEVELOPMENT';

  const handlePickAndUploadModel = async () => {
    if (uploadingModel) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['model/gltf-binary', 'application/octet-stream', '.glb'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;

      const file = picked.assets?.[0];
      if (!file?.uri) {
        Alert.alert('Error', 'Could not read selected file.');
        return;
      }

      const fileName = file.name ?? `unit_model_${Date.now()}.glb`;
      if (!fileName.toLowerCase().endsWith('.glb')) {
        Alert.alert('Invalid file', 'Please select a .glb file.');
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please sign in again to upload files.');
        return;
      }

      setUploadingModel(true);
      const res = await fetch(file.uri);
      const blob = await res.blob();

      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const unitTypeFolder = (form.unit_type ?? 'land').toString().toLowerCase();
      const storagePath = `${user.id}/${unitTypeFolder}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('unit-models')
        .upload(storagePath, blob, {
          contentType: 'model/gltf-binary',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data } = supabase.storage.from('unit-models').getPublicUrl(storagePath);
      setField('model_glb_url', data.publicUrl);
      Alert.alert('Uploaded', '3D model uploaded successfully.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown upload error';
      Alert.alert('Upload failed', message);
    } finally {
      setUploadingModel(false);
    }
  };

  const handleSave = async () => {
    if (!form.name?.trim()) {
      Alert.alert('Error', 'Name is required.');
      return;
    }
    setLoading(true);
    const unit = await createUnit({
      name: form.name.trim(),
      description: form.description ?? null,
      address: form.address ?? null,
      city: form.city ?? null,
      state: form.state ?? null,
      country: form.country ?? 'US',
      status: form.status ?? 'available',
      unit_type: form.unit_type ?? 'land',
      model_glb_url: form.model_glb_url?.trim() ? form.model_glb_url.trim() : null,
      area_sqm: form.area_sqm ?? null,
      price: form.price ?? null,
      latitude: form.latitude ?? null,
      longitude: form.longitude ?? null,
      development_id: form.development_id ?? null,
      thumbnail_url: null,
    });
    setLoading(false);
    if (unit) {
      router.replace({ pathname: '/(app)/unit/[id]', params: { id: unit.id } });
    } else {
      Alert.alert('Error', 'Could not save unit. Check your connection.');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Add Unit' }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
      >
        <Text style={styles.sectionLabel}>BASIC INFORMATION</Text>

        <TextInput
          style={styles.input}
          placeholder="Unit name *"
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
          value={form.description ?? ''}
          onChangeText={(v) => setField('description', v)}
        />

        <Text style={styles.sectionLabel}>LOCATION</Text>
        <TextInput
          style={styles.input}
          placeholder="Street address"
          placeholderTextColor={PLACEHOLDER}
          value={form.address ?? ''}
          onChangeText={(v) => setField('address', v)}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 2, marginRight: 8 }]}
            placeholder="City"
            placeholderTextColor={PLACEHOLDER}
            value={form.city ?? ''}
            onChangeText={(v) => setField('city', v)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="State"
            placeholderTextColor={PLACEHOLDER}
            autoCapitalize="characters"
            value={form.state ?? ''}
            onChangeText={(v) => setField('state', v)}
          />
        </View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="Latitude"
            placeholderTextColor={PLACEHOLDER}
            keyboardType="numeric"
            value={form.latitude?.toString() ?? ''}
            onChangeText={(v) => setField('latitude', v ? parseFloat(v) : null)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Longitude"
            placeholderTextColor={PLACEHOLDER}
            keyboardType="numeric"
            value={form.longitude?.toString() ?? ''}
            onChangeText={(v) => setField('longitude', v ? parseFloat(v) : null)}
          />
        </View>

        <Text style={styles.sectionLabel}>DETAILS</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="Area (m2)"
            placeholderTextColor={PLACEHOLDER}
            keyboardType="numeric"
            value={form.area_sqm?.toString() ?? ''}
            onChangeText={(v) => setField('area_sqm', v ? parseFloat(v) : null)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Price ($)"
            placeholderTextColor={PLACEHOLDER}
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

        <Text style={styles.sectionLabel}>UNIT TYPE</Text>
        <View style={styles.statusRow}>
          {UNIT_TYPE_OPTIONS.map((type) => (
            <TouchableOpacity
              key={type}
              style={[
                styles.statusBtn,
                form.unit_type === type && { borderColor: ACCENT, backgroundColor: `${ACCENT}11` },
              ]}
              onPress={() => setField('unit_type', type)}
            >
              <Text style={[styles.statusBtnText, form.unit_type === type && { color: ACCENT }]}>
                {type.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={styles.manageTypesBtn}
          onPress={() => router.push('/(app)/unit/type-models')}
        >
          <Text style={styles.manageTypesBtnText}>MANAGE TYPE MODELS</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>3D MODEL FILE (OPTIONAL)</Text>
        <TouchableOpacity
          style={[styles.uploadBtn, uploadingModel && styles.btnDisabled]}
          onPress={handlePickAndUploadModel}
          disabled={uploadingModel}
        >
          {uploadingModel ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <Text style={styles.uploadBtnText}>
              {form.model_glb_url ? 'REPLACE .GLB FILE' : 'UPLOAD .GLB FILE'}
            </Text>
          )}
        </TouchableOpacity>
        {form.model_glb_url ? (
          <View style={styles.uploadMetaRow}>
            <Text style={styles.uploadMetaText} numberOfLines={1}>
              {form.model_glb_url}
            </Text>
            <TouchableOpacity onPress={() => setField('model_glb_url', null)}>
              <Text style={styles.clearUploadText}>REMOVE</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>DEVELOPMENT (OPTIONAL)</Text>
        {developmentsLoading ? (
          <ActivityIndicator color={ACCENT} style={{ marginVertical: 8 }} />
        ) : (
          <>
            <TouchableOpacity style={styles.selectInput} onPress={() => setDevPickerVisible(true)} activeOpacity={0.8}>
              <Text
                style={[
                  styles.selectInputText,
                  form.development_id == null && styles.selectInputPlaceholder,
                ]}
                numberOfLines={1}
              >
                {selectedDevelopmentName}
              </Text>
              <Text style={styles.selectChevron}>?</Text>
            </TouchableOpacity>

            <Modal
              visible={devPickerVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setDevPickerVisible(false)}
            >
              <View style={styles.modalBackdrop}>
                <TouchableOpacity
                  style={styles.modalDismissLayer}
                  onPress={() => setDevPickerVisible(false)}
                  activeOpacity={1}
                />

                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>SELECT DEVELOPMENT</Text>
                  <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent}>
                    <TouchableOpacity
                      style={[styles.modalOption, form.development_id == null && styles.modalOptionActive]}
                      onPress={() => {
                        setField('development_id', null);
                        setDevPickerVisible(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalOptionText,
                          form.development_id == null && styles.modalOptionTextActive,
                        ]}
                      >
                        WITHOUT DEVELOPMENT
                      </Text>
                    </TouchableOpacity>

                    {developments.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.modalOption, form.development_id === d.id && styles.modalOptionActive]}
                        onPress={() => {
                          setField('development_id', d.id);
                          setDevPickerVisible(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.modalOptionText,
                            form.development_id === d.id && styles.modalOptionTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {d.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <TouchableOpacity
                    style={styles.modalCloseBtn}
                    onPress={() => setDevPickerVisible(false)}
                  >
                    <Text style={styles.modalCloseBtnText}>CLOSE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          </>
        )}

        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={BG} /> : <Text style={styles.btnText}>SAVE UNIT</Text>}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingBottom: 40 },
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
    marginBottom: 10,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top', paddingTop: 12 },
  row: { flexDirection: 'row', marginBottom: 10 },
  statusRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statusBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: CARD_BG,
  },
  statusBtnText: { color: FORM_TEXT, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 },
  manageTypesBtn: {
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_BG,
    marginBottom: 10,
  },
  manageTypesBtnText: {
    color: ACCENT,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1.4,
  },
  selectInput: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  selectInputText: {
    flex: 1,
    color: FORM_TEXT,
    fontSize: 14,
  },
  selectInputPlaceholder: {
    color: PLACEHOLDER,
  },
  selectChevron: {
    color: ACCENT,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    justifyContent: 'center',
    padding: 18,
  },
  modalDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 10,
    padding: 14,
    maxHeight: '70%',
  },
  modalTitle: {
    color: FORM_TEXT,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 10,
  },
  modalList: {
    maxHeight: 280,
  },
  modalListContent: {
    gap: 8,
  },
  modalOption: {
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 6,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: CARD_BG,
  },
  modalOptionActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,212,255,0.12)',
  },
  modalOptionText: {
    color: FORM_TEXT,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  modalOptionTextActive: {
    color: ACCENT,
  },
  modalCloseBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: BG,
  },
  modalCloseBtnText: {
    color: FORM_TEXT,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1.2,
  },
  uploadBtn: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  uploadBtnText: {
    color: FORM_TEXT,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.2,
  },
  uploadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  uploadMetaText: {
    flex: 1,
    color: PLACEHOLDER,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  clearUploadText: {
    color: '#ff6666',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
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
