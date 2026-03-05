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
} from 'react-native';
import AnimatedPressable from '../../../src/components/AnimatedPressable';
import AnimatedInput from '../../../src/components/AnimatedInput';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter, Stack } from 'expo-router';
import { useDialog } from '../../../src/lib/dialog';
import { useDevelopments, useUnits } from '../../../src/hooks/useUnits';
import { UnitInsert, UnitStatus, UnitType } from '../../../src/types';
import { resizeFloors } from '../../../src/lib/floors';
import { uploadGlb, api } from '../../../src/lib/api';

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
  const dialog = useDialog();
  const [loading, setLoading] = useState(false);
  const [devPickerVisible, setDevPickerVisible] = useState(false);
const [floors, setFloors] = useState<string[]>(['']);

  // Per-type GLB drafts (keyed by UnitType)
  type TypeModelDraft = { glbUrl: string | null; storagePath: string | null; externalGlbUrl: string };
  const [activeModelType, setActiveModelType] = useState<UnitType>('land');
  const [uploadingModelType, setUploadingModelType] = useState<UnitType | null>(null);
  const [typeModels, setTypeModels] = useState<Record<UnitType, TypeModelDraft>>({
    land:       { glbUrl: null, storagePath: null, externalGlbUrl: '' },
    house:      { glbUrl: null, storagePath: null, externalGlbUrl: '' },
    building:   { glbUrl: null, storagePath: null, externalGlbUrl: '' },
    commercial: { glbUrl: null, storagePath: null, externalGlbUrl: '' },
  });

  const [form, setForm] = useState<Partial<UnitInsert>>({
    name: '',
    description: '',
    address: '',
    city: '',
    state: '',
    country: '',
    status: 'available',
    unit_type: 'land',
    development_id: null,
    area_sqm: undefined,
    price: undefined,
  });

  const setField = (key: keyof UnitInsert, value: string | number | null) =>
    setForm((f) => ({ ...f, [key]: value }));

  const selectedDevelopmentName =
    form.development_id == null
      ? 'WITHOUT DEVELOPMENT'
      : developments.find((d) => d.id === form.development_id)?.name ?? 'SELECT DEVELOPMENT';

  const handlePickAndUploadModelForType = async (type: UnitType) => {
    if (uploadingModelType !== null) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['model/gltf-binary', 'application/octet-stream', '.glb'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;

      const file = picked.assets?.[0];
      if (!file?.uri) { await dialog.alert({ title: 'Error', message: 'Could not read selected file.' }); return; }

      const fileName = file.name ?? `unit_model_${Date.now()}.glb`;
      if (!fileName.toLowerCase().endsWith('.glb')) { await dialog.alert({ title: 'Invalid file', message: 'Please select a .glb file.' }); return; }

      setUploadingModelType(type);
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadName = `${Date.now()}_${safeName}`;

      const publicUrl = await uploadGlb(file.uri, uploadName);
      setTypeModels((prev) => ({
        ...prev,
        [type]: { ...prev[type], glbUrl: publicUrl, storagePath: uploadName },
      }));
      await dialog.alert({ title: 'Uploaded', message: `${type} model uploaded successfully.` });
    } catch (err) {
      await dialog.alert({ title: 'Upload failed', message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setUploadingModelType(null);
    }
  };

  const handleSave = async () => {
    if (!form.name?.trim()) {
      await dialog.alert({ title: 'Error', message: 'Name is required.' });
      return;
    }
    setLoading(true);
    const { unit, error: saveError } = await createUnit({
      name: form.name.trim(),
      description: form.description ?? null,
      address: form.address ?? null,
      city: form.city ?? null,
      state: form.state ?? null,
      country: form.country?.trim() || 'US',
      status: form.status ?? 'available',
      unit_type: form.unit_type ?? 'land',
      area_sqm: form.area_sqm ?? null,
      price: form.price ?? null,
      development_id: form.development_id ?? null,
      thumbnail_url: null,
      floors,
    });
    if (unit) {
      // Persist per-type GLB models now that we have a unit ID
      const glbErrors: string[] = [];
      await Promise.all(
        UNIT_TYPE_OPTIONS.map(async (type) => {
          try {
            const draft = typeModels[type];
            if (!draft?.glbUrl && !draft?.externalGlbUrl?.trim()) return;
            const body: Record<string, unknown> = { unit_type: type };
            if (draft.glbUrl)                    body.glb_url          = draft.glbUrl;
            if (draft.storagePath)               body.storage_path     = draft.storagePath;
            if (draft.externalGlbUrl.trim())     body.external_glb_url = draft.externalGlbUrl.trim();
            await api('POST', `/api/units/${unit.id}/glb-models`, body);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            glbErrors.push(`${type}: ${msg}`);
          }
        }),
      );
      setLoading(false);
      if (glbErrors.length > 0) {
        await dialog.alert({ title: 'Warning — Model Save Failed', message: glbErrors.join('\n\n') });
      }
      router.replace({ pathname: '/(app)/unit/[id]', params: { id: unit.id, name: form.name?.trim() ?? '' } });
    } else {
      setLoading(false);
      await dialog.alert({ title: 'Error', message: saveError ?? 'Could not save unit. Check your connection.' });
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

        <AnimatedInput
          style={styles.input}
          placeholder="Unit name *"
          placeholderTextColor={PLACEHOLDER}
          value={form.name}
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
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="City"
            placeholderTextColor={PLACEHOLDER}
            value={form.city ?? ''}
            onChangeText={(v) => setField('city', v)}
          />
          <AnimatedInput
            style={[styles.input, { flex: 1 }]}
            placeholder="State"
            placeholderTextColor={PLACEHOLDER}
            value={form.state ?? ''}
            onChangeText={(v) => setField('state', v)}
          />
        </View>
        <AnimatedInput
          style={styles.input}
          placeholder="Country (e.g. US, MX)"
          placeholderTextColor={PLACEHOLDER}
          value={form.country ?? ''}
          onChangeText={(v) => setField('country', v)}
        />

        <Text style={styles.sectionLabel}>DETAILS</Text>
        <View style={styles.row}>
          <AnimatedInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="Area (m2)"
            placeholderTextColor={PLACEHOLDER}
            keyboardType="numeric"
            value={form.area_sqm?.toString() ?? ''}
            onChangeText={(v) => setField('area_sqm', v ? parseFloat(v) : null)}
          />
          <AnimatedInput
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
            <AnimatedPressable
              key={s}
              style={[
                styles.statusBtn,
                form.status === s && { borderColor: STATUS_COLORS[s], backgroundColor: `${STATUS_COLORS[s]}11` },
              ]}
              onPress={() => setField('status', s)}
            >
              <Text style={[styles.statusBtnText, form.status === s && { color: STATUS_COLORS[s] }]}>
                {s}
              </Text>
            </AnimatedPressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>UNIT TYPE</Text>
        <View style={styles.statusRow}>
          {UNIT_TYPE_OPTIONS.map((type) => (
            <AnimatedPressable
              key={type}
              style={[
                styles.statusBtn,
                form.unit_type === type && { borderColor: ACCENT, backgroundColor: `${ACCENT}11` },
              ]}
              onPress={() => setField('unit_type', type)}
            >
              <Text style={[styles.statusBtnText, form.unit_type === type && { color: ACCENT }]}>
                {type}
              </Text>
            </AnimatedPressable>
          ))}
        </View>
        <AnimatedPressable
          style={styles.manageTypesBtn}
          onPress={() => router.push('/(app)/unit/type-models')}
        >
          <Text style={styles.manageTypesBtnText}>MANAGE TYPE MODELS</Text>
        </AnimatedPressable>

        <Text style={styles.sectionLabel}>MODELS BY UNIT TYPE</Text>
        <View style={styles.statusRow}>
          {UNIT_TYPE_OPTIONS.map((type) => {
            const hasDraft = !!(typeModels[type].glbUrl || typeModels[type].externalGlbUrl.trim());
            return (
              <AnimatedPressable
                key={type}
                style={[
                  styles.statusBtn,
                  activeModelType === type && { borderColor: ACCENT, backgroundColor: `${ACCENT}11` },
                  hasDraft && activeModelType !== type && { borderColor: '#00ff88' },
                ]}
                onPress={() => setActiveModelType(type)}
              >
                <Text style={[
                  styles.statusBtnText,
                  activeModelType === type && { color: ACCENT },
                  hasDraft && activeModelType !== type && { color: '#00ff88' },
                ]}>
                  {type}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>
        <View style={styles.typeModelPanel}>
          <AnimatedPressable
            style={[styles.uploadBtn, { marginBottom: 0 }]}
            onPress={() => handlePickAndUploadModelForType(activeModelType)}
            disabled={uploadingModelType !== null}
          >
            {uploadingModelType === activeModelType ? (
              <ActivityIndicator color={ACCENT} />
            ) : (
              <Text style={styles.uploadBtnText}>
                {typeModels[activeModelType].glbUrl ? 'REPLACE .GLB FILE' : 'UPLOAD .GLB FILE'}
              </Text>
            )}
          </AnimatedPressable>
          {typeModels[activeModelType].glbUrl ? (
            <View style={[styles.uploadMetaRow, { marginTop: 8, marginBottom: 0 }]}>
              <Text style={styles.uploadMetaText} numberOfLines={1}>
                {typeModels[activeModelType].glbUrl}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  setTypeModels((prev) => ({
                    ...prev,
                    [activeModelType]: { ...prev[activeModelType], glbUrl: null, storagePath: null },
                  }))
                }
              >
                <Text style={styles.clearUploadText}>REMOVE</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <Text style={styles.orLabel}>— OR MANUAL URL (FALLBACK) —</Text>
          <AnimatedInput
            style={[styles.input, { marginBottom: 0 }]}
            placeholder="https://example.com/model.glb"
            placeholderTextColor={PLACEHOLDER}
            value={typeModels[activeModelType].externalGlbUrl}
            onChangeText={(v) =>
              setTypeModels((prev) => ({
                ...prev,
                [activeModelType]: { ...prev[activeModelType], externalGlbUrl: v },
              }))
            }
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <Text style={styles.sectionLabel}>VIRTUAL TOURS (MATTERPORT)</Text>
        <View style={styles.tourPanel}>
          <View style={styles.tourStepperRow}>
            <Text style={styles.tourLabel}>Floors</Text>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setFloors(f => resizeFloors(f, f.length - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepVal}>{floors.length}</Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setFloors(f => resizeFloors(f, f.length + 1))}>
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {floors.map((url, i) => {
            const fi = i + 1;
            const valid = url.startsWith('https://');
            const isMatter = url.includes('matterport');
            const status = url === '' ? 'missing' : valid ? (isMatter ? 'matterport' : 'external') : 'invalid';
            return (
              <View key={fi} style={styles.tourRow}>
                <Text style={styles.tourFloorLabel}>Floor {fi}</Text>
                <TextInput
                  style={styles.tourInput}
                  placeholder="https://my.matterport.com/show/..."
                  placeholderTextColor={PLACEHOLDER}
                  value={url}
                  onChangeText={v => setFloors(prev => { const next = [...prev]; next[i] = v; return next; })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Text style={[
                  styles.tourStatus,
                  status === 'matterport' && { color: '#00ff88' },
                  status === 'external'   && { color: '#ffe044' },
                  status === 'invalid'    && { color: '#ff6666' },
                ]}>
                  {status === 'missing' ? '○ Missing' : status === 'matterport' ? '● Matterport' : status === 'external' ? '● External tour' : '✕ Must start with https://'}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>DEVELOPMENT (OPTIONAL)</Text>
        {developmentsLoading ? (
          <ActivityIndicator color={ACCENT} style={{ marginVertical: 8 }} />
        ) : (
          <>
            <AnimatedPressable style={styles.selectInput} onPress={() => setDevPickerVisible(true)}>
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
            </AnimatedPressable>

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
                          if (!form.country?.trim()) setField('country', d.country ?? 'US');
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

        <AnimatedPressable style={styles.btn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={BG} /> : <Text style={styles.btnText}>SAVE UNIT</Text>}
        </AnimatedPressable>
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
  typeModelPanel: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  orLabel: {
    color: PLACEHOLDER,
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 1,
    textAlign: 'center',
    marginVertical: 4,
  },
  tourPanel: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  tourStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tourLabel: { color: FORM_TEXT, fontSize: 12, fontFamily: 'monospace' },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,212,255,0.12)',
    borderColor: BORDER, borderWidth: 1, borderRadius: 6,
  },
  stepBtnText: { color: ACCENT, fontSize: 18, fontWeight: '700' },
  stepVal: { color: FORM_TEXT, fontSize: 14, fontWeight: '700', minWidth: 32, textAlign: 'center' },
  tourRow: { gap: 4 },
  tourFloorLabel: { color: ACCENT, fontSize: 9, fontFamily: 'monospace', letterSpacing: 1 },
  tourInput: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: FORM_TEXT,
    fontSize: 12,
  },
  tourStatus: {
    color: PLACEHOLDER,
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});
