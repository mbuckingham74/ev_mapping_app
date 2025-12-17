import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid integer for ${name}: "${raw}"`);
  }
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readIntEnv('PORT', 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  auth: {
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'ea_session',
    sessionTtlDays: readIntEnv('SESSION_TTL_DAYS', 30),
  },
  cache: {
    geocodeTtlDays: readIntEnv('GEOCODE_CACHE_TTL_DAYS', 30),
    directionsTtlDays: readIntEnv('DIRECTIONS_CACHE_TTL_DAYS', 7),
    routeResponseTtlSeconds: readIntEnv('ROUTE_CACHE_TTL_SECONDS', 10 * 60),
  },
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: readIntEnv('DB_PORT', 5432),
    database: process.env.DB_NAME ?? 'ea_planner',
    user: process.env.DB_USER ?? 'ea_planner',
    password: requireEnv('DB_PASSWORD'),
    ssl: process.env.DB_SSL === 'true',
  },
  apiKeys: {
    nrel: process.env.NREL_API_KEY,
    openChargeMap: process.env.OPENCHARMAP_API_KEY,
    openRouteService: process.env.OPENROUTESERVICE_API_KEY,
  },
} as const;
