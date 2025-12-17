# EA Route Planner

Web app for viewing Electrify America DC fast-charging stations on a map, backed by a Postgres database.

## Repo Layout

- `client/` — React + TypeScript + Vite frontend (Leaflet map)
- `server/` — Node.js + Express + TypeScript backend API
- `docker-compose.yml` — Production compose (expects external `npm_network`)
- `docker-compose.dev.yml` — Local dev Postgres

## Local Development

### Prerequisites

- Node.js 22+
- Docker (for local Postgres)

### Setup

```bash
npm install
cp .env.example .env
```

Update `.env` with at least:

- `DB_PASSWORD`
- `OPENCHARMAP_API_KEY` (required to fetch stations)

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

## Migrations

The backend runs SQL migrations on startup. Migrations live in `server/migrations/`.

