export type User = {
  id: number;
  email: string;
};

export type UserPreferences = {
  user_id: number;
  vehicle_name: string | null;
  range_miles: number;
  efficiency_mi_per_kwh: number | null;
  battery_kwh: number | null;
  min_arrival_percent: number;
  default_corridor_miles: number;
  default_preference: 'fastest' | 'charger_optimized';
  max_detour_factor: number;
  max_charging_speed_kw: number | null;
  connector_type: 'CCS' | 'CHADEMO' | 'NACS' | 'J1772' | null;
  created_at: string;
  updated_at: string;
};

export type MeResponse = {
  user: User | null;
  preferences: UserPreferences | null;
};
