import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Land, LandInsert, LandModel, LandModelInsert, LandModelUpdate, LandUpdate } from '../types';

// =============================================
// useLands — CRUD for lands table
// =============================================
export function useLands() {
  const [lands, setLands] = useState<Land[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLands = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('lands')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) setError(error.message);
    else setLands(data as Land[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLands();
  }, [fetchLands]);

  const createLand = async (input: LandInsert): Promise<Land | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('lands')
      .insert({ ...input, user_id: user.id })
      .select()
      .single();

    if (error) {
      setError(error.message);
      return null;
    }
    setLands((prev) => [data as Land, ...prev]);
    return data as Land;
  };

  const updateLand = async (id: string, updates: LandUpdate): Promise<boolean> => {
    const { error } = await supabase.from('lands').update(updates).eq('id', id);
    if (error) {
      setError(error.message);
      return false;
    }
    setLands((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
    return true;
  };

  const deleteLand = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('lands').delete().eq('id', id);
    if (error) {
      setError(error.message);
      return false;
    }
    setLands((prev) => prev.filter((l) => l.id !== id));
    return true;
  };

  return { lands, loading, error, fetchLands, createLand, updateLand, deleteLand };
}

// =============================================
// useLandModel — CRUD for land_models table
// =============================================
export function useLandModel(landId: string) {
  const [model, setModel] = useState<LandModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModel = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('land_models')
      .select('*')
      .eq('land_id', landId)
      .maybeSingle();

    if (error) setError(error.message);
    else setModel(data as LandModel | null);
    setLoading(false);
  }, [landId]);

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  const saveModel = async (input: LandModelInsert): Promise<LandModel | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const payload = { ...input, land_id: landId, user_id: user.id };

    const { data, error } = model
      ? await supabase.from('land_models').update(payload).eq('id', model.id).select().single()
      : await supabase.from('land_models').insert(payload).select().single();

    if (error) {
      setError(error.message);
      return null;
    }
    setModel(data as LandModel);
    return data as LandModel;
  };

  const updateModel = async (updates: LandModelUpdate): Promise<boolean> => {
    if (!model) return false;
    const { error } = await supabase
      .from('land_models')
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
