# EA Route Planner

Web app for planning routes and viewing Electrify America DC fast-charging stations on a map, backed by Postgres + PostGIS.

**Live:** https://ev.tachyonfuture.com

## Features

- Route planning (start/end + optional waypoints)
- “DC charger optimized” mode (may choose a longer route to include more stations)
- Accurate stations-along-route corridor filtering via PostGIS (plus max-gap calculation)
- DB-backed caching for ORS geocoding/directions and full route responses
- Station ranking (A–D tiers) for stations along your route
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

### Min Arrival %

Vehicle preference `min_arrival_percent` is used by the charger-optimizer and risk alerts.

- Safe max-gap target: `range_miles * (1 - min_arrival_percent/100)`
- The client sends `minArrivalPercent` to `POST /api/route` (and if omitted, the backend will use the signed-in user’s saved preference when available).

### Caching (optional)

All cache entries are stored in Postgres with TTLs.

- `GEOCODE_CACHE_TTL_DAYS` (default `30`)
- `DIRECTIONS_CACHE_TTL_DAYS` (default `7`)
- `ROUTE_CACHE_TTL_SECONDS` (default `600`)

### Station Ranking

When route planning returns `stations`, each station includes:

- `rank_score` (0–100), `rank_tier` (`A`–`D`), and `rank` (1 = best).

Ranking favors higher max kW, more DC stalls, and closer-to-route stations (and penalizes non-operational stations).

## Migrations

The backend runs SQL migrations on startup. Migrations live in `server/migrations/`.
