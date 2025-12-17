import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

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

router.post('/', async (req, res) => {
  try {
    const start = ensureString((req.body as { start?: unknown } | undefined)?.start);
    const end = ensureString((req.body as { end?: unknown } | undefined)?.end);
    const rawWaypoints = (req.body as { waypoints?: unknown } | undefined)?.waypoints;

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

    const responseBody: RouteResponse = {
      points: resolvedPoints,
      summary: route.summary,
      geometry: route.geometry,
    };

    return res.json(responseBody);
  } catch (error) {
    console.error('Error computing route:', error);
    return res.status(500).json({ error: `Failed to compute route: ${toErrorMessage(error)}` });
  }
});

export default router;
