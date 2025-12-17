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
  auto_waypoints?: AutoWaypoint[];
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

type AutoWaypoint = {
  id: number;
  station_name: string;
  latitude: number;
  longitude: number;
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

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = degreesToRadians(lat1);
  const phi2 = degreesToRadians(lat2);
  const dPhi = degreesToRadians(lat2 - lat1);
  const dLambda = degreesToRadians(lng2 - lng1);

  const a = Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
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

function pointAtDistanceAlongRouteMeters(routeIndex: RouteIndex, targetDistanceMeters: number): [number, number] | null {
  if (!Number.isFinite(targetDistanceMeters)) return null;
  if (routeIndex.segments.length === 0) return null;

  const scale = routeIndex.scaleToSummaryDistance;
  const targetUnscaled = scale > 0 ? targetDistanceMeters / scale : targetDistanceMeters;

  if (targetUnscaled <= 0) {
    const first = routeIndex.segments[0]!;
    return [first.aLatRad * (180 / Math.PI), first.aLngRad * (180 / Math.PI)];
  }

  const lastSeg = routeIndex.segments[routeIndex.segments.length - 1]!;
  const totalUnscaled = lastSeg.cumStart + lastSeg.len;
  const clampedTarget = Math.min(targetUnscaled, totalUnscaled);

  for (const seg of routeIndex.segments) {
    const end = seg.cumStart + seg.len;
    if (clampedTarget > end) continue;

    const t = seg.len > 0 ? (clampedTarget - seg.cumStart) / seg.len : 0;
    const tClamped = Math.min(1, Math.max(0, t));

    const latRad = seg.aLatRad + (tClamped * seg.dy) / EARTH_RADIUS_METERS;
    const lngRad = seg.cosLat0 === 0
      ? seg.aLngRad
      : seg.aLngRad + (tClamped * seg.dx) / (seg.cosLat0 * EARTH_RADIUS_METERS);

    return [latRad * (180 / Math.PI), lngRad * (180 / Math.PI)];
  }

  return null;
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

function boundsAroundPoint(lat: number, lng: number, radiusMeters: number): Bounds {
  const padLat = radiusMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.cos(degreesToRadians(lat));
  const padLng = cosLat === 0 ? 180 : radiusMeters / (METERS_PER_DEGREE_LAT * Math.abs(cosLat));

  return {
    minLat: Math.max(-90, lat - padLat),
    maxLat: Math.min(90, lat + padLat),
    minLng: Math.max(-180, lng - padLng),
    maxLng: Math.min(180, lng + padLng),
  };
}

async function getStationsAlongRoute(options: {
  geometry: [number, number][];
  routeDistanceMeters: number;
  corridorMiles: number;
}): Promise<StationAlongRoute[]> {
  const corridorMeters = milesToMeters(options.corridorMiles);
  const routeIndex = buildRouteIndex(options.geometry, options.routeDistanceMeters);

  const stations: StationAlongRoute[] = [];

  function lineStringWktFromRoute(geometry: [number, number][]): string | null {
    const parts: string[] = [];
    for (const [lat, lng] of geometry) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      parts.push(`${lng.toFixed(6)} ${lat.toFixed(6)}`);
    }
    if (parts.length < 2) return null;
    return `LINESTRING(${parts.join(',')})`;
  }

  type StationDistanceRow = StationRow & { distance_to_route_meters: number };

  async function getStationsNearRoutePostgis(): Promise<StationDistanceRow[]> {
    const lineWkt = lineStringWktFromRoute(options.geometry);
    if (!lineWkt) return [];

    const result = await pool.query<StationDistanceRow>(
      `
        WITH route AS (
          SELECT ST_GeomFromText($1, 4326)::geography AS geog
        )
        SELECT
          s.*,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326)::geography,
            route.geog
          ) AS distance_to_route_meters
        FROM stations s, route
        WHERE s.ev_dc_fast_num > 0
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326)::geography,
            route.geog,
            $2
          )
      `,
      [lineWkt, corridorMeters]
    );

    return result.rows;
  }

  let candidates: Array<StationRow | StationDistanceRow>;
  let usingPostgisDistance = false;

  try {
    candidates = await getStationsNearRoutePostgis();
    usingPostgisDistance = true;
  } catch (error) {
    console.warn('PostGIS route corridor query failed; falling back to bounding-box filter:', error);
    const bounds = computeBounds(options.geometry, corridorMeters);
    candidates = await getStationsInBounds(bounds);
    usingPostgisDistance = false;
  }

  for (const station of candidates) {
    if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) continue;
    if (!Number.isFinite(station.ev_dc_fast_num) || station.ev_dc_fast_num <= 0) continue;

    const projection = projectPointOntoRoute(station.latitude, station.longitude, routeIndex);
    if (!projection) continue;

    let distanceToRouteMiles: number;
    if (usingPostgisDistance) {
      const row = station as StationDistanceRow;
      if (!Number.isFinite(row.distance_to_route_meters)) continue;
      distanceToRouteMiles = metersToMiles(row.distance_to_route_meters);
      if (row.distance_to_route_meters > corridorMeters) continue;
    } else {
      if (projection.distanceToRouteMeters > corridorMeters) continue;
      distanceToRouteMiles = metersToMiles(projection.distanceToRouteMeters);
    }

    let baseStation: StationRow;
    if (usingPostgisDistance) {
      const { distance_to_route_meters: _distance, ...rest } = station as StationDistanceRow;
      baseStation = rest;
    } else {
      baseStation = station as StationRow;
    }

    stations.push({
      ...baseStation,
      ev_connector_types: station.ev_connector_types ?? [],
      distance_to_route_miles: distanceToRouteMiles,
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

type RouteGap = {
  startMiles: number;
  endMiles: number;
  lengthMiles: number;
  midMiles: number;
};

function computeLargestGaps(stations: StationAlongRoute[], totalRouteMiles: number, take: number): RouteGap[] {
  const gaps: RouteGap[] = [];

  if (stations.length === 0) {
    return [{
      startMiles: 0,
      endMiles: totalRouteMiles,
      lengthMiles: totalRouteMiles,
      midMiles: totalRouteMiles / 2,
    }];
  }

  const firstMile = Math.max(0, stations[0]!.distance_along_route_miles);
  gaps.push({
    startMiles: 0,
    endMiles: firstMile,
    lengthMiles: firstMile,
    midMiles: firstMile / 2,
  });

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a = stations[i]!.distance_along_route_miles;
    const b = stations[i + 1]!.distance_along_route_miles;
    const startMiles = Math.max(0, a);
    const endMiles = Math.max(startMiles, b);
    const lengthMiles = endMiles - startMiles;
    gaps.push({
      startMiles,
      endMiles,
      lengthMiles,
      midMiles: startMiles + lengthMiles / 2,
    });
  }

  const lastMile = Math.max(0, stations[stations.length - 1]!.distance_along_route_miles);
  const endGap = Math.max(0, totalRouteMiles - lastMile);
  gaps.push({
    startMiles: lastMile,
    endMiles: totalRouteMiles,
    lengthMiles: endGap,
    midMiles: lastMile + endGap / 2,
  });

  return gaps
    .filter((g) => Number.isFinite(g.lengthMiles) && g.lengthMiles > 0)
    .sort((a, b) => b.lengthMiles - a.lengthMiles)
    .slice(0, Math.max(1, take));
}

async function findCandidateWaypointsNearGaps(options: {
  routeIndex: RouteIndex;
  routeDistanceMeters: number;
  gaps: RouteGap[];
  corridorMiles: number;
  excludeStationIds: Set<number>;
  limit: number;
}): Promise<AutoWaypoint[]> {
  const radiusMiles = Math.min(80, Math.max(30, options.corridorMiles * 2));
  const radiusMeters = milesToMeters(radiusMiles);

  const candidates: { waypoint: AutoWaypoint; score: number }[] = [];
  const seen = new Set<number>();

  for (const gap of options.gaps) {
    const midMeters = milesToMeters(gap.midMiles);
    const center = pointAtDistanceAlongRouteMeters(options.routeIndex, midMeters);
    if (!center) continue;
    const [centerLat, centerLng] = center;

    const bounds = boundsAroundPoint(centerLat, centerLng, radiusMeters);
    const nearby = await getStationsInBounds(bounds);

    for (const station of nearby) {
      if (options.excludeStationIds.has(station.id)) continue;
      if (seen.has(station.id)) continue;
      if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) continue;
      if (!Number.isFinite(station.ev_dc_fast_num) || station.ev_dc_fast_num <= 0) continue;

      const distanceMeters = haversineDistanceMeters(centerLat, centerLng, station.latitude, station.longitude);
      if (distanceMeters > radiusMeters) continue;

      const distanceMiles = metersToMiles(distanceMeters);
      const power = typeof station.max_power_kw === 'number' && Number.isFinite(station.max_power_kw) ? station.max_power_kw : 0;

      // Prefer closer stations; break ties with higher power and more stalls.
      const score = (distanceMiles * 10) - (power / 100) - Math.min(10, station.ev_dc_fast_num);

      seen.add(station.id);
      candidates.push({
        waypoint: {
          id: station.id,
          station_name: station.station_name,
          latitude: station.latitude,
          longitude: station.longitude,
        },
        score,
      });
    }
  }

  return candidates
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.max(1, options.limit))
    .map((c) => c.waypoint);
}

type ScoredRoute = {
  route: RouteResult;
  stations: StationAlongRoute[];
  stationCount: number;
  maxGapMiles: number;
  distanceMeters: number;
  viaCoords: [number, number][];
  autoWaypoint?: AutoWaypoint;
};

function compareScoredRoutes(a: ScoredRoute, b: ScoredRoute, targetMaxGapMiles: number): number {
  const aOk = a.maxGapMiles <= targetMaxGapMiles;
  const bOk = b.maxGapMiles <= targetMaxGapMiles;

  if (aOk !== bOk) return aOk ? -1 : 1;

  if (aOk && bOk) {
    if (b.stationCount !== a.stationCount) return b.stationCount - a.stationCount;
    if (a.maxGapMiles !== b.maxGapMiles) return a.maxGapMiles - b.maxGapMiles;
    return a.distanceMeters - b.distanceMeters;
  }

  if (a.maxGapMiles !== b.maxGapMiles) return a.maxGapMiles - b.maxGapMiles;
  if (b.stationCount !== a.stationCount) return b.stationCount - a.stationCount;
  return a.distanceMeters - b.distanceMeters;
}

function computeInsertIndexByAlongDistance(options: {
  routeIndex: RouteIndex;
  existingCoords: [number, number][];
  targetAlongMeters: number;
}): number {
  const projections = options.existingCoords.map(([lng, lat], index) => {
    const projection = projectPointOntoRoute(lat, lng, options.routeIndex);
    const along = projection ? projection.distanceAlongRouteMeters : index === 0 ? 0 : Infinity;
    return { index, along };
  });

  for (let i = 1; i < projections.length; i += 1) {
    if (projections[i]!.along > options.targetAlongMeters) return i;
  }

  return Math.max(1, options.existingCoords.length - 1);
}

async function optimizeRouteWithAutoWaypoints(options: {
  baseRoute: RouteResult;
  baseViaCoords: [number, number][];
  corridorMiles: number;
  rangeMiles: number;
  maxDetourFactor: number;
}): Promise<{
  chosen: RouteResult;
  chosenStations: StationAlongRoute[];
  maxGapMiles: number;
  autoWaypoints: AutoWaypoint[];
  evaluatedRoutes: number;
  warning?: string;
}> {
  const reserveMiles = 30;
  const targetMaxGapMiles = Math.max(0, options.rangeMiles - reserveMiles);
  const maxAutoWaypoints = 2;

  const baseStations = await getStationsAlongRoute({
    geometry: options.baseRoute.geometry,
    routeDistanceMeters: options.baseRoute.summary.distance_meters,
    corridorMiles: options.corridorMiles,
  });
  const baseMaxGap = computeMaxGapMiles(baseStations, metersToMiles(options.baseRoute.summary.distance_meters));

  const baseScore: ScoredRoute = {
    route: options.baseRoute,
    stations: baseStations,
    stationCount: baseStations.length,
    maxGapMiles: baseMaxGap,
    distanceMeters: options.baseRoute.summary.distance_meters,
    viaCoords: options.baseViaCoords,
  };

  const baseDistanceMeters = options.baseRoute.summary.distance_meters;
  const distanceLimitMeters = baseDistanceMeters * Math.max(1, options.maxDetourFactor);

  let current = baseScore;
  let currentViaCoords = options.baseViaCoords;
  let currentRouteIndex = buildRouteIndex(options.baseRoute.geometry, options.baseRoute.summary.distance_meters);
  const autoWaypoints: AutoWaypoint[] = [];
  let evaluatedRoutes = 1;

  for (let iteration = 0; iteration < maxAutoWaypoints; iteration += 1) {
    const totalMiles = metersToMiles(current.route.summary.distance_meters);
    const gaps = computeLargestGaps(current.stations, totalMiles, 2);

    const exclude = new Set<number>(current.stations.map((s) => s.id));
    for (const w of autoWaypoints) exclude.add(w.id);

    const candidateWaypoints = await findCandidateWaypointsNearGaps({
      routeIndex: currentRouteIndex,
      routeDistanceMeters: current.route.summary.distance_meters,
      gaps,
      corridorMiles: options.corridorMiles,
      excludeStationIds: exclude,
      limit: 8,
    });

    if (candidateWaypoints.length === 0) break;

    const candidates: ScoredRoute[] = [];

    for (const candidate of candidateWaypoints) {
      const candidateCoord: [number, number] = [candidate.longitude, candidate.latitude];

      // Insert near the largest gap midpoint.
      const targetMidMiles = gaps[0]?.midMiles ?? totalMiles / 2;
      const targetAlongMeters = milesToMeters(targetMidMiles);

      const insertIndex = computeInsertIndexByAlongDistance({
        routeIndex: currentRouteIndex,
        existingCoords: currentViaCoords,
        targetAlongMeters,
      });

      const viaCoords: [number, number][] = [
        ...currentViaCoords.slice(0, insertIndex),
        candidateCoord,
        ...currentViaCoords.slice(insertIndex),
      ];

      // Avoid degenerate duplicates.
      if (viaCoords.length >= 2) {
        const prev = viaCoords[insertIndex - 1]!;
        if (prev[0] === candidateCoord[0] && prev[1] === candidateCoord[1]) continue;
        const next = viaCoords[insertIndex + 1];
        if (next && next[0] === candidateCoord[0] && next[1] === candidateCoord[1]) continue;
      }

      const routes = await directionsOrsWithAlternatives({ coordinates: viaCoords, includeAlternatives: false });
      evaluatedRoutes += 1;

      const route = routes[0]!;
      if (route.summary.distance_meters > distanceLimitMeters) continue;

      const stations = await getStationsAlongRoute({
        geometry: route.geometry,
        routeDistanceMeters: route.summary.distance_meters,
        corridorMiles: options.corridorMiles,
      });
      const maxGapMiles = computeMaxGapMiles(stations, metersToMiles(route.summary.distance_meters));

      candidates.push({
        route,
        stations,
        stationCount: stations.length,
        maxGapMiles,
        distanceMeters: route.summary.distance_meters,
        viaCoords,
        autoWaypoint: candidate,
      });
    }

    if (candidates.length === 0) break;

    candidates.sort((a, b) => compareScoredRoutes(a, b, targetMaxGapMiles));
    const best = candidates[0]!;

    const improved = compareScoredRoutes(best, current, targetMaxGapMiles) < 0;
    if (!improved) break;

    current = best;
    currentViaCoords = best.viaCoords;
    currentRouteIndex = buildRouteIndex(best.route.geometry, best.route.summary.distance_meters);
    if (best.autoWaypoint) autoWaypoints.push(best.autoWaypoint);

    // Stop early if we're within the gap target and already have strong coverage.
    if (current.maxGapMiles <= targetMaxGapMiles && iteration >= 0) {
      break;
    }
  }

  let warning: string | undefined;
  if (current.maxGapMiles > targetMaxGapMiles) {
    if (autoWaypoints.length === 0) {
      warning = 'Could not find a better charger-optimized route within the detour limits; using the fastest route instead.';
    } else {
      warning = `Charger-optimized route found, but max gap is still ${Math.round(current.maxGapMiles)} mi (target ≤ ${Math.round(targetMaxGapMiles)} mi).`;
    }
  }

  return {
    chosen: current.route,
    chosenStations: current.stations,
    maxGapMiles: current.maxGapMiles,
    autoWaypoints,
    evaluatedRoutes,
    warning,
  };
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
    const rawRangeMiles = (req.body as { rangeMiles?: unknown; range_miles?: unknown } | undefined)?.rangeMiles
      ?? (req.body as { rangeMiles?: unknown; range_miles?: unknown } | undefined)?.range_miles;
    const rawMaxDetourFactor = (req.body as { maxDetourFactor?: unknown; max_detour_factor?: unknown } | undefined)?.maxDetourFactor
      ?? (req.body as { maxDetourFactor?: unknown; max_detour_factor?: unknown } | undefined)?.max_detour_factor;

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
    const rangeMiles = Math.max(0, ensureNumber(rawRangeMiles) ?? 210);
    const maxDetourFactor = Math.max(1, ensureNumber(rawMaxDetourFactor) ?? 1.25);

    let candidates: RouteResult[];
    let orsAlternativesUnavailable = false;
    try {
      candidates = await directionsOrsWithAlternatives({
        coordinates: coords,
        includeAlternatives: preference === 'charger_optimized',
      });
    } catch (error) {
      if (preference === 'charger_optimized' && isOrsAlternativeRouteLimitError(error)) {
        // Workaround for long routes: run our own waypoint-based optimization.
        orsAlternativesUnavailable = true;
        const baseCandidates = await directionsOrsWithAlternatives({
          coordinates: coords,
          includeAlternatives: false,
        });
        candidates = baseCandidates;
      } else {
        throw error;
      }
    }

    let chosen: RouteResult = candidates[0]!;
    let chosenStations: StationAlongRoute[] | undefined;
    let maxGapMiles: number | undefined;
    let autoWaypoints: AutoWaypoint[] = [];
    let evaluatedRoutes = candidates.length;

    if (includeStations) {
      if (preference === 'charger_optimized') {
        const canScoreAlternatives = candidates.length > 1;
        if (!canScoreAlternatives) {
          // If we only have a single candidate (e.g. long routes where ORS can't return alternatives),
          // run a waypoint-based optimizer to improve charger coverage.
          const optimized = await optimizeRouteWithAutoWaypoints({
            baseRoute: chosen,
            baseViaCoords: coords,
            corridorMiles,
            rangeMiles,
            maxDetourFactor,
          });
          chosen = optimized.chosen;
          chosenStations = optimized.chosenStations;
          maxGapMiles = optimized.maxGapMiles;
          autoWaypoints = optimized.autoWaypoints;
          evaluatedRoutes = optimized.evaluatedRoutes;
          warning = optimized.warning;

          const targetMaxGapMiles = Math.max(0, rangeMiles - 30);
          // Treat as charger-optimized if we either added waypoints OR the fastest route already satisfies the gap target.
          preference = (autoWaypoints.length > 0 || optimized.maxGapMiles <= targetMaxGapMiles)
            ? 'charger_optimized'
            : 'fastest';

          // Keep the more specific warning (if any), otherwise leave it empty.
          if (!warning && orsAlternativesUnavailable) {
            // No warning needed; this is expected for long routes and we still return a route.
          }
        } else {
          const targetMaxGapMiles = Math.max(0, rangeMiles - 30);
          const scored: ScoredRoute[] = [];

          for (const candidate of candidates) {
            const stations = await getStationsAlongRoute({
              geometry: candidate.geometry,
              routeDistanceMeters: candidate.summary.distance_meters,
              corridorMiles,
            });
            const totalMiles = metersToMiles(candidate.summary.distance_meters);
            const maxGap = computeMaxGapMiles(stations, totalMiles);
            scored.push({
              route: candidate,
              stations,
              stationCount: stations.length,
              maxGapMiles: maxGap,
              distanceMeters: candidate.summary.distance_meters,
              viaCoords: coords,
            });
          }

          scored.sort((a, b) => compareScoredRoutes(a, b, targetMaxGapMiles));
          const best = scored[0]!;
          chosen = best.route;
          chosenStations = best.stations;
          maxGapMiles = best.maxGapMiles;
          evaluatedRoutes = candidates.length;
        }
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
      responseBody.candidates_evaluated = evaluatedRoutes;
      responseBody.max_gap_miles = maxGapMiles;
      responseBody.warning = warning;
      if (autoWaypoints.length > 0) {
        responseBody.auto_waypoints = autoWaypoints;
      }
    }

    return res.json(responseBody);
  } catch (error) {
    console.error('Error computing route:', error);
    return res.status(500).json({ error: `Failed to compute route: ${toErrorMessage(error)}` });
  }
});

export default router;
