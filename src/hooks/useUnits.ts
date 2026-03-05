import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  Development,
  DevelopmentInsert,
  DevelopmentUpdate,
  Unit,
  UnitGlbModel,
  UnitInsert,
  UnitModel,
  UnitType,
  UnitTypeModel,
  UnitUpdate,
} from '../types';

// =================================================================
// Helpers
// =================================================================

/**
 * MySQL returns JSON/TEXT columns as raw strings.
 * Parse `floors` into an array so the rest of the app always sees string[].
 */
function parseUnitFloors(unit: Unit): Unit {
  if (typeof (unit as any).floors === 'string') {
    try {
      const parsed = JSON.parse((unit as any).floors);
      return { ...unit, floors: Array.isArray(parsed) ? parsed : null };
    } catch {
      return { ...unit, floors: null };
    }
  }
  return unit;
}

// =================================================================
// useDevelopments
// =================================================================
export function useDevelopments() {
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDevelopments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ developments: Development[] }>('GET', '/api/developments');
      setDevelopments(res.developments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load developments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDevelopments(); }, [fetchDevelopments]);

  const createDevelopment = async (input: DevelopmentInsert): Promise<Development | null> => {
    try {
      const res = await api<{ development: Development }>('POST', '/api/developments', input);
      setDevelopments((prev) => [res.development, ...prev]);
      return res.development;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create development');
      return null;
    }
  };

  const updateDevelopment = async (id: string, updates: DevelopmentUpdate): Promise<boolean> => {
    try {
      const res = await api<{ development: Development }>('PUT', `/api/developments/${id}`, updates);
      setDevelopments((prev) => prev.map((d) => (d.id === id ? res.development : d)));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update development');
      return false;
    }
  };

  const deleteDevelopment = async (id: string): Promise<boolean> => {
    try {
      await api('DELETE', `/api/developments/${id}`);
      setDevelopments((prev) => prev.filter((d) => d.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete development');
      return false;
    }
  };

  return { developments, loading, error, fetchDevelopments, createDevelopment, updateDevelopment, deleteDevelopment };
}

// =================================================================
// useUnits
// =================================================================
export function useUnits() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ units: Unit[] }>('GET', '/api/units');
      setUnits((res.units ?? []).map(parseUnitFloors));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load units');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUnits(); }, [fetchUnits]);

  const createUnit = async (
    input: UnitInsert,
  ): Promise<{ unit: Unit | null; error: string | null }> => {
    try {
      const res = await api<{ unit: Unit }>('POST', '/api/units', input);
      const unit = parseUnitFloors(res.unit);
      setUnits((prev) => [unit, ...prev]);
      return { unit, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create unit';
      setError(message);
      return { unit: null, error: message };
    }
  };

  const updateUnit = async (
    id: string,
    updates: UnitUpdate,
  ): Promise<{ ok: boolean; error: string | null }> => {
    try {
      const res = await api<{ unit: Unit }>('PUT', `/api/units/${id}`, updates);
      const unit = parseUnitFloors(res.unit);
      setUnits((prev) => prev.map((u) => (u.id === id ? unit : u)));
      return { ok: true, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update unit';
      setError(message);
      return { ok: false, error: message };
    }
  };

  const deleteUnit = async (id: string): Promise<boolean> => {
    try {
      await api('DELETE', `/api/units/${id}`);
      setUnits((prev) => prev.filter((u) => u.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete unit');
      return false;
    }
  };

  return { units, loading, error, fetchUnits, createUnit, updateUnit, deleteUnit };
}

// =================================================================
// useUnitModel  (one model per unit â€” footprint mesh)
// =================================================================
export function useUnitModel(unitId: string) {
  const [model, setModel] = useState<UnitModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ model: UnitModel | null }>('GET', `/api/units/${unitId}/model`);
      setModel(res.model ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model');
    } finally {
      setLoading(false);
    }
  }, [unitId]);

  useEffect(() => { fetchModel(); }, [fetchModel]);

  /** Upsert the unit model (AR config + optional glb_url/storage_path). */
  const saveModel = async (
    input: {
      glb_url?: string | null;
      storage_path?: string | null;
      floor_count?: number | null;
      scale?: number | null;
      rotation_deg?: number | null;
      building_type?: string | null;
      color_scheme?: string | null;
      footprint_w?: number | null;
      footprint_h?: number | null;
      model_data?: Record<string, unknown> | null;
      [key: string]: unknown;
    },
  ): Promise<UnitModel | null> => {
    try {
      const res = await api<{ model: UnitModel }>('POST', `/api/units/${unitId}/model`, input);
      setModel(res.model);
      return res.model;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model');
      return null;
    }
  };

  const updateModel = async (
    updates: {
      glb_url?: string | null;
      storage_path?: string | null;
      floor_count?: number | null;
      scale?: number | null;
      rotation_deg?: number | null;
      building_type?: string | null;
      color_scheme?: string | null;
      footprint_w?: number | null;
      footprint_h?: number | null;
      model_data?: Record<string, unknown> | null;
    },
  ): Promise<boolean> => {
    if (!model) return false;
    try {
      const res = await api<{ model: UnitModel }>('PUT', `/api/unit-models/${model.id}`, updates);
      setModel((prev) => (prev ? { ...prev, ...res.model } : prev));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update model');
      return false;
    }
  };

  return { model, loading, error, fetchModel, saveModel, updateModel };
}

// =================================================================
// useUnitTypeModels  (shared library per type)
// =================================================================
type UnitTypeModelKey = UnitTypeModel['unit_type'];
type UnitTypeModelUpsertInput = {
  unit_type: UnitTypeModelKey;
  model_glb_url?: string | null;
  external_model_glb_url?: string | null;
  storage_path?: string | null;
};

export function useUnitTypeModels() {
  const [modelsByType, setModelsByType] = useState<Partial<Record<UnitTypeModelKey, UnitTypeModel>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUnitTypeModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ unit_type_models: UnitTypeModel[] }>('GET', '/api/unit-type-models');
      const rows = res.unit_type_models ?? [];
      const next: Partial<Record<UnitTypeModelKey, UnitTypeModel>> = {};
      for (const row of rows) {
        const key = row.unit_type as UnitTypeModelKey;
        if (!next[key]) next[key] = row;
      }
      setModelsByType(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load type models');
      setModelsByType({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUnitTypeModels(); }, [fetchUnitTypeModels]);

  const upsertUnitTypeModel = useCallback(
    async (input: UnitTypeModelUpsertInput): Promise<UnitTypeModel | null> => {
      setError(null);
      try {
        // Server handles upsert by unit_type
        const res = await api<{ unit_type_model: UnitTypeModel }>(
          'POST',
          '/api/unit-type-models',
          input,
        );
        const row = res.unit_type_model;
        setModelsByType((prev) => ({ ...prev, [row.unit_type]: row }));
        return row;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save type model');
        return null;
      }
    },
    [],
  );

  const deleteUnitTypeModel = useCallback(
    async (unitType: UnitTypeModelKey): Promise<boolean> => {
      setError(null);
      const existing = modelsByType[unitType];
      if (!existing) return true;
      try {
        await api('DELETE', `/api/unit-type-models/${existing.id}`);
        setModelsByType((prev) => {
          const next = { ...prev };
          delete next[unitType];
          return next;
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete type model');
        return false;
      }
    },
    [modelsByType],
  );

  return { modelsByType, loading, error, fetchUnitTypeModels, upsertUnitTypeModel, deleteUnitTypeModel };
}

// =================================================================
// useUnitGlbModels  (per-unit, per-type GLB models)
// =================================================================
export function useUnitGlbModels(unitId: string) {
  const [byType, setByType] = useState<Partial<Record<UnitType, UnitGlbModel>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGlbModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ glb_models: UnitGlbModel[] }>('GET', `/api/units/${unitId}/glb-models`);
      const rows = res.glb_models ?? [];
      const next: Partial<Record<UnitType, UnitGlbModel>> = {};
      for (const row of rows) { next[row.unit_type as UnitType] = row; }
      setByType(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GLB models');
      setByType({});
    } finally {
      setLoading(false);
    }
  }, [unitId]);

  useEffect(() => { fetchGlbModels(); }, [fetchGlbModels]);

  const upsertGlbModel = useCallback(
    async (
      unitType: UnitType,
      fields: { glbUrl?: string | null; storagePath?: string | null; externalGlbUrl?: string | null },
    ): Promise<UnitGlbModel | null> => {
      setError(null);
      const existing = byType[unitType];
      try {
        let row: UnitGlbModel;
        if (existing) {
          // Only send fields that are explicitly being changed
          const body: Record<string, unknown> = {};
          if (fields.glbUrl          !== undefined) body.glb_url          = fields.glbUrl          ?? null;
          if (fields.storagePath     !== undefined) body.storage_path     = fields.storagePath     ?? null;
          if (fields.externalGlbUrl  !== undefined) body.external_glb_url = fields.externalGlbUrl  ?? null;
          const res = await api<{ glb_model: UnitGlbModel }>(
            'PUT',
            `/api/unit-glb-models/${existing.id}`,
            body,
          );
          row = res.glb_model;
        } else {
          // New row: only include fields that have actual values
          const body: Record<string, unknown> = { unit_type: unitType };
          if (fields.glbUrl         != null) body.glb_url          = fields.glbUrl;
          if (fields.storagePath    != null) body.storage_path     = fields.storagePath;
          if (fields.externalGlbUrl != null) body.external_glb_url = fields.externalGlbUrl;
          const res = await api<{ glb_model: UnitGlbModel }>(
            'POST',
            `/api/units/${unitId}/glb-models`,
            body,
          );
          row = res.glb_model;
        }
        setByType((prev) => ({ ...prev, [unitType]: row }));
        return row;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save GLB model';
        setError(message);
        throw new Error(message); // re-throw so callers (create/edit screens) can surface the error
      }
    },
    [unitId, byType],
  );

  const deleteGlbModel = useCallback(
    async (unitType: UnitType): Promise<boolean> => {
      setError(null);
      const existing = byType[unitType];
      if (!existing) return true;
      try {
        await api('DELETE', `/api/unit-glb-models/${existing.id}`);
        setByType((prev) => {
          const next = { ...prev };
          delete next[unitType];
          return next;
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete GLB model');
        return false;
      }
    },
    [byType],
  );

  return { byType, loading, error, fetchGlbModels, upsertGlbModel, deleteGlbModel };
}

// =================================================================
// Floor tours â€” now stored in units.floors; these are no-op stubs
// kept for import compatibility.
// =================================================================
export type FloorTour = {
  id: string;
  unit_id: string;
  floor_index: number;
  provider: string;
  url: string;
  created_at: string;
};

export async function saveFloorToursForUnit(
  _unitId: string,
  _urlMap: Record<number, string>,
): Promise<void> {
  // Floor tour data is now stored in units.floors column.
  // Call updateUnit() with the floors array directly.
}

export function useFloorTours(_unitId: string) {
  return {
    tours: [] as FloorTour[],
    loading: false,
    saveTours: async (_urlMap: Record<number, string>) => {},
    refetch: async () => {},
  };
}
