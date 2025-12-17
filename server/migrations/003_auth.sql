CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_lowercase_check CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_name TEXT,
  range_miles INTEGER NOT NULL DEFAULT 210,
  efficiency_mi_per_kwh DOUBLE PRECISION,
  battery_kwh DOUBLE PRECISION,
  min_arrival_percent INTEGER NOT NULL DEFAULT 10,
  default_corridor_miles INTEGER NOT NULL DEFAULT 30,
  default_preference TEXT NOT NULL DEFAULT 'charger_optimized',
  max_detour_factor DOUBLE PRECISION NOT NULL DEFAULT 1.25,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_preferences_default_preference_check CHECK (default_preference IN ('fastest', 'charger_optimized')),
  CONSTRAINT user_preferences_range_miles_check CHECK (range_miles >= 0),
  CONSTRAINT user_preferences_min_arrival_percent_check CHECK (min_arrival_percent BETWEEN 0 AND 100),
  CONSTRAINT user_preferences_default_corridor_miles_check CHECK (default_corridor_miles >= 0),
  CONSTRAINT user_preferences_max_detour_factor_check CHECK (max_detour_factor >= 1)
);

