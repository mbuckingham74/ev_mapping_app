// Station data from NREL AFDC API
export interface Station {
  id: number;
  station_name: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  ev_dc_fast_num: number;
  ev_connector_types: string[];
  facility_type: FacilityType | string;
  status_code: 'E' | 'P' | 'T'; // Available, Planned, Temp unavailable
  ev_pricing: string | null;
  access_days_time: string | null;
  // Enriched from OpenChargeMap
  max_power_kw?: number;
  // Computed
  rank_score?: number;
}

// Facility types ranked from best to worst for EV charging stops
export type FacilityType =
  | 'SHOPPING_CENTER'
  | 'WALMART'
  | 'TARGET'
  | 'COSTCO'
  | 'TRAVEL_CENTER'
  | 'TRUCK_STOP'
  | 'REST_AREA'
  | 'GROCERY'
  | 'MALL'
  | 'GAS_STATION'
  | 'CONVENIENCE_STORE'
  | 'HOTEL'
  | 'CAR_DEALER'
  | 'OTHER';

// Facility ranking (lower = better)
export const FACILITY_RANKINGS: Record<string, number> = {
  WALMART: 1,
  TARGET: 1,
  COSTCO: 1,
  TRAVEL_CENTER: 2,
  TRUCK_STOP: 2,
  REST_AREA: 2,
  GROCERY: 3,
  SHOPPING_CENTER: 4,
  MALL: 4,
  GAS_STATION: 5,
  CONVENIENCE_STORE: 5,
  HOTEL: 6,
  CAR_DEALER: 7,
  OTHER: 8,
};

// Edge between two stations
export interface Edge {
  from_station_id: number;
  to_station_id: number;
  distance_miles: number;
  elevation_change_ft: number;
  // Computed effective distance accounting for elevation
  effective_distance_miles?: number;
}

// Route segment for display
export interface RouteSegment {
  from_station: Station;
  to_station: Station;
  distance_miles: number;
  elevation_change_ft: number;
  effective_distance_miles: number;
  risk_level: 'safe' | 'tight' | 'risky';
}

// Planned route
export interface PlannedRoute {
  origin: Location;
  destination: Location;
  segments: RouteSegment[];
  total_distance_miles: number;
  station_count: number;
}

// Generic location (for origin/destination)
export interface Location {
  name: string;
  latitude: number;
  longitude: number;
}
