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

export type RouteResponse = {
  points: RoutePoint[];
  summary: RouteSummary;
  geometry: [number, number][];
};

