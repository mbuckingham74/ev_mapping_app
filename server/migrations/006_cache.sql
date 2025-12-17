CREATE TABLE IF NOT EXISTS geocode_cache (
  cache_key TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  label TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS geocode_cache_expires_at_idx ON geocode_cache (expires_at);

CREATE TABLE IF NOT EXISTS ors_directions_cache (
  cache_key TEXT PRIMARY KEY,
  request_json JSONB NOT NULL,
  routes_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ors_directions_cache_expires_at_idx ON ors_directions_cache (expires_at);

CREATE TABLE IF NOT EXISTS route_response_cache (
  cache_key TEXT PRIMARY KEY,
  request_json JSONB NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS route_response_cache_expires_at_idx ON route_response_cache (expires_at);
