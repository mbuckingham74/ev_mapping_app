# EV Route Planner

> Plan your EV road trips with confidence. Find Electrify America charging stations along your route with intelligent gap analysis and elevation-aware metrics.

[![Live Demo](https://img.shields.io/badge/demo-ev.tachyonfuture.com-blue?style=flat-square)](https://ev.tachyonfuture.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_+_PostGIS-4169e1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?style=flat-square&logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![iOS](https://img.shields.io/badge/iOS-26.2-000000?style=flat-square&logo=apple&logoColor=white)](https://developer.apple.com/ios/)

---

## Features

- **Smart Route Planning** — Enter cities or full addresses with optional waypoints
- **DC Charger Optimized Mode** — Finds routes that maximize charging options, even if slightly longer
- **Corridor-Based Station Search** — PostGIS-powered queries find stations within X miles of your route
- **Auto Corridor (Min Clutter)** — Starts narrow and widens only if needed to keep max gaps within your range
- **Truck Stops Along Route** — Plots truck stop POIs within the corridor (orange markers) with brand filtering
- **Auto-Expanding Corridors** — Automatically widens search when needed to ensure viable charging gaps
- **Must Stop Highlights** — Flags critical chargers and lets you filter the map down to only “MUST STOP” stations
- **Elevation Metrics** — See total climb/descent plus per-leg elevation changes between stations
- **Station Ranking** — A–D tier ratings based on charger power, stall count, and proximity
- **Risk Alerts** — Warnings when gaps exceed your range or you'd arrive below minimum charge
- **User Accounts** — Save routes and vehicle preferences (range, efficiency, min arrival %)
- **Shareable Links** — Generate URLs with route parameters for easy sharing
- **Color-Coded Route Endpoints** — Start marker is green; destination marker is red

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, Leaflet |
| **Backend** | Node.js 22, Express 5, TypeScript |
| **Database** | PostgreSQL 16 + PostGIS |
| **Infrastructure** | Docker Compose, Nginx Proxy Manager |

## Project Structure

```
ev-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components (RoutePlanner, etc.)
│   │   ├── services/       # API client
│   │   └── types/          # TypeScript types
│   └── Dockerfile
├── server/                 # Express backend
│   ├── src/
│   │   ├── routes/         # API endpoints
│   │   └── migrations/     # Database migrations
│   └── Dockerfile
├── truck_stop_location_data/ # Truck stop POIs (CSV)
└── docker-compose.yml      # Production deployment
```

## Getting Started

### Prerequisites

- Node.js 22+
- Docker & Docker Compose

### Installation

```bash
# Clone the repo
git clone https://github.com/mbuckingham74/ev_mapping_app.git
cd ev_mapping_app

# Install dependencies
npm install

# Set up environment
cp .env.example .env
```

Edit `.env` with your API keys:

| Variable | Description |
|----------|-------------|
| `DB_PASSWORD` | PostgreSQL password |
| `OPENCHARMAP_API_KEY` | [OpenChargeMap](https://openchargemap.org/site/develop/api) API key |
| `OPENROUTESERVICE_API_KEY` | [OpenRouteService](https://openrouteservice.org/) API key |

### Run Locally

```bash
# Start PostgreSQL/PostGIS
npm run docker:dev:up

# Start dev servers (frontend + backend)
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

### iOS App

See `ios/README.md` for the SwiftUI + MapKit app setup, background tracking, and run instructions.

### Import Station Data

```bash
npm run fetch:stations
```

This fetches ~1,100 Electrify America stations from OpenChargeMap.

## API Overview

| Endpoint | Description |
|----------|-------------|
| `POST /api/route` | Plan a route with EA stations + truck stops along the corridor |
| `GET /api/stations` | List all stations (optionally filter by state) |
| `GET /api/stations/near/:lat/:lng` | Find stations near a location |
| `POST /api/auth/signup` | Create account |
| `POST /api/auth/login` | Sign in |
| `GET /api/saved-routes` | List saved routes |

See `.ev_mapping_app.md` (internal technical notes) for full details.

## How It Works

1. **Geocoding** — Converts start/end locations to coordinates via OpenRouteService
2. **Route Calculation** — Gets driving directions with elevation data
3. **Station Search** — PostGIS corridor query finds EA stations within X miles of the route polyline
4. **Gap Analysis** — Calculates distances between stations and identifies max gaps
5. **Optimization** — In "charger optimized" mode, may widen corridor or insert waypoints to reduce gaps
6. **Ranking** — Scores stations by power (kW), stall count, and distance from route

## Configuration

### Caching

Route calculations are cached in PostgreSQL to reduce API calls:

| Variable | Default | Description |
|----------|---------|-------------|
| `GEOCODE_CACHE_TTL_DAYS` | 30 | Geocoding cache lifetime |
| `DIRECTIONS_CACHE_TTL_DAYS` | 7 | Directions cache lifetime |
| `ROUTE_CACHE_TTL_SECONDS` | 600 | Full route response cache |

### User Preferences

Signed-in users can save vehicle preferences:

- **Range** — Total vehicle range in miles
- **Min Arrival %** — Minimum charge level when reaching a charger
- **Corridor Width** — Default search corridor in miles
- **Max Detour Factor** — How much longer a route can be (e.g., 1.25 = 25% longer max)

## Deployment

The app runs on Docker Compose with three containers:

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│    Frontend     │   │     Backend     │   │    PostgreSQL   │
│  (nginx:alpine) │──▶│  (node:alpine)  │──▶│ (postgis:alpine)│
│      :80        │   │     :3001       │   │     :5432       │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

```bash
# Build and start
docker compose build
docker compose up -d

# View logs
docker compose logs -f
```

## License

MIT

## Acknowledgments

- [OpenChargeMap](https://openchargemap.org/) — Charging station data
- [OpenRouteService](https://openrouteservice.org/) — Geocoding and routing
- [OpenStreetMap](https://www.openstreetmap.org/) — Map tiles
