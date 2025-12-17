CREATE TABLE IF NOT EXISTS saved_routes (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  start_query TEXT NOT NULL,
  end_query TEXT NOT NULL,
  waypoints TEXT[] NOT NULL DEFAULT '{}',
  corridor_miles INTEGER NOT NULL DEFAULT 15,
  preference TEXT NOT NULL DEFAULT 'fastest',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_routes_preference_check CHECK (preference IN ('fastest', 'charger_optimized'))
);

CREATE INDEX IF NOT EXISTS saved_routes_created_at_idx ON saved_routes (created_at DESC);
