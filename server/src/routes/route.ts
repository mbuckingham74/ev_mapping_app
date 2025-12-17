import { Router } from 'express';
import { config } from '../config.js';
import { pool } from '../db.js';
import {
  getCachedDirections,
  getCachedGeocode,
  getCachedRouteResponse,
  makeDirectionsCacheKey,
  makeGeocodeCacheKey,
  makeRouteResponseCacheKey,
  setCachedDirections,
  setCachedGeocode,
  setCachedRouteResponse,
} from '../cache.js';

const router = Router();

const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_DEGREE_LAT = 111_320;
const FEET_PER_METER = 3.28084;

type GeocodedPoint = {
  query: string;
  label: string;
  lat: number;
  lng: number;
};

type RouteSummary = {
  distance_meters: number;
  duration_seconds: number;
  elevation_gain_ft?: number;
  elevation_loss_ft?: number;
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
  elevation_from_prev_ft?: number;
  elevation_to_next_ft?: number;
  rank_score?: number;
  rank?: number;
  rank_tier?: 'A' | 'B' | 'C' | 'D';
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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function computeTargetMaxGapMiles(rangeMiles: number, minArrivalPercent: number): number {
  const range = Math.max(0, rangeMiles);
  const pct = clampPercent(minArrivalPercent);
  return Math.max(0, range * (1 - pct / 100));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stationRankTier(score: number): 'A' | 'B' | 'C' | 'D' {
  if (!Number.isFinite(score)) return 'D';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

function computeStationRankScore(station: StationAlongRoute, corridorMiles: number): number {
  const powerKw = typeof station.max_power_kw === 'number' && Number.isFinite(station.max_power_kw)
    ? Math.max(0, station.max_power_kw)
    : 0;
  const stalls = Number.isFinite(station.ev_dc_fast_num) ? Math.max(0, station.ev_dc_fast_num) : 0;
  const offRouteMiles = Number.isFinite(station.distance_to_route_miles) ? Math.max(0, station.distance_to_route_miles) : 0;

  const powerScore = clamp01(powerKw / 350);
  const stallsScore = clamp01(stalls / 10);
  const offRouteScore = corridorMiles > 0 ? clamp01(1 - offRouteMiles / corridorMiles) : 1;
  const statusMultiplier = station.status_code === 'E' ? 1 : 0.4;

  const weighted = (powerScore * 0.5) + (stallsScore * 0.35) + (offRouteScore * 0.15);
  const score = Math.round(clamp01(weighted) * 100 * statusMultiplier);
  return Math.max(0, Math.min(100, score));
}

function applyStationRanking(stations: StationAlongRoute[], corridorMiles: number): void {
  for (const station of stations) {
    const score = computeStationRankScore(station, corridorMiles);
    station.rank_score = score;
    station.rank_tier = stationRankTier(score);
  }

  const ranked = [...stations].sort((a, b) => {
    const scoreA = a.rank_score ?? 0;
    const scoreB = b.rank_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;

    const powerA = typeof a.max_power_kw === 'number' && Number.isFinite(a.max_power_kw) ? a.max_power_kw : 0;
    const powerB = typeof b.max_power_kw === 'number' && Number.isFinite(b.max_power_kw) ? b.max_power_kw : 0;
    if (powerB !== powerA) return powerB - powerA;

    const stallsA = Number.isFinite(a.ev_dc_fast_num) ? a.ev_dc_fast_num : 0;
    const stallsB = Number.isFinite(b.ev_dc_fast_num) ? b.ev_dc_fast_num : 0;
    if (stallsB !== stallsA) return stallsB - stallsA;

    if (a.distance_to_route_miles !== b.distance_to_route_miles) return a.distance_to_route_miles - b.distance_to_route_miles;
    return a.distance_along_route_miles - b.distance_along_route_miles;
  });

  for (let i = 0; i < ranked.length; i += 1) {
    ranked[i]!.rank = i + 1;
  }
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

function segmentLengthMetersApprox(aLatDeg: number, aLngDeg: number, bLatDeg: number, bLngDeg: number): number {
  const aLatRad = degreesToRadians(aLatDeg);
  const aLngRad = degreesToRadians(aLngDeg);
  const bLatRad = degreesToRadians(bLatDeg);
  const bLngRad = degreesToRadians(bLngDeg);

  const lat0 = (aLatRad + bLatRad) / 2;
  const cosLat0 = Math.cos(lat0);

  const dx = (bLngRad - aLngRad) * cosLat0 * EARTH_RADIUS_METERS;
  const dy = (bLatRad - aLatRad) * EARTH_RADIUS_METERS;
  return Math.hypot(dx, dy);
}

function computeRouteElevationTotalsFeet(route: RouteResult): { elevation_gain_ft: number; elevation_loss_ft: number } | null {
  const elevations = route.elevations_meters;
  if (!elevations || elevations.length < 2) return null;

  let gainMeters = 0;
  let lossMeters = 0;

  for (let i = 1; i < elevations.length; i += 1) {
    const prev = elevations[i - 1];
    const next = elevations[i];
    if (typeof prev !== 'number' || typeof next !== 'number') return null;
    if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
    const delta = next - prev;
    if (delta > 0) gainMeters += delta;
    else lossMeters += -delta;
  }

  return {
    elevation_gain_ft: Math.round(gainMeters * FEET_PER_METER),
    elevation_loss_ft: Math.round(lossMeters * FEET_PER_METER),
  };
}

type RouteElevationProfile = {
  distances_meters: number[];
  elevations_meters: number[];
};

function buildRouteElevationProfile(route: RouteResult): RouteElevationProfile | null {
  const elevations = route.elevations_meters;
  if (!elevations || elevations.length !== route.geometry.length) return null;
  if (route.geometry.length === 0) return null;
  if (!Number.isFinite(route.summary.distance_meters) || route.summary.distance_meters < 0) return null;

  const unscaled: number[] = new Array(route.geometry.length);
  unscaled[0] = 0;
  let totalUnscaled = 0;

  for (let i = 0; i < route.geometry.length - 1; i += 1) {
    const [aLat, aLng] = route.geometry[i]!;
    const [bLat, bLng] = route.geometry[i + 1]!;
    const len = segmentLengthMetersApprox(aLat, aLng, bLat, bLng);
    if (Number.isFinite(len) && len > 0) totalUnscaled += len;
    unscaled[i + 1] = totalUnscaled;
  }

  const scale = totalUnscaled > 0 ? route.summary.distance_meters / totalUnscaled : 1;
  const distances: number[] = [];
  const profileElevations: number[] = [];

  for (let i = 0; i < unscaled.length; i += 1) {
    const elevation = elevations[i];
    if (typeof elevation !== 'number' || !Number.isFinite(elevation)) return null;

    let distance = unscaled[i]! * scale;
    if (i === unscaled.length - 1) distance = route.summary.distance_meters;

    if (distances.length === 0) {
      distances.push(distance);
      profileElevations.push(elevation);
      continue;
    }

    const lastDistance = distances[distances.length - 1]!;
    if (distance > lastDistance) {
      distances.push(distance);
      profileElevations.push(elevation);
      continue;
    }

    distances[distances.length - 1] = Math.max(lastDistance, distance);
    profileElevations[profileElevations.length - 1] = elevation;
  }

  return distances.length > 0
    ? { distances_meters: distances, elevations_meters: profileElevations }
    : null;
}

function elevationAtDistanceMeters(profile: RouteElevationProfile, targetMeters: number): number | null {
  const distances = profile.distances_meters;
  const elevations = profile.elevations_meters;
  if (distances.length === 0 || elevations.length !== distances.length) return null;

  const lastDistance = distances[distances.length - 1]!;
  const target = Math.max(0, Math.min(lastDistance, targetMeters));

  if (target <= distances[0]!) return elevations[0]!;
  if (target >= lastDistance) return elevations[elevations.length - 1]!;

  let lo = 0;
  let hi = distances.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (distances[mid]! < target) lo = mid + 1;
    else hi = mid;
  }

  const i1 = lo;
  const i0 = Math.max(0, i1 - 1);
  const d0 = distances[i0]!;
  const d1 = distances[i1]!;
  const e0 = elevations[i0]!;
  const e1 = elevations[i1]!;

  if (d1 <= d0) return e1;
  const t = (target - d0) / (d1 - d0);
  return e0 + (e1 - e0) * t;
}

function applyStationElevationDeltas(stations: StationAlongRoute[], route: RouteResult): void {
  if (stations.length === 0) return;
  const profile = buildRouteElevationProfile(route);
  if (!profile) return;

  const totalDistanceMeters = route.summary.distance_meters;

  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i]!;
    const prevDistanceMeters = i > 0 ? milesToMeters(stations[i - 1]!.distance_along_route_miles) : 0;
    const currentDistanceMeters = milesToMeters(station.distance_along_route_miles);
    const nextDistanceMeters = i < stations.length - 1
      ? milesToMeters(stations[i + 1]!.distance_along_route_miles)
      : totalDistanceMeters;

    const prevElevationMeters = elevationAtDistanceMeters(profile, prevDistanceMeters);
    const currentElevationMeters = elevationAtDistanceMeters(profile, currentDistanceMeters);
    const nextElevationMeters = elevationAtDistanceMeters(profile, nextDistanceMeters);

    if (prevElevationMeters !== null && currentElevationMeters !== null) {
      const deltaFeet = Math.round((currentElevationMeters - prevElevationMeters) * FEET_PER_METER);
      station.elevation_from_prev_ft = deltaFeet === 0 ? 0 : deltaFeet;
    }

    if (currentElevationMeters !== null && nextElevationMeters !== null) {
      const deltaFeet = Math.round((nextElevationMeters - currentElevationMeters) * FEET_PER_METER);
      station.elevation_to_next_ft = deltaFeet === 0 ? 0 : deltaFeet;
    }
  }
}

async function geocodeOrs(query: string): Promise<GeocodedPoint | null> {
  const apiKey = config.apiKeys.openRouteService;
  if (!apiKey) {
    throw new Error('OPENROUTESERVICE_API_KEY not set in environment');
  }

  const geocodeTtlDays = config.cache.geocodeTtlDays;
  const geocodeCacheKey = geocodeTtlDays > 0 ? makeGeocodeCacheKey(query) : null;
  if (geocodeCacheKey) {
    const cached = await getCachedGeocode(geocodeCacheKey);
    if (cached) {
      return {
        query,
        label: cached.label,
        lat: cached.lat,
        lng: cached.lng,
      };
    }
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

  const result: GeocodedPoint = {
    query,
    label,
    lat,
    lng,
  };

  if (geocodeCacheKey) {
    await setCachedGeocode({
      cacheKey: geocodeCacheKey,
      queryText: query,
      label: result.label,
      lat: result.lat,
      lng: result.lng,
      ttlDays: geocodeTtlDays,
    });
  }

  return result;
}

type RouteResult = { summary: RouteSummary; geometry: [number, number][]; elevations_meters?: number[] };

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
  const elevations: number[] = [];
  let hasElevation = true;
  for (const point of line) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [lng, lat, elevation] = point;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    geometry.push([lat, lng]);
    if (typeof elevation === 'number' && Number.isFinite(elevation)) {
      elevations.push(elevation);
    } else {
      hasElevation = false;
    }
  }
  if (geometry.length === 0) return null;

  return {
    summary: {
      distance_meters: distance,
      duration_seconds: duration,
    },
    geometry,
    elevations_meters: hasElevation && elevations.length === geometry.length ? elevations : undefined,
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

  const directionsTtlDays = config.cache.directionsTtlDays;
  const directionsCacheKey = directionsTtlDays > 0 ? makeDirectionsCacheKey(options) : null;

  function parseCachedRoutes(value: unknown): RouteResult[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const parsed: RouteResult[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const summary = (entry as { summary?: unknown }).summary as { distance_meters?: unknown; duration_seconds?: unknown } | undefined;
      const distance = summary?.distance_meters;
      const duration = summary?.duration_seconds;
      if (typeof distance !== 'number' || !Number.isFinite(distance)) continue;
      if (typeof duration !== 'number' || !Number.isFinite(duration)) continue;

      const geometryRaw = (entry as { geometry?: unknown }).geometry;
      if (!Array.isArray(geometryRaw) || geometryRaw.length === 0) continue;
      const geometry: [number, number][] = [];
      for (const point of geometryRaw) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const [lat, lng] = point;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        geometry.push([lat, lng]);
      }
      if (geometry.length === 0) continue;

      const elevationsRaw = (entry as { elevations_meters?: unknown }).elevations_meters;
      const elevations = Array.isArray(elevationsRaw) ? elevationsRaw.filter((n) => typeof n === 'number' && Number.isFinite(n)) : null;
      const elevations_meters = elevations && elevations.length === geometry.length ? elevations : undefined;

      parsed.push({
        summary: { distance_meters: distance, duration_seconds: duration },
        geometry,
        elevations_meters,
      });
    }
    return parsed.length > 0 ? parsed : null;
  }

  if (directionsCacheKey) {
    const cached = await getCachedDirections(directionsCacheKey);
    const parsed = parseCachedRoutes(cached);
    if (parsed) return parsed;
  }

  const body: Record<string, unknown> = {
    coordinates: options.coordinates.map(([lng, lat]) => [lng, lat]),
    instructions: false,
    elevation: true,
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

  if (directionsCacheKey) {
    await setCachedDirections({
      cacheKey: directionsCacheKey,
      requestJson: body,
      routesJson: routes,
      ttlDays: directionsTtlDays,
    });
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
  minArrivalPercent: number;
  maxDetourFactor: number;
}): Promise<{
  chosen: RouteResult;
  chosenStations: StationAlongRoute[];
  maxGapMiles: number;
  autoWaypoints: AutoWaypoint[];
  evaluatedRoutes: number;
  warning?: string;
}> {
  const targetMaxGapMiles = computeTargetMaxGapMiles(options.rangeMiles, options.minArrivalPercent);
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

  return {
    chosen: current.route,
    chosenStations: current.stations,
    maxGapMiles: current.maxGapMiles,
    autoWaypoints,
    evaluatedRoutes,
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
    const rawMinArrivalPercent = (req.body as { minArrivalPercent?: unknown; min_arrival_percent?: unknown } | undefined)?.minArrivalPercent
      ?? (req.body as { minArrivalPercent?: unknown; min_arrival_percent?: unknown } | undefined)?.min_arrival_percent;

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
    const requestedRangeMiles = ensureNumber(rawRangeMiles);
    const requestedMaxDetourFactor = ensureNumber(rawMaxDetourFactor);
    const requestedMinArrivalPercent = ensureNumber(rawMinArrivalPercent);

    let preferenceDefaults: { range_miles: number; max_detour_factor: number; min_arrival_percent: number } | null = null;
    if (
      req.user
      && (requestedRangeMiles === null || requestedMaxDetourFactor === null || requestedMinArrivalPercent === null)
    ) {
      const prefsResult = await pool.query<{
        range_miles: number;
        max_detour_factor: number;
        min_arrival_percent: number;
      }>(
        `
          SELECT range_miles, max_detour_factor, min_arrival_percent
          FROM user_preferences
          WHERE user_id = $1
          LIMIT 1
        `,
        [req.user.id]
      );
      preferenceDefaults = prefsResult.rows[0] ?? null;
    }

    const rangeMiles = Math.max(0, requestedRangeMiles ?? preferenceDefaults?.range_miles ?? 210);
    const maxDetourFactor = Math.max(1, requestedMaxDetourFactor ?? preferenceDefaults?.max_detour_factor ?? 1.25);
    const minArrivalPercent = clampPercent(
      Math.round(requestedMinArrivalPercent ?? preferenceDefaults?.min_arrival_percent ?? 10)
    );
    const targetMaxGapMiles = computeTargetMaxGapMiles(rangeMiles, minArrivalPercent);

    const routeCacheTtlSeconds = config.cache.routeResponseTtlSeconds;
    const routeCacheKey = routeCacheTtlSeconds > 0
      ? makeRouteResponseCacheKey({
        start,
        end,
        waypoints,
        corridorMiles,
        includeStations,
        preference: requestedPreference,
        rangeMiles,
        minArrivalPercent,
        maxDetourFactor,
      })
      : null;

    if (routeCacheKey) {
      const cached = await getCachedRouteResponse(routeCacheKey);
      if (cached) return res.json(cached);
    }

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
            minArrivalPercent,
            maxDetourFactor,
          });
          chosen = optimized.chosen;
          chosenStations = optimized.chosenStations;
          maxGapMiles = optimized.maxGapMiles;
          autoWaypoints = optimized.autoWaypoints;
          evaluatedRoutes = optimized.evaluatedRoutes;
          warning = optimized.warning;

          // Treat as charger-optimized if we either added waypoints OR the fastest route already satisfies the gap target.
          preference = (autoWaypoints.length > 0 || optimized.maxGapMiles <= targetMaxGapMiles)
            ? 'charger_optimized'
            : 'fastest';

          // Keep the more specific warning (if any), otherwise leave it empty.
          if (!warning && orsAlternativesUnavailable) {
            // No warning needed; this is expected for long routes and we still return a route.
          }
        } else {
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

    const elevationTotals = computeRouteElevationTotalsFeet(chosen);
    const summary: RouteSummary = {
      ...chosen.summary,
      ...(elevationTotals ?? {}),
    };

    const responseBody: RouteResponse = {
      points: resolvedPoints,
      summary,
      geometry: chosen.geometry,
    };

    if (includeStations) {
      applyStationElevationDeltas(chosenStations ?? [], chosen);
      applyStationRanking(chosenStations ?? [], corridorMiles);
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

    if (routeCacheKey) {
      await setCachedRouteResponse({
        cacheKey: routeCacheKey,
        requestJson: {
          start,
          end,
          waypoints,
          corridorMiles,
          includeStations,
          preference: requestedPreference,
          rangeMiles,
          minArrivalPercent,
          maxDetourFactor,
        },
        responseJson: responseBody,
        ttlSeconds: routeCacheTtlSeconds,
      });
    }

    return res.json(responseBody);
  } catch (error) {
    console.error('Error computing route:', error);
    return res.status(500).json({ error: `Failed to compute route: ${toErrorMessage(error)}` });
  }
});

export default router;
