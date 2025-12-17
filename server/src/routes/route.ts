import { Router } from 'express';
import { config } from '../config.js';
import { pool } from '../db.js';

const router = Router();

const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_DEGREE_LAT = 111_320;

type GeocodedPoint = {
  query: string;
  label: string;
  lat: number;
  lng: number;
};

type RouteSummary = {
  distance_meters: number;
  duration_seconds: number;
};

type RouteResponse = {
  points: GeocodedPoint[];
  summary: RouteSummary;
  geometry: [number, number][];
  corridor_miles?: number;
  stations?: StationAlongRoute[];
  preference?: 'fastest' | 'charger_optimized';
  requested_preference?: 'fastest' | 'charger_optimized';
  candidates_evaluated?: number;
  max_gap_miles?: number;
  warning?: string;
};

type StationRow = {
  id: number;
  station_name: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number;
  longitude: number;
  ev_dc_fast_num: number;
  ev_connector_types: string[] | null;
  facility_type: string | null;
  status_code: string | null;
  ev_pricing: string | null;
  access_days_time: string | null;
  max_power_kw: number | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

type StationAlongRoute = StationRow & {
  distance_to_route_miles: number;
  distance_along_route_miles: number;
  distance_from_prev_miles: number;
  distance_to_next_miles: number;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function ensureString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function ensureNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

async function geocodeOrs(query: string): Promise<GeocodedPoint | null> {
  const apiKey = config.apiKeys.openRouteService;
  if (!apiKey) {
    throw new Error('OPENROUTESERVICE_API_KEY not set in environment');
  }

  const url = new URL('https://api.openrouteservice.org/geocode/search');
  url.searchParams.set('text', query);
  url.searchParams.set('size', '1');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouteService geocoding error: ${response.status} ${response.statusText}\n${text}`);
  }

  const data = (await response.json()) as unknown;
  if (!data || typeof data !== 'object') return null;

  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) return null;

  const first = features[0] as {
    geometry?: { coordinates?: unknown };
    properties?: { label?: unknown };
  };

  const coords = first.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const label = typeof first.properties?.label === 'string' ? first.properties.label : query;

  return {
    query,
    label,
    lat,
    lng,
  };
}

type RouteResult = { summary: RouteSummary; geometry: [number, number][] };

function parseOrsDirectionsFeature(feature: unknown): RouteResult | null {
  const f = feature as {
    geometry?: { coordinates?: unknown };
    properties?: { summary?: { distance?: unknown; duration?: unknown } };
  };

  const summary = f.properties?.summary;
  const distance = summary?.distance;
  const duration = summary?.duration;
  if (typeof distance !== 'number' || typeof duration !== 'number') return null;

  const line = f.geometry?.coordinates;
  if (!Array.isArray(line) || line.length === 0) return null;

  const geometry: [number, number][] = [];
  for (const point of line) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [lng, lat] = point;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    geometry.push([lat, lng]);
  }
  if (geometry.length === 0) return null;

  return {
    summary: {
      distance_meters: distance,
      duration_seconds: duration,
    },
    geometry,
  };
}

async function directionsOrsWithAlternatives(options: {
  coordinates: [number, number][];
  includeAlternatives: boolean;
}): Promise<RouteResult[]> {
  const apiKey = config.apiKeys.openRouteService;
  if (!apiKey) {
    throw new Error('OPENROUTESERVICE_API_KEY not set in environment');
  }

  const body: Record<string, unknown> = {
    coordinates: options.coordinates.map(([lng, lat]) => [lng, lat]),
    instructions: false,
  };

  if (options.includeAlternatives) {
    body.alternative_routes = {
      target_count: 3,
      weight_factor: 1.8,
      share_factor: 0.6,
    };
  }

  const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: {
      Accept: 'application/geo+json',
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let orsCode: number | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: unknown } };
      if (typeof parsed?.error?.code === 'number') {
        orsCode = parsed.error.code;
      }
    } catch {
      // ignore parse errors
    }

    const error = new Error(`OpenRouteService directions error: ${response.status} ${response.statusText}\n${text}`);
    (error as unknown as { orsStatus?: number }).orsStatus = response.status;
    (error as unknown as { orsCode?: number }).orsCode = orsCode;
    throw error;
  }

  const data = (await response.json()) as unknown;
  if (!data || typeof data !== 'object') {
    throw new Error('Unexpected directions response: expected an object');
  }

  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error('Unexpected directions response: missing features');
  }

  const routes = features
    .map(parseOrsDirectionsFeature)
    .filter((r): r is RouteResult => r !== null);

  if (routes.length === 0) {
    throw new Error('Unexpected directions response: no valid routes');
  }

  return routes;
}

type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

function computeBounds(geometry: [number, number][], paddingMeters: number): Bounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const [lat, lng] of geometry) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  const padLat = paddingMeters / METERS_PER_DEGREE_LAT;
  const meanLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos(degreesToRadians(meanLat));
  const padLng = cosLat === 0 ? 180 : paddingMeters / (METERS_PER_DEGREE_LAT * Math.abs(cosLat));

  return {
    minLat: Math.max(-90, minLat - padLat),
    maxLat: Math.min(90, maxLat + padLat),
    minLng: Math.max(-180, minLng - padLng),
    maxLng: Math.min(180, maxLng + padLng),
  };
}

type RouteSegment = {
  aLatRad: number;
  aLngRad: number;
  cosLat0: number;
  dx: number;
  dy: number;
  len: number;
  lenSq: number;
  cumStart: number;
};

type RouteIndex = {
  segments: RouteSegment[];
  scaleToSummaryDistance: number;
};

function buildRouteIndex(geometry: [number, number][], summaryDistanceMeters: number): RouteIndex {
  const segments: RouteSegment[] = [];
  let cum = 0;

  for (let i = 0; i < geometry.length - 1; i += 1) {
    const [aLatDeg, aLngDeg] = geometry[i]!;
    const [bLatDeg, bLngDeg] = geometry[i + 1]!;

    const aLatRad = degreesToRadians(aLatDeg);
    const aLngRad = degreesToRadians(aLngDeg);
    const bLatRad = degreesToRadians(bLatDeg);
    const bLngRad = degreesToRadians(bLngDeg);

    const lat0 = (aLatRad + bLatRad) / 2;
    const cosLat0 = Math.cos(lat0);

    const dx = (bLngRad - aLngRad) * cosLat0 * EARTH_RADIUS_METERS;
    const dy = (bLatRad - aLatRad) * EARTH_RADIUS_METERS;
    const lenSq = dx * dx + dy * dy;
    const len = Math.sqrt(lenSq);

    if (!Number.isFinite(len) || len <= 0) continue;

    segments.push({
      aLatRad,
      aLngRad,
      cosLat0,
      dx,
      dy,
      len,
      lenSq,
      cumStart: cum,
    });

    cum += len;
  }

  const scaleToSummaryDistance = cum > 0 ? summaryDistanceMeters / cum : 1;

  return { segments, scaleToSummaryDistance };
}

function projectPointOntoRoute(
  pointLatDeg: number,
  pointLngDeg: number,
  routeIndex: RouteIndex
): { distanceToRouteMeters: number; distanceAlongRouteMeters: number } | null {
  const latRad = degreesToRadians(pointLatDeg);
  const lngRad = degreesToRadians(pointLngDeg);

  let bestDistance = Infinity;
  let bestAlongMeters = 0;

  for (const seg of routeIndex.segments) {
    const px = (lngRad - seg.aLngRad) * seg.cosLat0 * EARTH_RADIUS_METERS;
    const py = (latRad - seg.aLatRad) * EARTH_RADIUS_METERS;

    const tRaw = (px * seg.dx + py * seg.dy) / seg.lenSq;
    const t = Math.min(1, Math.max(0, tRaw));

    const cx = px - t * seg.dx;
    const cy = py - t * seg.dy;
    const distance = Math.hypot(cx, cy);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlongMeters = (seg.cumStart + t * seg.len) * routeIndex.scaleToSummaryDistance;
    }
  }

  if (!Number.isFinite(bestDistance)) return null;

  return {
    distanceToRouteMeters: bestDistance,
    distanceAlongRouteMeters: bestAlongMeters,
  };
}

async function getStationsInBounds(bounds: Bounds): Promise<StationRow[]> {
  const result = await pool.query<StationRow>(
    `
      SELECT *
      FROM stations
      WHERE latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
    `,
    [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng]
  );
  return result.rows;
}

async function getStationsAlongRoute(options: {
  geometry: [number, number][];
  routeDistanceMeters: number;
  corridorMiles: number;
}): Promise<StationAlongRoute[]> {
  const corridorMeters = milesToMeters(options.corridorMiles);
  const bounds = computeBounds(options.geometry, corridorMeters);
  const candidates = await getStationsInBounds(bounds);
  const routeIndex = buildRouteIndex(options.geometry, options.routeDistanceMeters);

  const stations: StationAlongRoute[] = [];

  for (const station of candidates) {
    if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) continue;
    if (!Number.isFinite(station.ev_dc_fast_num) || station.ev_dc_fast_num <= 0) continue;

    const projection = projectPointOntoRoute(station.latitude, station.longitude, routeIndex);
    if (!projection) continue;
    if (projection.distanceToRouteMeters > corridorMeters) continue;

    stations.push({
      ...station,
      ev_connector_types: station.ev_connector_types ?? [],
      distance_to_route_miles: metersToMiles(projection.distanceToRouteMeters),
      distance_along_route_miles: metersToMiles(projection.distanceAlongRouteMeters),
      distance_from_prev_miles: 0,
      distance_to_next_miles: 0,
    });
  }

  stations.sort((a, b) => a.distance_along_route_miles - b.distance_along_route_miles);

  const totalMiles = metersToMiles(options.routeDistanceMeters);
  for (let i = 0; i < stations.length; i += 1) {
    const current = stations[i]!;
    const prev = i > 0 ? stations[i - 1]! : null;
    const next = i < stations.length - 1 ? stations[i + 1]! : null;

    const prevDistance = prev ? prev.distance_along_route_miles : 0;
    const nextDistance = next ? next.distance_along_route_miles : totalMiles;

    current.distance_from_prev_miles = Math.max(0, current.distance_along_route_miles - prevDistance);
    current.distance_to_next_miles = Math.max(0, nextDistance - current.distance_along_route_miles);
  }

  return stations;
}

function computeMaxGapMiles(stations: StationAlongRoute[], totalRouteMiles: number): number {
  if (stations.length === 0) return totalRouteMiles;

  let maxGap = Math.max(0, stations[0]!.distance_along_route_miles);
  for (let i = 1; i < stations.length; i += 1) {
    const gap = stations[i]!.distance_along_route_miles - stations[i - 1]!.distance_along_route_miles;
    if (gap > maxGap) maxGap = gap;
  }
  const endGap = Math.max(0, totalRouteMiles - stations[stations.length - 1]!.distance_along_route_miles);
  if (endGap > maxGap) maxGap = endGap;

  return maxGap;
}

function isOrsAlternativeRouteLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { orsStatus?: unknown }).orsStatus;
  const code = (error as { orsCode?: unknown }).orsCode;
  if (status === 400 && code === 2004) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('approximated route distance') && message.includes('150000');
}

router.post('/', async (req, res) => {
  try {
    const start = ensureString((req.body as { start?: unknown } | undefined)?.start);
    const end = ensureString((req.body as { end?: unknown } | undefined)?.end);
    const rawWaypoints = (req.body as { waypoints?: unknown } | undefined)?.waypoints;
    const rawCorridorMiles = (req.body as { corridorMiles?: unknown; corridor_miles?: unknown } | undefined)?.corridorMiles
      ?? (req.body as { corridorMiles?: unknown; corridor_miles?: unknown } | undefined)?.corridor_miles;
    const includeStationsRaw = (req.body as { includeStations?: unknown } | undefined)?.includeStations;
    const preferenceRaw = ensureString((req.body as { preference?: unknown } | undefined)?.preference);

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required' });
    }

    let waypoints: string[] = [];
    if (rawWaypoints !== undefined) {
      if (!Array.isArray(rawWaypoints)) {
        return res.status(400).json({ error: 'waypoints must be an array of strings' });
      }
      waypoints = rawWaypoints
        .map((w) => ensureString(w))
        .filter((w): w is string => Boolean(w));
    }

    if (waypoints.length > 10) {
      return res.status(400).json({ error: 'Too many waypoints (max 10)' });
    }

    const queries = [start, ...waypoints, end];
    const points = await Promise.all(queries.map((q) => geocodeOrs(q)));

    const missingIndex = points.findIndex((p) => p === null);
    if (missingIndex !== -1) {
      return res.status(404).json({ error: `Could not geocode: "${queries[missingIndex]}"` });
    }

    const resolvedPoints = points as GeocodedPoint[];
    const coords = resolvedPoints.map((p) => [p.lng, p.lat] as [number, number]);
    const corridorMiles = Math.max(0, ensureNumber(rawCorridorMiles) ?? 15);
    const includeStations = includeStationsRaw === undefined ? true : includeStationsRaw !== false;
    const requestedPreference = preferenceRaw === 'charger_optimized' ? 'charger_optimized' : 'fastest';
    let preference: 'fastest' | 'charger_optimized' = requestedPreference;
    let warning: string | undefined;

    let candidates: RouteResult[];
    try {
      candidates = await directionsOrsWithAlternatives({
        coordinates: coords,
        includeAlternatives: preference === 'charger_optimized',
      });
    } catch (error) {
      if (preference === 'charger_optimized' && isOrsAlternativeRouteLimitError(error)) {
        warning = 'DC optimized routing is not available for this route length; using the fastest route instead.';
        preference = 'fastest';
        candidates = await directionsOrsWithAlternatives({
          coordinates: coords,
          includeAlternatives: false,
        });
      } else {
        throw error;
      }
    }

    let chosen: RouteResult = candidates[0]!;
    let chosenStations: StationAlongRoute[] | undefined;
    let maxGapMiles: number | undefined;

    if (includeStations) {
      if (preference === 'charger_optimized') {
        const scored = await Promise.all(
          candidates.map(async (candidate) => {
            const stations = await getStationsAlongRoute({
              geometry: candidate.geometry,
              routeDistanceMeters: candidate.summary.distance_meters,
              corridorMiles,
            });
            const totalMiles = metersToMiles(candidate.summary.distance_meters);
            const maxGap = computeMaxGapMiles(stations, totalMiles);
            return {
              candidate,
              stations,
              stationCount: stations.length,
              maxGapMiles: maxGap,
            };
          })
        );

        scored.sort((a, b) => {
          if (b.stationCount !== a.stationCount) return b.stationCount - a.stationCount;
          if (a.maxGapMiles !== b.maxGapMiles) return a.maxGapMiles - b.maxGapMiles;
          return a.candidate.summary.distance_meters - b.candidate.summary.distance_meters;
        });

        const best = scored[0]!;
        chosen = best.candidate;
        chosenStations = best.stations;
        maxGapMiles = best.maxGapMiles;
      } else {
        chosenStations = await getStationsAlongRoute({
          geometry: chosen.geometry,
          routeDistanceMeters: chosen.summary.distance_meters,
          corridorMiles,
        });
        maxGapMiles = computeMaxGapMiles(chosenStations, metersToMiles(chosen.summary.distance_meters));
      }
    }

    const responseBody: RouteResponse = {
      points: resolvedPoints,
      summary: chosen.summary,
      geometry: chosen.geometry,
    };

    if (includeStations) {
      responseBody.corridor_miles = corridorMiles;
      responseBody.stations = chosenStations ?? [];
      responseBody.preference = preference;
      responseBody.requested_preference = requestedPreference;
      responseBody.candidates_evaluated = candidates.length;
      responseBody.max_gap_miles = maxGapMiles;
      responseBody.warning = warning;
    }

    return res.json(responseBody);
  } catch (error) {
    console.error('Error computing route:', error);
    return res.status(500).json({ error: `Failed to compute route: ${toErrorMessage(error)}` });
  }
});

export default router;
