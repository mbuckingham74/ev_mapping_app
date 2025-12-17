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

async function directionsOrs(coordinates: [number, number][]): Promise<{ summary: RouteSummary; geometry: [number, number][] }> {
  const apiKey = config.apiKeys.openRouteService;
  if (!apiKey) {
    throw new Error('OPENROUTESERVICE_API_KEY not set in environment');
  }

  const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: {
      Accept: 'application/geo+json',
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      coordinates: coordinates.map(([lng, lat]) => [lng, lat]),
      instructions: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouteService directions error: ${response.status} ${response.statusText}\n${text}`);
  }

  const data = (await response.json()) as unknown;
  if (!data || typeof data !== 'object') {
    throw new Error('Unexpected directions response: expected an object');
  }

  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error('Unexpected directions response: missing features');
  }

  const feature = features[0] as {
    geometry?: { coordinates?: unknown };
    properties?: { summary?: { distance?: unknown; duration?: unknown } };
  };

  const summary = feature.properties?.summary;
  const distance = summary?.distance;
  const duration = summary?.duration;
  if (typeof distance !== 'number' || typeof duration !== 'number') {
    throw new Error('Unexpected directions response: missing summary distance/duration');
  }

  const line = feature.geometry?.coordinates;
  if (!Array.isArray(line) || line.length === 0) {
    throw new Error('Unexpected directions response: missing geometry coordinates');
  }

  const geometry: [number, number][] = [];
  for (const point of line) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [lng, lat] = point;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    geometry.push([lat, lng]);
  }

  if (geometry.length === 0) {
    throw new Error('Unexpected directions response: empty geometry');
  }

  return {
    summary: {
      distance_meters: distance,
      duration_seconds: duration,
    },
    geometry,
  };
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

router.post('/', async (req, res) => {
  try {
    const start = ensureString((req.body as { start?: unknown } | undefined)?.start);
    const end = ensureString((req.body as { end?: unknown } | undefined)?.end);
    const rawWaypoints = (req.body as { waypoints?: unknown } | undefined)?.waypoints;
    const rawCorridorMiles = (req.body as { corridorMiles?: unknown; corridor_miles?: unknown } | undefined)?.corridorMiles
      ?? (req.body as { corridorMiles?: unknown; corridor_miles?: unknown } | undefined)?.corridor_miles;
    const includeStationsRaw = (req.body as { includeStations?: unknown } | undefined)?.includeStations;

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
    const route = await directionsOrs(coords);

    const corridorMiles = Math.max(0, ensureNumber(rawCorridorMiles) ?? 15);
    const includeStations = includeStationsRaw === undefined ? true : includeStationsRaw !== false;

    const responseBody: RouteResponse = {
      points: resolvedPoints,
      summary: route.summary,
      geometry: route.geometry,
    };

    if (includeStations) {
      responseBody.corridor_miles = corridorMiles;
      responseBody.stations = await getStationsAlongRoute({
        geometry: route.geometry,
        routeDistanceMeters: route.summary.distance_meters,
        corridorMiles,
      });
    }

    return res.json(responseBody);
  } catch (error) {
    console.error('Error computing route:', error);
    return res.status(500).json({ error: `Failed to compute route: ${toErrorMessage(error)}` });
  }
});

export default router;
