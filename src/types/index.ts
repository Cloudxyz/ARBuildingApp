// =============================================
// Database types — mirrors Supabase schema
// =============================================

export type LandStatus = 'available' | 'reserved' | 'sold';
export type BuildingType = 'residential' | 'commercial' | 'industrial' | 'mixed';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Land {
  id: string;
  user_id: string;
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
  status: LandStatus;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export type LandInsert = Omit<Land, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
export type LandUpdate = Partial<LandInsert>;

export interface LandModel {
  id: string;
  land_id: string;
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

export type LandModelInsert = Omit<LandModel, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
// model_data stores: { buildSpeed, offsetX, offsetY, blueprintOpacity, shadowStrength }
export type LandModelUpdate = Partial<LandModelInsert>;

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
}

// =============================================
// Shared AR model config (persisted in land_models.model_data)
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

export type ARViewMode = 'blueprint' | '3d';
