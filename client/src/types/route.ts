import type { Station } from './station';

export type RoutePoint = {
  query: string;
  label: string;
  lat: number;
  lng: number;
};

export type RouteSummary = {
  distance_meters: number;
  duration_seconds: number;
  elevation_gain_ft?: number;
  elevation_loss_ft?: number;
};

export type RouteStation = Station & {
  distance_to_route_miles: number;
  distance_along_route_miles: number;
  distance_from_prev_miles: number;
  distance_to_next_miles: number;
  elevation_from_prev_ft?: number;
  elevation_to_next_ft?: number;
  rank_score?: number;
  rank?: number;
  rank_tier?: 'A' | 'B' | 'C' | 'D';
};

export type AutoWaypoint = {
  id: number;
  station_name: string;
  latitude: number;
  longitude: number;
};

export type TruckStopAlongRoute = {
  id: number;
  brand: string;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  phone: string | null;
  truck_parking_spots: number | null;
  truck_parking_raw: string | null;
  distance_to_route_miles: number;
  distance_along_route_miles: number;
};

export type RechargePOICategory = 'mcdonalds' | 'starbucks';

export type RechargePOIAlongRoute = {
  id: number;
  category: RechargePOICategory;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  latitude: number;
  longitude: number;
  distance_to_route_miles: number;
  distance_along_route_miles: number;
};

export type RouteResponse = {
  points: RoutePoint[];
  summary: RouteSummary;
  geometry: [number, number][];
  corridor_miles?: number;
  stations?: RouteStation[];
  truck_stops?: TruckStopAlongRoute[];
  recharge_pois?: RechargePOIAlongRoute[];
  auto_waypoints?: AutoWaypoint[];
  preference?: 'fastest' | 'charger_optimized';
  requested_preference?: 'fastest' | 'charger_optimized';
  candidates_evaluated?: number;
  max_gap_miles?: number;
  warning?: string;
};
