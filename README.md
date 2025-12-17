# EA Route Planner

Web app for planning routes and viewing Electrify America DC fast-charging stations on a map, backed by Postgres + PostGIS.

**Live:** https://ev.tachyonfuture.com

## Features

- Route planning (start/end + optional waypoints)
- “DC charger optimized” mode (may choose a longer route to include more stations)
- Accurate stations-along-route corridor filtering via PostGIS (plus max-gap calculation)
- DB-backed caching for ORS geocoding/directions and full route responses
- Accounts: save routes + store vehicle preferences (range, corridor, detour factor, etc.)
- Risk alerts when max-gap exceeds your range or would arrive below your min arrival %
- Share links via URL query params (start/end/wp/corridor/pref)

## Repo Layout

- `client/` — React + TypeScript + Vite frontend (Leaflet map)
- `server/` — Node.js + Express + TypeScript backend API
- `docker-compose.yml` — Production compose (expects external `npm_network`)
- `docker-compose.dev.yml` — Local dev Postgres/PostGIS

## Local Development

### Prerequisites

- Node.js 22+
- Docker (for local Postgres/PostGIS)

### Setup

```bash
npm install
cp .env.example .env
```

Update `.env` with at least:

- `DB_PASSWORD`
- `OPENCHARMAP_API_KEY` (required to fetch stations)
- `OPENROUTESERVICE_API_KEY` (required for route planning)

Start Postgres:

```bash
npm run docker:dev:up
```

Run the dev servers:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

### Import/Refresh Station Data

```bash
npm run fetch:stations
```

### Auth (optional)

Accounts use a secure, httpOnly session cookie stored by the backend.

- Optional config in `.env`: `SESSION_COOKIE_NAME`, `SESSION_TTL_DAYS`

### Caching (optional)

All cache entries are stored in Postgres with TTLs.

- `GEOCODE_CACHE_TTL_DAYS` (default `30`)
- `DIRECTIONS_CACHE_TTL_DAYS` (default `7`)
- `ROUTE_CACHE_TTL_SECONDS` (default `600`)

## Migrations

The backend runs SQL migrations on startup. Migrations live in `server/migrations/`.
