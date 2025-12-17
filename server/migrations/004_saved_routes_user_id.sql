ALTER TABLE saved_routes
  ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS saved_routes_user_id_created_at_idx
  ON saved_routes (user_id, created_at DESC);

