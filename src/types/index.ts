// =============================================
// Database types — mirrors Supabase schema
// =============================================

export type UnitStatus = 'available' | 'reserved' | 'sold';
export type UnitType = 'land' | 'house' | 'building' | 'commercial';
export type BuildingType = 'residential' | 'commercial' | 'industrial' | 'mixed';
export type DevelopmentType = 'fraccionamiento' | 'condominio';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Development {
  id: string;
  user_id: string;
  name: string;
  type: DevelopmentType;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
}

export type DevelopmentInsert = Omit<Development, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
export type DevelopmentUpdate = Partial<DevelopmentInsert>;

export interface Unit {
  id: string;
  user_id: string;
  development_id: string | null;
  unit_type: UnitType;
  model_glb_url: string | null;
  name: string;
  description: string | null;
  area_sqm: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  price: number | null;
  status: UnitStatus;
  thumbnail_url: string | null;
  /** Matterport URLs per floor. floors[i] = URL for floor (i+1), "" if no tour. Length = floor count. */
  floors: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface UnitInsert {
  name: string;
  unit_type?: UnitType;
  model_glb_url?: string | null;
  description?: string | null;
  area_sqm?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  price?: number | null;
  status?: UnitStatus;
  thumbnail_url?: string | null;
  development_id?: string | null;
  /** Matterport URLs per floor. floors[i] = URL for floor (i+1), "" if no tour. Length = floor count. */
  floors?: string[] | null;
}

export type UnitUpdate = Partial<UnitInsert>;

export interface UnitTypeModel {
  id: string;
  user_id: string;
  unit_type: Exclude<UnitType, 'land'>;
  model_glb_url: string | null;
  external_model_glb_url: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnitTypeModelInsert {
  user_id: string;
  unit_type: Exclude<UnitType, 'land'>;
  model_glb_url?: string | null;
  external_model_glb_url?: string | null;
  storage_path?: string | null;
}

export type UnitTypeModelUpdate = Partial<UnitTypeModelInsert>;

export interface UnitModel {
  id: string;
  unit_id: string;
  user_id: string;
  floor_count: number;
  scale: number;
  rotation_deg: number;
  building_type: BuildingType;
  color_scheme: string;
  footprint_w: number;
  footprint_h: number;
  model_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type UnitModelInsert = Omit<UnitModel, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
// model_data stores: { buildSpeed, offsetX, offsetY, blueprintOpacity, shadowStrength }
export type UnitModelUpdate = Partial<UnitModelInsert>;

// =============================================
// Supabase Database helper type
// =============================================
// Building animation types
// =============================================
export interface BuildingConfig {
  floorCount: number;
  scale: number;
  rotationDeg: number;
  buildingType: BuildingType;
  footprintW: number;
  footprintH: number;
  colorScheme: 'blueprint' | 'warm' | 'neon';
}

export interface ParticleConfig {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  /** 0-1: where in the animation cycle this particle starts (eliminates initial-line artefact) */
  phase: number;
}

// =============================================
// Shared AR model config (persisted in unit_models.model_data)
// =============================================
export interface ARModelConfig {
  floorCount: number;
  buildSpeed: number;        // animation speed multiplier
  scale: number;
  rotationDeg: number;
  offsetX: number;
  offsetY: number;
  blueprintOpacity: number;  // 0-1
  shadowStrength: number;    // 0-1
  footprintW: number;
  footprintH: number;
  buildingType: BuildingType;
  colorScheme: 'blueprint' | 'warm' | 'neon';
}

export type ARViewMode = 'blueprint' | '3d' | 'magic3d';

// =============================================
// Per-unit, per-type GLB model record
// =============================================
export interface UnitGlbModel {
  id: string;
  unit_id: string;
  user_id: string;
  unit_type: UnitType;
  glb_url: string | null;           // uploaded file public URL (priority)
  storage_path: string | null;      // Supabase storage path for uploaded file
  external_glb_url: string | null;  // manual fallback URL
  created_at: string;
  updated_at: string;
}

export interface UnitGlbModelInsert {
  unit_id: string;
  unit_type: UnitType;
  glb_url?: string | null;
  storage_path?: string | null;
  external_glb_url?: string | null;
}

export type UnitGlbModelUpdate = Partial<Omit<UnitGlbModelInsert, 'unit_id' | 'unit_type'>>;

/**
 * Resolves the best available GLB source for a given unit type.
 * Priority: glb_url (uploaded file) → external_glb_url (manual URL) → null
 */
export function resolveGlbSource(
  byType: Partial<Record<UnitType, UnitGlbModel>>,
  type: UnitType,
): string | null {
  const record = byType[type];
  if (!record) return null;
  return record.glb_url ?? record.external_glb_url ?? null;
}
