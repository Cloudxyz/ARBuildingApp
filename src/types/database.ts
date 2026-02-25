import { Land, LandModel, Profile } from './index';

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      lands: {
        Row: Land;
        Insert: Omit<Land, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Land, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      land_models: {
        Row: LandModel;
        Insert: Omit<LandModel, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<LandModel, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

