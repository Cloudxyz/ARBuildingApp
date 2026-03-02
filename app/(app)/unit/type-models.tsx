import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Stack } from 'expo-router';
import { useDialog } from '../../../src/lib/dialog';
import { useUnitTypeModels } from '../../../src/hooks/useUnits';
import { supabase } from '../../../src/lib/supabase';
import { UnitTypeModel } from '../../../src/types';

const ACCENT = '#00d4ff';
const BG = '#070714';
const CARD_BG = '#0d0d22';
const BORDER = '#1a1a3a';
const FORM_TEXT = '#ffffff';
const MUTED = '#9aa4c7';
const DANGER = '#ff6666';
const INPUT_BORDER = 'rgba(255,255,255,0.55)';
const PLACEHOLDER = '#b8c1df';

const TYPE_OPTIONS: UnitTypeModel['unit_type'][] = ['house', 'building', 'commercial'];

type ManualUrlState = Partial<Record<UnitTypeModel['unit_type'], string>>;

export default function UnitTypeModelsScreen() {
  const {
    modelsByType,
    loading,
    error,
    fetchUnitTypeModels,
    upsertUnitTypeModel,
  } = useUnitTypeModels();
  const [busyType, setBusyType] = useState<UnitTypeModel['unit_type'] | null>(null);
  const [manualUrls, setManualUrls] = useState<ManualUrlState>({});
  const dialog = useDialog();

  const getManualUrlValue = (unitType: UnitTypeModel['unit_type']) =>
    manualUrls[unitType] ?? modelsByType[unitType]?.external_model_glb_url ?? '';

  const setManualUrlValue = (unitType: UnitTypeModel['unit_type'], value: string) => {
    setManualUrls((prev) => ({ ...prev, [unitType]: value }));
  };

  const handlePickAndUpload = async (unitType: UnitTypeModel['unit_type']) => {
    if (busyType) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['model/gltf-binary', 'application/octet-stream', '.glb'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;

      const file = picked.assets?.[0];
      if (!file?.uri) {
        await dialog.alert({ title: 'Error', message: 'Could not read selected file.' });
        return;
      }

      const fileName = file.name ?? `unit_type_model_${Date.now()}.glb`;
      if (!fileName.toLowerCase().endsWith('.glb')) {
        await dialog.alert({ title: 'Invalid file', message: 'Please select a .glb file.' });
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        await dialog.alert({ title: 'Error', message: 'Please sign in again to upload files.' });
        return;
      }

      setBusyType(unitType);

      const res = await fetch(file.uri);
      const blob = await res.blob();

      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${user.id}/unit-type-models/${unitType}/${Date.now()}_${safeName}`;

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
      const previous = modelsByType[unitType];
      const saved = await upsertUnitTypeModel({
        unit_type: unitType,
        model_glb_url: data.publicUrl,
        storage_path: storagePath,
      });

      if (!saved) {
        await supabase.storage.from('unit-models').remove([storagePath]);
        await dialog.alert({ title: 'Error', message: 'Could not save model reference in database.' });
        return;
      }

      if (previous?.storage_path && previous.storage_path !== storagePath) {
        await supabase.storage.from('unit-models').remove([previous.storage_path]);
      }

      await dialog.alert({ title: 'Uploaded', message: `${unitType.toUpperCase()} uploaded model updated.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown upload error';
      await dialog.alert({ title: 'Upload failed', message });
    } finally {
      setBusyType(null);
    }
  };

  const handleSaveExternalUrl = async (unitType: UnitTypeModel['unit_type']) => {
    if (busyType) return;

    const raw = getManualUrlValue(unitType).trim();
    if (raw.length > 0 && !/^https?:\/\//i.test(raw)) {
      await dialog.alert({ title: 'Invalid URL', message: 'Use a valid URL starting with http:// or https://' });
      return;
    }

    setBusyType(unitType);
    try {
      const saved = await upsertUnitTypeModel({
        unit_type: unitType,
        external_model_glb_url: raw.length > 0 ? raw : null,
      });
      if (!saved) {
        await dialog.alert({ title: 'Error', message: 'Could not save URL in database.' });
        return;
      }

      setManualUrlValue(unitType, raw);
      await dialog.alert({ title: 'Saved', message: raw.length > 0 ? 'Manual URL saved.' : 'Manual URL removed.' });
    } finally {
      setBusyType(null);
    }
  };

  const handleRemoveUploaded = async (unitType: UnitTypeModel['unit_type']) => {
    const current = modelsByType[unitType];
    if (!current || (!current.model_glb_url && !current.storage_path) || busyType) return;

    const confirmed = await dialog.confirm({
      title: 'Remove uploaded file',
      message: `Remove uploaded ${unitType.toUpperCase()} file?`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;

    setBusyType(unitType);
    try {
      if (current.storage_path) {
        await supabase.storage.from('unit-models').remove([current.storage_path]);
      }
      const saved = await upsertUnitTypeModel({
        unit_type: unitType,
        model_glb_url: null,
        storage_path: null,
      });
      if (!saved) {
        await dialog.alert({ title: 'Error', message: 'Could not remove uploaded model from database.' });
        return;
      }
      await dialog.alert({ title: 'Removed', message: 'Uploaded file removed. Manual URL (if set) remains active.' });
    } finally {
      setBusyType(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Unit Type Models' }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>UPLOAD OR SET URL BY UNIT TYPE</Text>
        <Text style={styles.subtitle}>
          Priority used by camera: uploaded file first, then manual URL.
        </Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {TYPE_OPTIONS.map((unitType) => {
          const model = modelsByType[unitType];
          const isBusy = busyType === unitType;
          const hasUploaded = Boolean(model?.model_glb_url);
          const hasManualUrl = Boolean(model?.external_model_glb_url);

          return (
            <View key={unitType} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{unitType.toUpperCase()}</Text>
                <Text
                  style={[
                    styles.cardStatus,
                    hasUploaded ? styles.cardStatusOk : hasManualUrl ? styles.cardStatusWarn : styles.cardStatusEmpty,
                  ]}
                >
                  {hasUploaded ? 'UPLOADED' : hasManualUrl ? 'URL' : 'EMPTY'}
                </Text>
              </View>

              <Text style={styles.urlLabel}>Uploaded file URL</Text>
              <Text style={styles.urlValue} numberOfLines={2}>
                {model?.model_glb_url ?? 'No uploaded file for this type.'}
              </Text>

              <Text style={styles.urlLabel}>Manual URL fallback</Text>
              <TextInput
                style={styles.input}
                placeholder="https://example.com/model.glb"
                placeholderTextColor={PLACEHOLDER}
                value={getManualUrlValue(unitType)}
                onChangeText={(value) => setManualUrlValue(unitType, value)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, isBusy && styles.btnDisabled]}
                  onPress={() => handlePickAndUpload(unitType)}
                  disabled={isBusy || loading}
                >
                  {isBusy ? (
                    <ActivityIndicator color={BG} size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>{hasUploaded ? 'REPLACE FILE' : 'UPLOAD FILE'}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryBtn, isBusy && styles.btnDisabled]}
                  onPress={() => handleSaveExternalUrl(unitType)}
                  disabled={isBusy || loading}
                >
                  <Text style={styles.secondaryBtnText}>SAVE URL</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.removeUploadedBtn,
                  (!hasUploaded || isBusy || loading) && styles.btnDisabled,
                ]}
                onPress={() => handleRemoveUploaded(unitType)}
                disabled={!hasUploaded || isBusy || loading}
              >
                <Text style={styles.removeUploadedBtnText}>REMOVE UPLOADED FILE</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.refreshBtn, loading && styles.btnDisabled]}
          onPress={fetchUnitTypeModels}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={ACCENT} size="small" />
          ) : (
            <Text style={styles.refreshBtnText}>REFRESH</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  title: {
    color: FORM_TEXT,
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 1.3,
    marginTop: 6,
  },
  subtitle: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  errorBox: {
    backgroundColor: '#330011',
    borderWidth: 1,
    borderColor: '#ff4444',
    borderRadius: 8,
    padding: 10,
  },
  errorText: {
    color: '#ff6666',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: FORM_TEXT,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  cardStatus: {
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1.2,
  },
  cardStatusOk: {
    color: '#00ff88',
  },
  cardStatusWarn: {
    color: '#ffe044',
  },
  cardStatusEmpty: {
    color: 'rgba(255,255,255,0.4)',
  },
  urlLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1.2,
  },
  urlValue: {
    color: FORM_TEXT,
    fontSize: 12,
    minHeight: 34,
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: FORM_TEXT,
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  primaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  primaryBtnText: {
    color: BG,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.3,
  },
  secondaryBtn: {
    minWidth: 100,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    paddingHorizontal: 10,
  },
  secondaryBtnText: {
    color: ACCENT,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
  },
  removeUploadedBtn: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    paddingHorizontal: 10,
  },
  removeUploadedBtnText: {
    color: DANGER,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
  },
  refreshBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: CARD_BG,
  },
  refreshBtnText: {
    color: ACCENT,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.2,
  },
  btnDisabled: {
    opacity: 0.55,
  },
});
