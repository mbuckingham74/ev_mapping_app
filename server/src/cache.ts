import crypto from 'node:crypto';
import { pool } from './db.js';

type CachedGeocode = {
  label: string;
  lat: number;
  lng: number;
};

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeQueryText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function serializeCoordinates(coordinates: [number, number][]): string {
  return coordinates
    .map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(';');
}

export function makeGeocodeCacheKey(query: string): string {
  return sha256Hex(`geocode:v1:${normalizeQueryText(query).toLowerCase()}`);
}

export function makeDirectionsCacheKey(options: {
  coordinates: [number, number][];
  includeAlternatives: boolean;
}): string {
  const coords = serializeCoordinates(options.coordinates);
  const alt = options.includeAlternatives ? '1' : '0';
  return sha256Hex(`ors-directions:v3:profile=driving-car:alt=${alt}:elev=1:coords=${coords}`);
}

export function makeRouteResponseCacheKey(options: {
  start: string;
  end: string;
  waypoints: string[];
  corridorMiles: number;
  autoCorridor: boolean;
  includeStations: boolean;
  preference: 'fastest' | 'charger_optimized';
  rangeMiles: number;
  minArrivalPercent: number;
  maxDetourFactor: number;
}): string {
  const corridor = (Math.round(options.corridorMiles * 100) / 100).toFixed(2);
  const detour = (Math.round(options.maxDetourFactor * 1000) / 1000).toFixed(3);
  const queries = [options.start, ...options.waypoints, options.end].map(normalizeQueryText);
  const payload = [
    'route:v8',
    `pref=${options.preference}`,
    `autoCorr=${options.autoCorridor ? 1 : 0}`,
    `stations=${options.includeStations ? 1 : 0}`,
    `corr=${corridor}`,
    `range=${Math.round(options.rangeMiles)}`,
    `minArr=${Math.round(options.minArrivalPercent)}`,
    `detour=${detour}`,
    `q=${queries.join('|')}`,
  ].join(':');
  return sha256Hex(payload);
}

const warned = new Set<string>();
function warnOnce(key: string, error: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[cache] disabled for ${key}:`, error);
}

type CacheTable = 'geocode_cache' | 'ors_directions_cache' | 'route_response_cache';

const lastCleanup: Record<CacheTable, number> = {
  geocode_cache: 0,
  ors_directions_cache: 0,
  route_response_cache: 0,
};

async function maybeCleanup(table: CacheTable): Promise<void> {
  const now = Date.now();
  if (now - lastCleanup[table] < 60 * 60 * 1000) return;
  lastCleanup[table] = now;
  try {
    // Table name is hard-coded via switch to avoid SQL injection.
    switch (table) {
      case 'geocode_cache':
        await pool.query('DELETE FROM geocode_cache WHERE expires_at < NOW()');
        break;
      case 'ors_directions_cache':
        await pool.query('DELETE FROM ors_directions_cache WHERE expires_at < NOW()');
        break;
      case 'route_response_cache':
        await pool.query('DELETE FROM route_response_cache WHERE expires_at < NOW()');
        break;
      default: {
        const _exhaustive: never = table;
        return _exhaustive;
      }
    }
  } catch (error) {
    warnOnce(table, error);
  }
}

export async function getCachedGeocode(cacheKey: string): Promise<CachedGeocode | null> {
  try {
    const result = await pool.query<CachedGeocode>(
      `
        SELECT label, lat, lng
        FROM geocode_cache
        WHERE cache_key = $1
          AND expires_at > NOW()
        LIMIT 1
      `,
      [cacheKey]
    );
    const row = result.rows[0];
    if (!row) return null;
    if (typeof row.label !== 'string') return null;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
    return row;
  } catch (error) {
    warnOnce('geocode_cache', error);
    return null;
  }
}

export async function setCachedGeocode(options: {
  cacheKey: string;
  queryText: string;
  label: string;
  lat: number;
  lng: number;
  ttlDays: number;
}): Promise<void> {
  if (!Number.isFinite(options.ttlDays) || options.ttlDays <= 0) return;
  try {
    await maybeCleanup('geocode_cache');
    await pool.query(
      `
        INSERT INTO geocode_cache (cache_key, query_text, label, lat, lng, expires_at)
        VALUES ($1, $2, $3, $4, $5, NOW() + ($6 * INTERVAL '1 day'))
        ON CONFLICT (cache_key) DO UPDATE SET
          query_text = EXCLUDED.query_text,
          label = EXCLUDED.label,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          updated_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `,
      [
        options.cacheKey,
        normalizeQueryText(options.queryText),
        options.label,
        options.lat,
        options.lng,
        Math.floor(options.ttlDays),
      ]
    );
  } catch (error) {
    warnOnce('geocode_cache', error);
  }
}

export async function getCachedDirections(cacheKey: string): Promise<unknown | null> {
  try {
    const result = await pool.query<{ routes_json: unknown }>(
      `
        SELECT routes_json
        FROM ors_directions_cache
        WHERE cache_key = $1
          AND expires_at > NOW()
        LIMIT 1
      `,
      [cacheKey]
    );
    return result.rows[0]?.routes_json ?? null;
  } catch (error) {
    warnOnce('ors_directions_cache', error);
    return null;
  }
}

export async function setCachedDirections(options: {
  cacheKey: string;
  requestJson: unknown;
  routesJson: unknown;
  ttlDays: number;
}): Promise<void> {
  if (!Number.isFinite(options.ttlDays) || options.ttlDays <= 0) return;
  try {
    await maybeCleanup('ors_directions_cache');
    await pool.query(
      `
        INSERT INTO ors_directions_cache (cache_key, request_json, routes_json, expires_at)
        VALUES ($1, $2::jsonb, $3::jsonb, NOW() + ($4 * INTERVAL '1 day'))
        ON CONFLICT (cache_key) DO UPDATE SET
          request_json = EXCLUDED.request_json,
          routes_json = EXCLUDED.routes_json,
          updated_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `,
      [
        options.cacheKey,
        JSON.stringify(options.requestJson),
        JSON.stringify(options.routesJson),
        Math.floor(options.ttlDays),
      ]
    );
  } catch (error) {
    warnOnce('ors_directions_cache', error);
  }
}

export async function getCachedRouteResponse(cacheKey: string): Promise<unknown | null> {
  try {
    const result = await pool.query<{ response_json: unknown }>(
      `
        SELECT response_json
        FROM route_response_cache
        WHERE cache_key = $1
          AND expires_at > NOW()
        LIMIT 1
      `,
      [cacheKey]
    );
    return result.rows[0]?.response_json ?? null;
  } catch (error) {
    warnOnce('route_response_cache', error);
    return null;
  }
}

export async function setCachedRouteResponse(options: {
  cacheKey: string;
  requestJson: unknown;
  responseJson: unknown;
  ttlSeconds: number;
}): Promise<void> {
  if (!Number.isFinite(options.ttlSeconds) || options.ttlSeconds <= 0) return;
  try {
    await maybeCleanup('route_response_cache');
    await pool.query(
      `
        INSERT INTO route_response_cache (cache_key, request_json, response_json, expires_at)
        VALUES ($1, $2::jsonb, $3::jsonb, NOW() + ($4 * INTERVAL '1 second'))
        ON CONFLICT (cache_key) DO UPDATE SET
          request_json = EXCLUDED.request_json,
          response_json = EXCLUDED.response_json,
          updated_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `,
      [
        options.cacheKey,
        JSON.stringify(options.requestJson),
        JSON.stringify(options.responseJson),
        Math.floor(options.ttlSeconds),
      ]
    );
  } catch (error) {
    warnOnce('route_response_cache', error);
  }
}
