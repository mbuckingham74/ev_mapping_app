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
};

export type RouteStation = Station & {
  distance_to_route_miles: number;
  distance_along_route_miles: number;
  distance_from_prev_miles: number;
  distance_to_next_miles: number;
};

export type AutoWaypoint = {
  id: number;
  station_name: string;
  latitude: number;
  longitude: number;
};

export type RouteResponse = {
  points: RoutePoint[];
  summary: RouteSummary;
  geometry: [number, number][];
  corridor_miles?: number;
  stations?: RouteStation[];
  auto_waypoints?: AutoWaypoint[];
  preference?: 'fastest' | 'charger_optimized';
  requested_preference?: 'fastest' | 'charger_optimized';
  candidates_evaluated?: number;
  max_gap_miles?: number;
  warning?: string;
};
