import { Development, Profile, Unit, UnitModel, UnitTypeModel } from './index';

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      developments: {
        Row: Development;
        Insert: Omit<Development, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Development, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      units: {
        Row: Unit;
        Insert: Omit<Unit, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Unit, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      unit_models: {
        Row: UnitModel;
        Insert: Omit<UnitModel, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<UnitModel, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      unit_type_models: {
        Row: UnitTypeModel;
        Insert: Omit<UnitTypeModel, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<UnitTypeModel, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

