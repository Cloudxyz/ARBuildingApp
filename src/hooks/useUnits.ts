import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Development,
  DevelopmentInsert,
  DevelopmentUpdate,
  Unit,
  UnitGlbModel,
  UnitGlbModelInsert,
  UnitGlbModelUpdate,
  UnitInsert,
  UnitModel,
  UnitModelInsert,
  UnitModelUpdate,
  UnitType,
  UnitTypeModel,
  UnitTypeModelInsert,
  UnitUpdate,
} from '../types';

// =============================================
// useDevelopments - CRUD for developments table
// =============================================
export function useDevelopments() {
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDevelopments = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('developments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) setError(error.message);
    else setDevelopments(data as Development[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDevelopments();
  }, [fetchDevelopments]);

  const createDevelopment = async (input: DevelopmentInsert): Promise<Development | null> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('developments')
      .insert({ ...input, user_id: user.id })
      .select()
      .single();

    if (error) {
      setError(error.message);
      return null;
    }

    setDevelopments((prev) => [data as Development, ...prev]);
    return data as Development;
  };

  const updateDevelopment = async (id: string, updates: DevelopmentUpdate): Promise<boolean> => {
    const { error } = await supabase.from('developments').update(updates).eq('id', id);
    if (error) {
      setError(error.message);
      return false;
    }

    setDevelopments((prev) => prev.map((d) => (d.id === id ? { ...d, ...updates } : d)));
    return true;
  };

  const deleteDevelopment = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('developments').delete().eq('id', id);
    if (error) {
      setError(error.message);
      return false;
    }

    setDevelopments((prev) => prev.filter((d) => d.id !== id));
    return true;
  };

  return {
    developments,
    loading,
    error,
    fetchDevelopments,
    createDevelopment,
    updateDevelopment,
    deleteDevelopment,
  };
}

// =============================================
// useUnits - CRUD for units table
// =============================================
export function useUnits() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) setError(error.message);
    else setUnits(data as Unit[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  const createUnit = async (input: UnitInsert): Promise<Unit | null> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('units')
      .insert({ ...input, user_id: user.id })
      .select()
      .single();

    if (error) {
      setError(error.message);
      return null;
    }
    setUnits((prev) => [data as Unit, ...prev]);
    return data as Unit;
  };

  const updateUnit = async (id: string, updates: UnitUpdate): Promise<boolean> => {
    const { error } = await supabase.from('units').update(updates).eq('id', id);
    if (error) {
      setError(error.message);
      return false;
    }
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...updates } : u)));
    return true;
  };

  const deleteUnit = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('units').delete().eq('id', id);
    if (error) {
      setError(error.message);
      return false;
    }
    setUnits((prev) => prev.filter((u) => u.id !== id));
    return true;
  };

  return { units, loading, error, fetchUnits, createUnit, updateUnit, deleteUnit };
}

// =============================================
// useUnitModel - CRUD for unit_models table
// =============================================
export function useUnitModel(unitId: string) {
  const [model, setModel] = useState<UnitModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModel = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('unit_models')
      .select('*')
      .eq('unit_id', unitId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) setError(error.message);
    else setModel(data as UnitModel | null);
    setLoading(false);
  }, [unitId]);

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  const saveModel = async (input: UnitModelInsert): Promise<UnitModel | null> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const payload = { ...input, unit_id: unitId, user_id: user.id };
    const { data: existing, error: existingError } = await supabase
      .from('unit_models')
      .select('id')
      .eq('unit_id', unitId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      setError(existingError.message);
      return null;
    }

    const modelId = existing?.id ?? model?.id ?? null;
    const { data, error } = modelId
      ? await supabase.from('unit_models').update(payload).eq('id', modelId).select().single()
      : await supabase.from('unit_models').insert(payload).select().single();

    if (error) {
      setError(error.message);
      return null;
    }
    setModel(data as UnitModel);
    return data as UnitModel;
  };

  const updateModel = async (updates: UnitModelUpdate): Promise<boolean> => {
    if (!model) return false;
    const { error } = await supabase
      .from('unit_models')
      .update(updates)
      .eq('id', model.id);
    if (error) {
      setError(error.message);
      return false;
    }
    setModel((prev) => (prev ? { ...prev, ...updates } : prev));
    return true;
  };

  return { model, loading, error, fetchModel, saveModel, updateModel };
}

// =============================================
// useUnitTypeModels - read per-type model URLs
// =============================================
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

    const { data, error } = await supabase
      .from('unit_type_models')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      setError(error.message);
      setModelsByType({});
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as UnitTypeModel[];
    const next: Partial<Record<UnitTypeModelKey, UnitTypeModel>> = {};
    for (const row of rows) {
      const key = row.unit_type as UnitTypeModelKey;
      if (!next[key]) next[key] = row;
    }
    setModelsByType(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUnitTypeModels();
  }, [fetchUnitTypeModels]);

  const upsertUnitTypeModel = useCallback(
    async (input: UnitTypeModelUpsertInput): Promise<UnitTypeModel | null> => {
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('Authentication required.');
        return null;
      }

      const existing = modelsByType[input.unit_type];
      const payload: UnitTypeModelInsert = {
        user_id: user.id,
        unit_type: input.unit_type,
        model_glb_url:
          input.model_glb_url !== undefined ? input.model_glb_url : (existing?.model_glb_url ?? null),
        external_model_glb_url:
          input.external_model_glb_url !== undefined
            ? input.external_model_glb_url
            : (existing?.external_model_glb_url ?? null),
        storage_path:
          input.storage_path !== undefined ? input.storage_path : (existing?.storage_path ?? null),
      };

      const { data, error } = existing
        ? await supabase.from('unit_type_models').update(payload).eq('id', existing.id).select().single()
        : await supabase.from('unit_type_models').insert(payload).select().single();

      if (error) {
        setError(error.message);
        return null;
      }

      const row = data as UnitTypeModel;
      setModelsByType((prev) => ({ ...prev, [row.unit_type]: row }));
      return row;
    },
    [modelsByType]
  );

  const deleteUnitTypeModel = useCallback(
    async (unitType: UnitTypeModelKey): Promise<boolean> => {
      setError(null);

      const existing = modelsByType[unitType];
      if (!existing) return true;

      const { error } = await supabase.from('unit_type_models').delete().eq('id', existing.id);
      if (error) {
        setError(error.message);
        return false;
      }

      setModelsByType((prev) => {
        const next = { ...prev };
        delete next[unitType];
        return next;
      });
      return true;
    },
    [modelsByType]
  );

  return {
    modelsByType,
    loading,
    error,
    fetchUnitTypeModels,
    upsertUnitTypeModel,
    deleteUnitTypeModel,
  };
}

// =============================================
// useUnitGlbModels - per-unit, per-type GLB models
// =============================================
export function useUnitGlbModels(unitId: string) {
  const [byType, setByType] = useState<Partial<Record<UnitType, UnitGlbModel>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGlbModels = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('unit_glb_models')
      .select('*')
      .eq('unit_id', unitId);

    if (error) {
      setError(error.message);
      setByType({});
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as UnitGlbModel[];
    const next: Partial<Record<UnitType, UnitGlbModel>> = {};
    for (const row of rows) {
      next[row.unit_type as UnitType] = row;
    }
    setByType(next);
    setLoading(false);
  }, [unitId]);

  useEffect(() => {
    fetchGlbModels();
  }, [fetchGlbModels]);

  /** Insert or update the GLB record for one unit type. */
  const upsertGlbModel = useCallback(
    async (
      unitType: UnitType,
      fields: { glbUrl?: string | null; storagePath?: string | null; externalGlbUrl?: string | null },
    ): Promise<UnitGlbModel | null> => {
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Authentication required.');
        return null;
      }

      const existing = byType[unitType];

      const payload: UnitGlbModelInsert = {
        unit_id: unitId,
        unit_type: unitType,
        glb_url: fields.glbUrl !== undefined ? fields.glbUrl : (existing?.glb_url ?? null),
        storage_path: fields.storagePath !== undefined ? fields.storagePath : (existing?.storage_path ?? null),
        external_glb_url:
          fields.externalGlbUrl !== undefined ? fields.externalGlbUrl : (existing?.external_glb_url ?? null),
      };

      const { data, error } = existing
        ? await supabase
            .from('unit_glb_models')
            .update(payload as UnitGlbModelUpdate)
            .eq('id', existing.id)
            .select()
            .single()
        : await supabase
            .from('unit_glb_models')
            .insert({ ...payload, user_id: user.id })
            .select()
            .single();

      if (error) {
        setError(error.message);
        return null;
      }

      const row = data as UnitGlbModel;
      setByType((prev) => ({ ...prev, [unitType]: row }));
      return row;
    },
    [unitId, byType],
  );

  /** Remove the GLB record for one unit type. */
  const deleteGlbModel = useCallback(
    async (unitType: UnitType): Promise<boolean> => {
      setError(null);

      const existing = byType[unitType];
      if (!existing) return true;

      const { error } = await supabase.from('unit_glb_models').delete().eq('id', existing.id);
      if (error) {
        setError(error.message);
        return false;
      }

      setByType((prev) => {
        const next = { ...prev };
        delete next[unitType];
        return next;
      });
      return true;
    },
    [byType],
  );

  return { byType, loading, error, fetchGlbModels, upsertGlbModel, deleteGlbModel };
}
